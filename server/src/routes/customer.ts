import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { prisma } from '../db';
import { badRequest, conflict, notFound, unauthorized } from '../lib/errors';
import { audit } from '../lib/audit';
import {
  CUSTOMER_COOKIE,
  clearCookie,
  optionalCustomer,
  requireCustomer,
  setCustomerCookie,
} from '../middleware/auth';
import { loadCatalog } from '../services/catalog';
import { priceCart, type CartLineInput } from '../lib/pricing';
import { statusLabel } from '../lib/orderStatus';
import { phone, text, address as addressSchema } from './schemas';

export const customerRouter = Router();
customerRouter.use(optionalCustomer);

const authLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 20, standardHeaders: true, legacyHeaders: false, message: { error: { code: 'RATE_LIMIT', message: 'Muitas tentativas. Aguarde alguns minutos.' } } });

const password = z.string().min(8, 'A senha deve ter ao menos 8 caracteres').max(100);

function publicCustomer(c: { id: string; name: string; phone: string; email: string | null; whatsappOptIn: boolean }) {
  return { id: c.id, name: c.name, phone: c.phone, email: c.email, whatsappOptIn: c.whatsappOptIn };
}

customerRouter.post('/register', authLimiter, async (req, res) => {
  const body = z
    .object({
      name: text(80).min(2),
      phone,
      email: z.string().trim().toLowerCase().email().max(120).nullish().or(z.literal('').transform(() => null)),
      password,
      whatsappOptIn: z.boolean().default(false),
      privacyAccepted: z.literal(true, { errorMap: () => ({ message: 'É necessário aceitar a política de privacidade.' }) }),
    })
    .parse(req.body);
  const existing = await prisma.customer.findUnique({ where: { phone: body.phone } });
  if (existing?.passwordHash) throw conflict('PHONE_IN_USE', 'Já existe uma conta com este telefone. Faça login.');
  if (body.email) {
    const byEmail = await prisma.customer.findUnique({ where: { email: body.email } });
    if (byEmail && byEmail.id !== existing?.id) throw conflict('EMAIL_IN_USE', 'Este e-mail já está em uso.');
  }
  const passwordHash = await bcrypt.hash(body.password, 12);
  // Cadastro de visitante com o mesmo telefone é promovido a conta. Como o telefone não é
  // verificado por código, os pedidos anteriores de visitante NÃO são expostos na nova conta.
  if (existing) await prisma.order.updateMany({ where: { customerId: existing.id }, data: { customerId: null } });
  const c = existing
    ? await prisma.customer.update({
        where: { id: existing.id },
        data: { name: body.name, email: body.email ?? null, passwordHash, whatsappOptIn: body.whatsappOptIn, tokenVersion: { increment: 1 } },
      })
    : await prisma.customer.create({
        data: { name: body.name, phone: body.phone, email: body.email ?? null, passwordHash, whatsappOptIn: body.whatsappOptIn },
      });
  await audit({ kind: 'customer', id: c.id, ip: req.ip }, 'customer.register', 'customer', c.id);
  setCustomerCookie(res, c.id, c.tokenVersion);
  res.status(201).json(publicCustomer(c));
});

customerRouter.post('/login', authLimiter, async (req, res) => {
  const body = z.object({ login: z.string().trim().max(120), password: z.string().max(100) }).parse(req.body);
  const asPhone = body.login.includes('@') ? null : phone.safeParse(body.login);
  const c = asPhone?.success
    ? await prisma.customer.findUnique({ where: { phone: asPhone.data } })
    : await prisma.customer.findUnique({ where: { email: body.login.toLowerCase() } });
  if (!c?.passwordHash || c.anonymizedAt || !(await bcrypt.compare(body.password, c.passwordHash)))
    throw unauthorized('Telefone/e-mail ou senha incorretos.');
  setCustomerCookie(res, c.id, c.tokenVersion);
  res.json(publicCustomer(c));
});

customerRouter.post('/logout', (_req, res) => {
  clearCookie(res, CUSTOMER_COOKIE);
  res.json({ ok: true });
});

customerRouter.get('/me', async (req, res) => {
  if (!req.customerId) return res.json(null);
  const c = await prisma.customer.findUniqueOrThrow({ where: { id: req.customerId }, include: { addresses: { orderBy: { createdAt: 'desc' } } } });
  res.json({ ...publicCustomer(c), addresses: c.addresses });
});

customerRouter.put('/me', requireCustomer, async (req, res) => {
  const body = z
    .object({
      name: text(80).min(2),
      email: z.string().trim().toLowerCase().email().max(120).nullable().or(z.literal('').transform(() => null)),
      whatsappOptIn: z.boolean(),
      newPassword: password.optional(),
      currentPassword: z.string().max(100).optional(),
    })
    .parse(req.body);
  const c = await prisma.customer.findUniqueOrThrow({ where: { id: req.customerId } });
  const data: Record<string, unknown> = { name: body.name, email: body.email, whatsappOptIn: body.whatsappOptIn };
  if (body.newPassword) {
    if (!c.passwordHash || !body.currentPassword || !(await bcrypt.compare(body.currentPassword, c.passwordHash)))
      throw badRequest('WRONG_PASSWORD', 'Senha atual incorreta.');
    data.passwordHash = await bcrypt.hash(body.newPassword, 12);
    data.tokenVersion = { increment: 1 };
  }
  const updated = await prisma.customer.update({ where: { id: c.id }, data });
  if (body.newPassword) setCustomerCookie(res, updated.id, updated.tokenVersion);
  res.json(publicCustomer(updated));
});

