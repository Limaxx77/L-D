import { Router, type Request } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { forbidden, notFound } from '../lib/errors';
import { prisma } from '../db';
import {
  addPerson,
  billOf,
  currentSession,
  joinTable,
  loadSession,
  participantFromToken,
  requestClose,
  serializeSession,
  tableByToken,
} from '../services/tables';
import { cancelOrder, createOrder } from '../services/orders';
import { allocation, cartItems, idempotencyKey, splitConfig, splitMode, text } from './schemas';

/**
 * Rotas públicas da mesa (acesso pelo link do cartão NFC / QR Code).
 * O link carrega um token aleatório da mesa; cada aparelho recebe um token de participante
 * (enviado no cabeçalho X-Participant-Token) que identifica quem está pedindo.
 */
export const tableRouter = Router();

const joinLimiter = rateLimit({ windowMs: 10 * 60_000, limit: 20, standardHeaders: true, legacyHeaders: false, message: { error: { code: 'RATE_LIMIT', message: 'Muitas tentativas. Aguarde alguns minutos.' } } });
const orderLimiter = rateLimit({ windowMs: 10 * 60_000, limit: 40, standardHeaders: true, legacyHeaders: false, message: { error: { code: 'RATE_LIMIT', message: 'Muitas tentativas. Aguarde alguns minutos.' } } });

const participantToken = (req: Request) => req.get('x-participant-token') ?? undefined;

async function me(req: Request) {
  return participantFromToken(participantToken(req));
}

tableRouter.get('/t/:token', async (req, res) => {
  const table = await tableByToken(String(req.params.token));
  const session = await currentSession(table.id);
  let participantId: string | null = null;
  const tok = participantToken(req);
  if (tok && session) {
    try {
      const p = await participantFromToken(tok);
      if (p.sessionId === session.id) participantId = p.id;
    } catch {
      /* token antigo: precisa entrar novamente */
    }
  }
  res.set('Cache-Control', 'no-store');
  res.json({
    table: { name: table.name, number: table.number },
    sessionOpen: !!session,
    participantId,
    session: session && participantId ? serializeSession(session, { forParticipantId: participantId }) : null,
  });
});

tableRouter.post('/t/:token/join', joinLimiter, async (req, res) => {
  const { name } = z.object({ name: text(40).min(2, 'Informe seu nome') }).parse(req.body);
  const r = await joinTable(String(req.params.token), name, req.ip);
  res.status(201).json(r);
});

tableRouter.get('/session', async (req, res) => {
  const p = await me(req);
  res.set('Cache-Control', 'no-store');
  res.json(serializeSession(await loadSession(p.sessionId), { forParticipantId: p.id }));
});

tableRouter.post('/session/people', async (req, res) => {
  const p = await me(req);
  const { name } = z.object({ name: text(40).min(2, 'Informe o nome') }).parse(req.body);
  const person = await addPerson(p.sessionId, name, { kind: 'participant', id: p.id, ip: req.ip }, p.id);
  res.status(201).json({ id: person.id, name: person.name });
});

tableRouter.post('/session/orders', orderLimiter, async (req, res) => {
  const p = await me(req);
  const body = z
    .object({ items: cartItems, allocations: z.array(allocation).max(60), notes: text(300).nullish() })
    .parse(req.body);
  const key = idempotencyKey.parse(req.get('idempotency-key') ?? undefined);
  const order = await createOrder(
    {
      type: 'TABLE',
      items: body.items,
      customerName: `${p.session.table.name} · ${p.name}`,
      customerPhone: null,
      whatsappOptIn: false,
      paymentMethod: 'IN_PERSON',
      notes: body.notes,
      idempotencyKey: key ?? null,
      table: { sessionId: p.sessionId, placedByParticipantId: p.id, allocations: body.allocations },
    },
    { actor: { kind: 'participant', id: p.id, ip: req.ip } },
  );
  res.status(201).json({ id: order.id, number: order.number, status: order.status });
});

tableRouter.post('/session/orders/:orderId/cancel', async (req, res) => {
  const p = await me(req);
  const order = await prisma.order.findUnique({ where: { id: String(req.params.orderId) } });
  if (!order || order.tableSessionId !== p.sessionId) throw notFound('Pedido não encontrado.');
  if (order.placedByParticipantId !== p.id) throw forbidden('Somente quem fez o pedido pode cancelá-lo.');
  await cancelOrder(order.id, `Cancelado por ${p.name} (mesa)`, { kind: 'participant', id: p.id, ip: req.ip }, { onlyPending: true });
  res.json({ ok: true });
});

/** Simulação de divisão (não altera nada). */
tableRouter.post('/session/split-preview', async (req, res) => {
  const p = await me(req);
  const body = z.object({ mode: splitMode, config: splitConfig.optional() }).parse(req.body);
  const s = await loadSession(p.sessionId);
  res.json(billOf(s, body.mode, body.config ?? null));
});

tableRouter.post('/session/request-close', async (req, res) => {
  const p = await me(req);
  const body = z.object({ mode: splitMode, config: splitConfig.optional() }).parse(req.body);
  await requestClose(p.sessionId, body.mode, body.config ?? null, { kind: 'participant', id: p.id, ip: req.ip });
  res.json({ ok: true });
});
