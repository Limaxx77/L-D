import { z } from 'zod';
import { prisma } from '../db';
import { publicImageUrl } from './storage';

const cents = z.number().int().min(0).max(10_000_000);

export const settingsSchemas = {
  store: z.object({
    name: z.string().min(1).max(80),
    tagline: z.string().max(120),
    whatsapp: z.string().regex(/^\d{12,13}$/, 'Use DDI+DDD+número, ex.: 5565992638816'),
    address: z.string().max(200),
    instagram: z.string().max(120),
    facebook: z.string().max(120),
    logoUrl: z.string().max(500).nullable(),
    bannerUrl: z.string().max(500).nullable(),
    timezone: z.string().max(60),
  }),
  delivery: z.object({
    enabled: z.boolean(),
    pickupEnabled: z.boolean(),
    minOrderCents: cents.nullable(),
    freeDeliveryAboveCents: cents.nullable(),
    allowOutsideArea: z.boolean(),
    outsideAreaFeeCents: cents.nullable(),
    defaultPrepMinutes: z.number().int().min(5).max(300),
  }),
  hours: z.object({
    paused: z.boolean(),
    pausedUntil: z.string().datetime().nullable(),
    acceptOutsideHours: z.boolean(),
    acceptScheduled: z.boolean(),
    closedMessage: z.string().max(300),
  }),
  payment: z.object({
    pixKey: z.string().max(140),
    pixKeyType: z.enum(['', 'CPF', 'CNPJ', 'EMAIL', 'PHONE', 'RANDOM']),
    pixHolderName: z.string().max(120),
    pixInstructions: z.string().max(500),
    methods: z.object({
      PIX: z.boolean(),
      CASH: z.boolean(),
      DEBIT: z.boolean(),
      CREDIT: z.boolean(),
      IN_PERSON: z.boolean(),
    }),
  }),
  tables: z.object({
    autoOpenOnJoin: z.boolean(),
    requireAcceptForTableOrders: z.boolean(),
  }),
  messages: z.object({
    ORDER_RECEIVED: z.string().max(1000),
    ORDER_ACCEPTED: z.string().max(1000),
    ORDER_PREPARING: z.string().max(1000),
    ORDER_READY: z.string().max(1000),
    ORDER_OUT_FOR_DELIVERY: z.string().max(1000),
    ORDER_DELIVERED: z.string().max(1000),
    ORDER_CANCELED: z.string().max(1000),
  }),
};

export type Settings = { [K in keyof typeof settingsSchemas]: z.infer<(typeof settingsSchemas)[K]> };
export type SettingsKey = keyof Settings;

export const DEFAULT_SETTINGS: Settings = {
  store: {
    name: 'Pastel L&D',
    tagline: 'Pastel quentinho, crocante e cheio de sabor!',
    whatsapp: '5587981076022', // número de teste; o oficial (5565992638816) será ativado depois
    address: '',
    instagram: '',
    facebook: '',
    logoUrl: null,
    bannerUrl: null,
    timezone: 'America/Cuiaba',
  },
  delivery: {
    enabled: true,
    pickupEnabled: true,
    minOrderCents: null,
    freeDeliveryAboveCents: 3500, // entrega grátis a partir de R$ 35,00
    allowOutsideArea: false,
    outsideAreaFeeCents: null,
    defaultPrepMinutes: 40,
  },
  hours: {
    paused: false,
    pausedUntil: null,
    acceptOutsideHours: false,
    acceptScheduled: false,
    closedMessage:
      'Estamos fechados no momento. Confira nosso horário de funcionamento e volte para pedir seu pastel favorito!',
  },
  payment: {
    pixKey: '',
    pixKeyType: '',
    pixHolderName: '',
    pixInstructions: 'Após o pagamento, envie o comprovante pelo WhatsApp. O atendente confirmará o recebimento.',
    methods: { PIX: true, CASH: true, DEBIT: true, CREDIT: true, IN_PERSON: true },
  },
  tables: {
    autoOpenOnJoin: true,
    requireAcceptForTableOrders: true,
  },
  messages: {
    ORDER_RECEIVED:
      'Olá, [NOME]! Recebemos seu pedido #[NÚMERO] na Pastel L&D.\n\nItens: [RESUMO]\nTotal: R$ [VALOR]\n\nAguarde a confirmação. Acompanhe: [LINK]',
    ORDER_ACCEPTED:
      'Olá, [NOME]! 🍕🥟\n\nSeu pedido na Pastel L&D foi ACEITO com sucesso!\n\nPedido: #[NÚMERO]\n\nItens: [RESUMO]\n\nTotal: R$ [VALOR]\n\nTempo estimado: [TEMPO] minutos.\n\nJá estamos preparando tudo com muito carinho!\n\nObrigado por escolher a Pastel L&D!',
    ORDER_PREPARING: 'Olá, [NOME]! Seu pedido #[NÚMERO] está em preparação. 🥟',
    ORDER_READY: 'Olá, [NOME]! Seu pedido #[NÚMERO] está [STATUS]! 🎉',
    ORDER_OUT_FOR_DELIVERY: 'Olá, [NOME]! Seu pedido #[NÚMERO] saiu para entrega. 🛵',
    ORDER_DELIVERED: 'Olá, [NOME]! Seu pedido #[NÚMERO] foi finalizado. Obrigado por escolher a Pastel L&D! 💛',
    ORDER_CANCELED:
      'Olá, [NOME].\n\nInfelizmente, não conseguimos aceitar seu pedido #[NÚMERO] na Pastel L&D.\n\nMotivo: [MOTIVO].\n\nPedimos desculpas pelo inconveniente.\n\nCaso queira falar conosco:\n[WHATSAPP].',
  },
};

let cache: { at: number; value: Settings } | null = null;
const TTL_MS = 15_000;

export async function getSettings(): Promise<Settings> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
  const rows = await prisma.setting.findMany();
  const value = structuredClone(DEFAULT_SETTINGS) as Settings;
  for (const row of rows) {
    const key = row.key as SettingsKey;
    if (!(key in settingsSchemas)) continue;
    const merged = { ...(DEFAULT_SETTINGS[key] as object), ...(row.value as object) };
    const parsed = settingsSchemas[key].safeParse(merged);
    if (parsed.success) (value as Record<string, unknown>)[key] = parsed.data;
  }
  value.store.logoUrl = publicImageUrl(value.store.logoUrl);
  value.store.bannerUrl = publicImageUrl(value.store.bannerUrl);
  cache = { at: Date.now(), value };
  return value;
}

export async function saveSettings<K extends SettingsKey>(key: K, value: Settings[K]) {
  const parsed = settingsSchemas[key].parse(value);
  await prisma.setting.upsert({
    where: { key },
    create: { key, value: parsed as object },
    update: { value: parsed as object },
  });
  cache = null;
  return parsed;
}

export function invalidateSettings() {
  cache = null;
}