/** LGPD: exclusão da conta com anonimização dos dados pessoais (registros fiscais/financeiros são mantidos sem identificação). */
customerRouter.delete('/me', requireCustomer, async (req, res) => {
  const id = req.customerId!;
  await prisma.$transaction([
    prisma.customerAddress.deleteMany({ where: { customerId: id } }),
    prisma.favorite.deleteMany({ where: { customerId: id } }),
    prisma.order.updateMany({
      where: { customerId: id },
      data: {
        customerName: 'Cliente removido',
        customerPhone: null,
        addressStreet: null,
        addressNumber: null,
        addressComplement: null,
        addressReference: null,
        whatsappOptIn: false,
      },
    }),
    prisma.customer.update({
      where: { id },
      data: { name: 'Cliente removido', phone: `removido-${id}`, email: null, passwordHash: null, whatsappOptIn: false, anonymizedAt: new Date(), tokenVersion: { increment: 1 } },
    }),
  ]);
  await audit({ kind: 'customer', id, ip: req.ip }, 'customer.anonymize', 'customer', id);
  clearCookie(res, CUSTOMER_COOKIE);
  res.json({ ok: true });
});

customerRouter.post('/addresses', requireCustomer, async (req, res) => {
  const body = addressSchema.extend({ label: text(40).nullish() }).parse(req.body);
  const count = await prisma.customerAddress.count({ where: { customerId: req.customerId } });
  if (count >= 10) throw badRequest('TOO_MANY', 'Limite de 10 endereços.');
  const a = await prisma.customerAddress.create({
    data: { customerId: req.customerId!, label: body.label ?? null, street: body.street, number: body.number, neighborhood: body.neighborhood, complement: body.complement ?? null, reference: body.reference ?? null, deliveryAreaId: body.deliveryAreaId },
  });
  res.status(201).json(a);
});

customerRouter.delete('/addresses/:id', requireCustomer, async (req, res) => {
  const r = await prisma.customerAddress.deleteMany({ where: { id: String(req.params.id), customerId: req.customerId } });
  if (!r.count) throw notFound();
  res.json({ ok: true });
});

customerRouter.get('/orders', requireCustomer, async (req, res) => {
  const orders = await prisma.order.findMany({
    where: { customerId: req.customerId },
    orderBy: { createdAt: 'desc' },
    take: 50,
    include: { items: true },
  });
  res.json(
    orders.map((o) => ({
      number: o.number,
      publicToken: o.publicToken,
      type: o.type,
      status: o.status,
      statusLabel: statusLabel(o.type, o.status),
      totalCents: o.totalCents,
      createdAt: o.createdAt,
      items: o.items.filter((i) => !i.canceledAt).map((i) => ({ name: i.name, quantity: i.quantity, description: i.description })),
    })),
  );
});

/** Repetir pedido: devolve itens com preço e disponibilidade atuais (indisponíveis vêm sinalizados). */
customerRouter.post('/orders/:token/reorder', requireCustomer, async (req, res) => {
  const order = await prisma.order.findFirst({ where: { publicToken: String(req.params.token), customerId: req.customerId }, include: { items: true } });
  if (!order) throw notFound('Pedido não encontrado.');
  const catalog = await loadCatalog(prisma);
  const lines: { line: CartLineInput; ok: boolean; reason?: string; name: string }[] = [];
  for (const i of order.items.filter((x) => !x.canceledAt)) {
    let line: CartLineInput | null = null;
    if (i.kind === 'PRODUCT' && i.productId) line = { type: 'product', productId: i.productId, optionId: i.optionId, quantity: i.quantity, notes: i.notes };
    if (i.kind === 'COMBO' && i.comboId && i.selections) {
      const sel = i.selections as { pastels: { productId: string; optionId: string | null; quantity: number }[]; drinks: { productId: string; optionId: string | null; quantity: number }[] };
      line = { type: 'combo', comboId: i.comboId, quantity: i.quantity, pastels: sel.pastels, drinks: sel.drinks, notes: i.notes };
    }
    if (!line) {
      lines.push({ line: null as never, ok: false, reason: 'Item não existe mais no cardápio', name: i.name });
      continue;
    }
    try {
      const priced = priceCart(catalog, [line]);
      lines.push({ line, ok: true, name: priced.lines[0].name });
    } catch (e) {
      lines.push({ line, ok: false, reason: (e as Error).message, name: i.name });
    }
  }
  res.json(lines);
});

customerRouter.get('/favorites', requireCustomer, async (req, res) => {
  const favs = await prisma.favorite.findMany({ where: { customerId: req.customerId }, select: { productId: true } });
  res.json(favs.map((f) => f.productId));
});

customerRouter.put('/favorites/:productId', requireCustomer, async (req, res) => {
  const productId = String(req.params.productId);
  const p = await prisma.product.findFirst({ where: { id: productId, deletedAt: null } });
  if (!p) throw notFound();
  await prisma.favorite.upsert({
    where: { customerId_productId: { customerId: req.customerId!, productId } },
    create: { customerId: req.customerId!, productId },
    update: {},
  });
  res.json({ ok: true });
});

customerRouter.delete('/favorites/:productId', requireCustomer, async (req, res) => {
  await prisma.favorite.deleteMany({ where: { customerId: req.customerId, productId: String(req.params.productId) } });
  res.json({ ok: true });
});
