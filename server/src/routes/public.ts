import { Router } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { prisma } from '../db';
import { badRequest, notFound } from '../lib/errors';
import { couponDiscount, deliveryFee, priceCart } from '../lib/pricing';
import { startOfLocalDay } from '../lib/hours';
import { loadCatalog, publicMenu, storeStatus } from '../services/catalog';
import { cancelOrder, createOrder, orderInclude, publicOrderView } from '../services/orders';
import { optionalCustomer } from '../middleware/auth';
import { address, cartItems, idempotencyKey, paymentMethod, phone, text } from './schemas';

export const publicRouter = Router();

const orderLimiter = rateLimit({ windowMs: 10 * 60_000, limit: 20, standardHeaders: true, legacyHeaders: false, message: { error: { code: 'RATE_LIMIT', message: 'Muitas tentativas. Aguarde alguns minutos.' } } });
const lookupLimiter = rateLimit({ windowMs: 10 * 60_000, limit: 15, standardHeaders: true, legacyHeaders: false, message: { error: { code: 'RATE_LIMIT', message: 'Muitas tentativas. Aguarde alguns minutos.' } } });

publicRouter.get('/store', async (_req, res) => {
  const { settings, ranges, state } = await storeStatus();
  const areas = await prisma.deliveryArea.findMany({
    where: { active: true },
    orderBy: { neighborhood: 'asc' },
    select: { id: true, neighborhood: true, feeCents: true, minOrderCents: true },
  });
  res.json({
    store: settings.store,
    delivery: {
      enabled: settings.delivery.enabled,
      pickupEnabled: settings.delivery.pickupEnabled,
      minOrderCents: settings.delivery.minOrderCents,
      freeDeliveryAboveCents: settings.delivery.freeDeliveryAboveCents,
      allowOutsideArea: settings.delivery.allowOutsideArea,
      outsideAreaFeeCents: settings.delivery.outsideAreaFeeCents,
      defaultPrepMinutes: settings.delivery.defaultPrepMinutes,
      areas,
    },
    payment: {
      methods: settings.payment.methods,
      pixKey: settings.payment.pixKey,
      pixKeyType: settings.payment.pixKeyType,
      pixHolderName: settings.payment.pixHolderName,
      pixInstructions: settings.payment.pixInstructions,
    },
    hours: ranges,
    open: state,
    acceptOutsideHours: settings.hours.acceptOutsideHours,
    acceptScheduled: settings.hours.acceptScheduled,
    closedMessage: settings.hours.closedMessage,
  });
});

publicRouter.get('/menu', async (_req, res) => {
  const { settings } = await storeStatus();
  res.set('Cache-Control', 'no-store');
  res.json(await publicMenu(startOfLocalDay(new Date(), settings.store.timezone)));
});

const quoteSchema = z.object({
  type: z.enum(['DELIVERY', 'PICKUP', 'TABLE']),
  items: cartItems,
  couponCode: text(40).nullish(),
  deliveryAreaId: z.string().max(40).nullish(),
});

/** Cotação do carrinho calculada no servidor (o navegador só exibe). */
publicRouter.post('/cart/quote', async (req, res) => {
  const body = quoteSchema.parse(req.body);
  const { settings } = await storeStatus();
  const catalog = await loadCatalog(prisma);
  const priced = priceCart(catalog, body.items);
  let discountCents = 0;
  let couponError: string | null = null;
  if (body.couponCode && body.type !== 'TABLE') {
    const coupon = await prisma.coupon.findUnique({ where: { code: body.couponCode.trim().toUpperCase() } });
    try {
      if (!coupon) throw badRequest('COUPON_INVALID', 'Cupom inválido.');
      discountCents = couponDiscount(coupon, priced.itemsTotalCents, new Date());
    } catch (e) {
      couponError = (e as Error).message;
    }
  }
  let deliveryFeeCents = 0;
  let deliveryError: string | null = null;
  if (body.type === 'DELIVERY') {
    const area = body.deliveryAreaId ? await prisma.deliveryArea.findUnique({ where: { id: body.deliveryAreaId } }) : null;
    try {
      deliveryFeeCents = deliveryFee(settings.delivery, area, priced.itemsTotalCents - discountCents);
    } catch (e) {
      deliveryError = (e as Error).message;
    }
  }
  res.json({
    lines: priced.lines.map((l) => ({
      name: l.name,
      description: l.description,
      quantity: l.quantity,
      unitPriceCents: l.unitPriceCents,
      unitRegularCents: l.unitRegularCents,
      totalCents: l.totalCents,
      savingsCents: l.savingsCents,
    })),
    grossCents: priced.grossCents,
    savingsCents: priced.savingsCents,
    itemsTotalCents: priced.itemsTotalCents,
    discountCents,
    couponError,
    deliveryFeeCents,
    deliveryError,
    totalCents: priced.itemsTotalCents - discountCents + deliveryFeeCents,
  });
});

