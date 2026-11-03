import crypto from 'node:crypto';
import { z } from 'zod';
import type { Order, OrderItem } from '@prisma/client';
import { env } from '../env';
import { prisma } from '../db';
import { decryptSecret, timingSafeEqualStr } from '../lib/crypto';
import { getSettings } from '../lib/settings';
import { firstName, itemsSummary, renderMessage, whatsappLink } from '../lib/messages';
import { formatAmount, formatPhoneBR } from '../lib/money';
import { statusLabel } from '../lib/orderStatus';
import { realtime } from '../realtime';
import { DEFAULT_TEMPLATES, TEMPLATE_LANGUAGE } from './whatsappTemplates';

/**
 * Integração com a WhatsApp Business Platform (Cloud API oficial da Meta).
 *
 * Mensagens iniciadas pela empresa exigem templates aprovados. Cada evento
 * pode ser associado a um template; as variáveis do corpo seguem a ordem de EVENT_PARAMS.
 * Sem integração configurada, nada é enviado: a notificação fica registrada como
 * SKIPPED e o painel oferece o link wa.me para envio manual.
 */

export const EVENTS = [
  'ORDER_RECEIVED',
  'ORDER_ACCEPTED',
  'ORDER_PREPARING',
  'ORDER_READY',
  'ORDER_OUT_FOR_DELIVERY',
  'ORDER_DELIVERED',
  'ORDER_CANCELED',
] as const;
export type WhatsappEvent = (typeof EVENTS)[number];

export const EVENT_LABELS: Record<WhatsappEvent, string> = {
  ORDER_RECEIVED: 'Pedido recebido',
  ORDER_ACCEPTED: 'Pedido aceito (com prazo estimado)',
  ORDER_PREPARING: 'Pedido em preparação',
  ORDER_READY: 'Pedido pronto',
  ORDER_OUT_FOR_DELIVERY: 'Saiu para entrega',
  ORDER_DELIVERED: 'Pedido entregue/finalizado',
  ORDER_CANCELED: 'Pedido cancelado (com motivo)',
};

/** Variáveis {{1}}, {{2}}... do corpo do template, nesta ordem. */
export const EVENT_PARAMS: Record<WhatsappEvent, string[]> = {
  ORDER_RECEIVED: ['NOME', 'NÚMERO', 'RESUMO', 'VALOR'],
  ORDER_ACCEPTED: ['NOME', 'NÚMERO', 'RESUMO', 'VALOR', 'TEMPO'],
  ORDER_PREPARING: ['NOME', 'NÚMERO'],
  ORDER_READY: ['NOME', 'NÚMERO', 'STATUS'],
  ORDER_OUT_FOR_DELIVERY: ['NOME', 'NÚMERO'],
  ORDER_DELIVERED: ['NOME', 'NÚMERO'],
  ORDER_CANCELED: ['NOME', 'NÚMERO', 'MOTIVO', 'WHATSAPP'],
};

export const whatsappConfigSchema = z.object({
  phoneNumberId: z.string().max(40).regex(/^\d*$/, 'O Phone Number ID tem só números (não é o telefone).').default(''),
  businessAccountId: z.string().max(40).regex(/^\d*$/, 'O WhatsApp Business Account ID tem só números (não é o telefone).').default(''),
  displayPhone: z.string().max(20).default('5587981076022'),
  templates: z
    .record(
      z.string(),
      z.object({ name: z.string().max(512), language: z.string().max(10).default('pt_BR'), enabled: z.boolean() }),
    )
    .default({}),
});
export type WhatsappConfig = z.infer<typeof whatsappConfigSchema>;

const MAX_ATTEMPTS = 5;

