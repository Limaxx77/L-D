import { z } from 'zod';
import { normalizePhoneBR } from '../lib/money';

export const id = z.string().min(1).max(40);
export const cents = z.number().int().min(0).max(10_000_000);
export const text = (max: number) => z.string().trim().max(max);

export const phone = z
  .string()
  .max(30)
  .transform((v, ctx) => {
    const n = normalizePhoneBR(v);
    if (!n) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Telefone inválido. Use DDD + número.' });
      return z.NEVER;
    }
    return n;
  });

const selection = z.object({ productId: id, optionId: id.nullish(), quantity: z.number().int().min(1).max(100) });

export const cartLine = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('product'),
    productId: id,
    optionId: id.nullish(),
    quantity: z.number().int().min(1).max(50),
    notes: text(300).nullish(),
  }),
  z.object({
    type: z.literal('combo'),
    comboId: id,
    quantity: z.number().int().min(1).max(10),
    pastels: z.array(selection).max(30),
    drinks: z.array(selection).max(30),
    notes: text(300).nullish(),
  }),
]);

export const cartItems = z.array(cartLine).min(1).max(60);

export const address = z.object({
  street: text(150).min(2, 'Informe a rua'),
  number: text(20).min(1, 'Informe o número'),
  neighborhood: text(80).min(2, 'Informe o bairro'),
  complement: text(100).nullish(),
  reference: text(150).nullish(),
  deliveryAreaId: id.nullable(),
});

export const paymentMethod = z.enum(['PIX', 'CASH', 'DEBIT', 'CREDIT', 'IN_PERSON']);

export const allocation = z.object({
  participants: z.array(z.object({ participantId: id, weight: z.number().int().min(1).max(100).optional() })).min(1).max(30),
});

export const splitMode = z.enum(['CONSUMPTION', 'EQUAL', 'CUSTOM']);
export const splitConfig = z
  .object({
    participantIds: z.array(id).max(30).optional(),
    items: z.record(id, z.record(id, z.number().int().min(1).max(100))).optional(),
  })
  .nullable();

export const idempotencyKey = z.string().regex(/^[\w-]{8,80}$/).optional();