const orderSchema = z
  .object({
    type: z.enum(['DELIVERY', 'PICKUP']),
    items: cartItems,
    customer: z.object({ name: text(80).min(2, 'Informe seu nome'), phone }),
    whatsappOptIn: z.boolean().default(false),
    address: address.nullish(),
    saveAddress: z.boolean().optional(),
    paymentMethod,
    changeForCents: z.number().int().min(0).max(10_000_000).nullish(),
    couponCode: text(40).nullish(),
    notes: text(500).nullish(),
    scheduledFor: z.string().datetime().nullish(),
    privacyAccepted: z.literal(true, { errorMap: () => ({ message: 'É necessário aceitar a política de privacidade.' }) }),
  })
  .refine((o) => o.type !== 'DELIVERY' || !!o.address, { message: 'Informe o endereço de entrega', path: ['address'] });

publicRouter.post('/orders', orderLimiter, optionalCustomer, async (req, res) => {
  const body = orderSchema.parse(req.body);
  const key = idempotencyKey.parse(req.get('idempotency-key') ?? undefined);
  const order = await createOrder(
    {
      type: body.type,
      items: body.items,
      customerName: body.customer.name,
      customerPhone: body.customer.phone,
      whatsappOptIn: body.whatsappOptIn,
      address: body.type === 'DELIVERY' ? body.address! : null,
      saveAddress: body.saveAddress,
      paymentMethod: body.paymentMethod,
      changeForCents: body.changeForCents,
      couponCode: body.couponCode,
      notes: body.notes,
      scheduledFor: body.scheduledFor ? new Date(body.scheduledFor) : null,
      idempotencyKey: key ?? null,
    },
    { actor: req.customerId ? { kind: 'customer', id: req.customerId, ip: req.ip } : { kind: 'system', ip: req.ip }, customerId: req.customerId },
  );
  res.status(201).json(publicOrderView(order));
});

publicRouter.get('/orders/track/:token', async (req, res) => {
  const order = await prisma.order.findUnique({ where: { publicToken: String(req.params.token) }, include: orderInclude });
  if (!order) throw notFound('Pedido não encontrado.');
  res.set('Cache-Control', 'no-store');
  res.json(publicOrderView(order));
});

publicRouter.post('/orders/track/:token/cancel', async (req, res) => {
  const { reason } = z.object({ reason: text(200).optional() }).parse(req.body ?? {});
  const order = await prisma.order.findUnique({ where: { publicToken: String(req.params.token) } });
  if (!order || order.type === 'TABLE') throw notFound('Pedido não encontrado.');
  const updated = await cancelOrder(order.id, reason?.trim() || 'Cancelado pelo cliente', { kind: 'customer', id: order.customerId ?? undefined, ip: req.ip }, { byCustomer: true, onlyPending: true });
  res.json(publicOrderView(updated));
});

/** Localiza pedido por número + telefone (área "Acompanhe seu pedido"). */
publicRouter.post('/orders/lookup', lookupLimiter, async (req, res) => {
  const body = z.object({ number: z.coerce.number().int().positive(), phone }).parse(req.body);
  const order = await prisma.order.findFirst({ where: { number: body.number, customerPhone: body.phone }, select: { publicToken: true } });
  if (!order) throw notFound('Não encontramos um pedido com esse número e telefone.');
  res.json({ publicToken: order.publicToken });
});