export async function loadIntegration() {
  const row = await prisma.integration.findUnique({ where: { id: 'whatsapp' } });
  const stored = (row?.config ?? {}) as Record<string, unknown>;
  // Valores inválidos salvos antes da validação (ex.: telefone no campo de ID) são ignorados.
  const clean = (v: unknown) => (typeof v === 'string' && /^\d*$/.test(v) ? v : '');
  const config = whatsappConfigSchema.parse({ ...stored, phoneNumberId: clean(stored.phoneNumberId), businessAccountId: clean(stored.businessAccountId) });
  let token: string | null = env.WHATSAPP_ACCESS_TOKEN || null;
  if (!token && row?.secretEncrypted) {
    try {
      token = decryptSecret(row.secretEncrypted);
    } catch {
      token = null;
    }
  }
  const phoneNumberId = config.phoneNumberId || process.env.WHATSAPP_PHONE_NUMBER_ID || '';
  const ready = !!(row?.enabled && token && phoneNumberId);
  return { row, config: { ...config, phoneNumberId }, token, ready, tokenSource: env.WHATSAPP_ACCESS_TOKEN ? 'env' : row?.secretEncrypted ? 'database' : null };
}

type OrderForMsg = Order & { items: OrderItem[] };

export function buildVars(order: OrderForMsg, extra: { reason?: string; storePhone?: string } = {}) {
  return {
    WHATSAPP: extra.storePhone ? formatPhoneBR(extra.storePhone) : '',
    NOME: firstName(order.customerName),
    NÚMERO: order.number,
    RESUMO: itemsSummary(order.items),
    VALOR: formatAmount(order.totalCents),
    TEMPO: order.estimatedMinutes ?? '',
    MOTIVO: extra.reason ?? order.cancelReason ?? '',
    STATUS: statusLabel(order.type, order.status).toLowerCase(),
    LINK: `${env.PUBLIC_APP_URL.replace(/\/$/, '')}/pedido/${order.publicToken}`,
  };
}

export async function renderOrderMessage(order: OrderForMsg, event: WhatsappEvent, extra: { reason?: string } = {}) {
  const settings = await getSettings();
  return renderMessage(settings.messages[event], buildVars(order, { ...extra, storePhone: settings.store.whatsapp }));
}

/** Link para envio manual pelo atendente (não implica envio automático). */
export async function manualLinkFor(order: OrderForMsg, event: WhatsappEvent) {
  if (!order.customerPhone) return null;
  return whatsappLink(order.customerPhone, await renderOrderMessage(order, event));
}

/** Registra a notificação e tenta enviar quando a integração oficial estiver ativa. */
export async function notifyOrder(orderId: string, event: WhatsappEvent, extra: { reason?: string } = {}) {
  try {
    const order = await prisma.order.findUnique({ where: { id: orderId }, include: { items: true } });
    if (!order) return;
    const body = await renderOrderMessage(order, event, extra);
    const integ = await loadIntegration();
    const tpl = integ.config.templates[event];
    let skipReason: string | null = null;
    if (!order.customerPhone) skipReason = 'Pedido sem telefone';
    else if (!order.whatsappOptIn) skipReason = 'Cliente não autorizou mensagens no WhatsApp';
    else if (!integ.ready) skipReason = 'Integração WhatsApp não configurada — use o envio manual';
    else if (!tpl?.enabled || !tpl.name) skipReason = 'Template não configurado para este evento';

    const n = await prisma.whatsappNotification.create({
      data: {
        orderId,
        event,
        toPhone: order.customerPhone ?? '',
        template: tpl?.name ?? null,
        body,
        status: skipReason ? 'SKIPPED' : 'PENDING',
        skipReason,
        nextAttemptAt: skipReason ? null : new Date(),
      },
    });
    realtime.staff('notification:updated', { orderId, id: n.id });
    if (!skipReason) await attemptSend(n.id);
  } catch (e) {
    console.error('Falha ao registrar notificação WhatsApp', e);
  }
}

async function callCloudApi(
  phoneNumberId: string,
  token: string,
  payload: Record<string, unknown>,
): Promise<{ ok: true; id: string } | { ok: false; error: string; retriable: boolean }> {
  const url = `${env.WHATSAPP_GRAPH_URL}/${env.WHATSAPP_API_VERSION}/${phoneNumberId}/messages`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', ...payload }),
      signal: AbortSignal.timeout(15000),
    });
    const json = (await res.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message?: string; code?: number } };
    if (res.ok && json.messages?.[0]?.id) return { ok: true, id: json.messages[0].id };
    return {
      ok: false,
      error: `HTTP ${res.status}: ${json.error?.message ?? 'resposta inesperada'}`,
      retriable: res.status >= 500 || res.status === 429,
    };
  } catch (e) {
    return { ok: false, error: (e as Error).message, retriable: true };
  }
}

export async function attemptSend(notificationId: string) {
  // Reserva atômica: evita envio duplicado por processos concorrentes.
  const lease = new Date(Date.now() + 60_000);
  const claimed = await prisma.whatsappNotification.updateMany({
    where: { id: notificationId, status: { in: ['PENDING', 'FAILED'] }, attempts: { lt: MAX_ATTEMPTS }, nextAttemptAt: { lte: new Date() } },
    data: { nextAttemptAt: lease, attempts: { increment: 1 } },
  });
  if (claimed.count === 0) return;
  const n = await prisma.whatsappNotification.findUniqueOrThrow({ where: { id: notificationId }, include: { order: { include: { items: true } } } });
  const integ = await loadIntegration();
  const event = n.event as WhatsappEvent;
  const tpl = integ.config.templates[event];
  if (!integ.ready || !tpl?.enabled || !n.order) {
    await prisma.whatsappNotification.update({
      where: { id: n.id },
      data: { status: 'SKIPPED', skipReason: 'Integração desativada antes do envio', nextAttemptAt: null },
    });
    return;
  }
  const storePhone = (await getSettings()).store.whatsapp;
  const vars = buildVars(n.order, { storePhone }) as Record<string, string | number>;
  const params = EVENT_PARAMS[event].map((k) => ({ type: 'text', text: String(vars[k] ?? '-').slice(0, 1000) || '-' }));
  const result = await callCloudApi(integ.config.phoneNumberId, integ.token!, {
    to: n.toPhone,
    type: 'template',
    template: { name: tpl.name, language: { code: tpl.language }, components: [{ type: 'body', parameters: params }] },
  });
  if (result.ok) {
    await prisma.whatsappNotification.update({
      where: { id: n.id },
      data: { status: 'SENT', providerMessageId: result.id, lastError: null, nextAttemptAt: null },
    });
  } else {
    const attempts = n.attempts;
    const giveUp = !result.retriable || attempts >= MAX_ATTEMPTS;
    await prisma.whatsappNotification.update({
      where: { id: n.id },
      data: {
        status: 'FAILED',
        lastError: result.error.slice(0, 500),
        nextAttemptAt: giveUp ? null : new Date(Date.now() + Math.min(30, 2 ** attempts) * 60_000),
      },
    });
    await prisma.integration.update({ where: { id: 'whatsapp' }, data: { lastError: result.error.slice(0, 500) } }).catch(() => {});
  }
  realtime.staff('notification:updated', { orderId: n.orderId, id: n.id });
}

export async function retryDueNotifications() {
  const due = await prisma.whatsappNotification.findMany({
    where: { status: { in: ['PENDING', 'FAILED'] }, attempts: { lt: MAX_ATTEMPTS }, nextAttemptAt: { lte: new Date() } },
    select: { id: true },
    take: 20,
  });
  for (const d of due) await attemptSend(d.id);
}

/** Envio de teste usando o template "hello_world" (padrão de contas novas) ou outro informado. */
export async function sendTest(to: string, templateName: string, language: string) {
  const integ = await loadIntegration();
  if (!integ.token || !integ.config.phoneNumberId)
    return { ok: false as const, error: 'Informe o Phone Number ID e o token de acesso.' };
  const r = await callCloudApi(integ.config.phoneNumberId, integ.token, {
    to,
    type: 'template',
    template: { name: templateName, language: { code: language } },
  });
  await prisma.integration.update({
    where: { id: 'whatsapp' },
    data: { lastCheckedAt: new Date(), status: r.ok ? 'CONNECTED' : 'ERROR', lastError: r.ok ? null : r.error },
  });
  return r;
}

/** Preenche no painel os templates padrão (nome + idioma) para todos os eventos. */
export async function applyDefaultTemplates() {
  const integ = await loadIntegration();
  const templates = { ...integ.config.templates };
  for (const ev of EVENTS) templates[ev] = { name: DEFAULT_TEMPLATES[ev].name, language: TEMPLATE_LANGUAGE, enabled: true };
  const config = { ...integ.config, templates };
  await prisma.integration.upsert({
    where: { id: 'whatsapp' },
    create: { id: 'whatsapp', enabled: false, config },
    update: { config },
  });
  return config;
}

async function graph(path: string, token: string, init: RequestInit = {}) {
  const res = await fetch(`${env.WHATSAPP_GRAPH_URL}/${env.WHATSAPP_API_VERSION}/${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(20000),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown> & { error?: { message?: string; error_user_msg?: string } };
  return { ok: res.ok, json, error: json.error?.error_user_msg || json.error?.message || `HTTP ${res.status}` };
}

/** Envia os templates padrão para aprovação na conta do WhatsApp Business (WABA). */
export async function submitDefaultTemplates() {
  const integ = await loadIntegration();
  if (!integ.token || !integ.config.businessAccountId)
    return { ok: false as const, error: 'Informe o WhatsApp Business Account ID e o token de acesso antes de enviar.' };
  const results: { event: string; name: string; status: string; error?: string }[] = [];
  for (const ev of EVENTS) {
    const t = DEFAULT_TEMPLATES[ev];
    const r = await graph(`${integ.config.businessAccountId}/message_templates`, integ.token, {
      method: 'POST',
      body: JSON.stringify({
        name: t.name,
        language: TEMPLATE_LANGUAGE,
        category: 'UTILITY',
        components: [{ type: 'BODY', text: t.body, example: { body_text: [t.example] } }],
      }),
    });
    if (r.ok) results.push({ event: ev, name: t.name, status: String(r.json.status ?? 'PENDING') });
    else if (/already exists|já existe/i.test(r.error)) results.push({ event: ev, name: t.name, status: 'JÁ EXISTE' });
    else results.push({ event: ev, name: t.name, status: 'ERRO', error: r.error });
  }
  await applyDefaultTemplates();
  return { ok: true as const, results };
}

/** Status de aprovação dos templates na Meta (APPROVED, PENDING, REJECTED...). */
export async function templatesStatus() {
  const integ = await loadIntegration();
  if (!integ.token || !integ.config.businessAccountId)
    return { ok: false as const, error: 'Informe o WhatsApp Business Account ID e o token de acesso.' };
  const r = await graph(`${integ.config.businessAccountId}/message_templates?fields=name,status,language,rejected_reason&limit=200`, integ.token);
  if (!r.ok) return { ok: false as const, error: r.error };
  const data = (r.json.data ?? []) as { name: string; status: string; language: string; rejected_reason?: string }[];
  return { ok: true as const, templates: data.filter((d) => d.name.startsWith('pastelld_') || d.name === 'hello_world') };
}

export function verifyWebhookSignature(rawBody: Buffer, header: string | undefined): boolean {
  if (!env.WHATSAPP_APP_SECRET) return false;
  if (!header?.startsWith('sha256=')) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', env.WHATSAPP_APP_SECRET).update(rawBody).digest('hex');
  return timingSafeEqualStr(expected, header);
}

/** Processa atualizações de status de mensagens (sent/delivered/read/failed). */
export async function handleWebhook(body: unknown) {
  const b = body as { entry?: { changes?: { value?: { statuses?: { id: string; status: string; errors?: { title?: string }[] }[] } }[] }[] };
  const map: Record<string, 'SENT' | 'DELIVERED' | 'READ' | 'FAILED'> = {
    sent: 'SENT',
    delivered: 'DELIVERED',
    read: 'READ',
    failed: 'FAILED',
  };
  for (const entry of b.entry ?? [])
    for (const change of entry.changes ?? [])
      for (const s of change.value?.statuses ?? []) {
        const status = map[s.status];
        if (!status) continue;
        await prisma.whatsappNotification.updateMany({
          where: { providerMessageId: s.id },
          data: { status, lastError: status === 'FAILED' ? s.errors?.[0]?.title ?? 'Falha informada pelo WhatsApp' : undefined },
        });
      }
}
