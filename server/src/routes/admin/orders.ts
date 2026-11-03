import { Router } from 'express';
import { z } from 'zod';
import type { OrderStatus, Prisma } from '@prisma/client';
import { prisma } from '../../db';
import { forbidden, notFound } from '../../lib/errors';
import { requirePerm, staffActor } from '../../middleware/auth';
import { getSettings } from '../../lib/settings';
import { startOfLocalDay } from '../../lib/hours';
import {
  acceptOrder,
  advanceOrder,
  assignCourier,
  cancelOrder,
  cancelOrderItem,
  confirmOrderPayment,
  createOrder,
  markRefunded,
  orderInclude,
  serializeOrder,
} from '../../services/orders';
import { manualLinkFor, EVENTS, type WhatsappEvent } from '../../services/whatsapp';
import { address, allocation, cartItems, idempotencyKey, paymentMethod, phone, text } from '../schemas';

export const adminOrdersRouter = Router();

const STATUSES = ['AWAITING_ACCEPT', 'ACCEPTED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY', 'DELIVERED', 'PICKED_UP', 'SERVED', 'CANCELED'] as const;

/** Lista para o painel (quadro) — pedidos ativos + finalizados de hoje. */
adminOrdersRouter.get('/board', requirePerm('orders.view'), async (_req, res) => {
  const tz = (await getSettings()).store.timezone;
  const today = startOfLocalDay(new Date(), tz);
  const orders = await prisma.order.findMany({
    where: {
      OR: [
        { status: { in: ['AWAITING_ACCEPT', 'ACCEPTED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY'] } },
        { updatedAt: { gte: today } },
      ],
    },
    include: orderInclude,
    orderBy: { createdAt: 'asc' },
    take: 300,
  });
  res.json(orders.map(serializeOrder));
});

adminOrdersRouter.get('/', requirePerm('orders.view'), async (req, res) => {
  const q = z
    .object({
      status: z.enum(STATUSES).optional(),
      type: z.enum(['DELIVERY', 'PICKUP', 'TABLE']).optional(),
      search: z.string().max(60).optional(),
      from: z.string().datetime().optional(),
      to: z.string().datetime().optional(),
      page: z.coerce.number().int().min(1).default(1),
    })
    .parse(req.query);
  const where: Prisma.OrderWhereInput = {
    status: q.status,
    type: q.type,
    createdAt: q.from || q.to ? { gte: q.from ? new Date(q.from) : undefined, lt: q.to ? new Date(q.to) : undefined } : undefined,
  };
  if (q.search) {
    const n = Number(q.search.replace('#', ''));
    where.OR = [
      ...(Number.isInteger(n) && n > 0 ? [{ number: n }] : []),
      { customerName: { contains: q.search, mode: 'insensitive' } },
      { customerPhone: { contains: q.search.replace(/\D/g, '') || '#' } },
    ];
  }
  const [total, orders] = await Promise.all([
    prisma.order.count({ where }),
    prisma.order.findMany({ where, include: orderInclude, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * 30, take: 30 }),
  ]);
  res.json({ total, page: q.page, pageSize: 30, orders: orders.map(serializeOrder) });
});

/** Entregas atribuídas ao entregador logado (somente dados necessários). */
adminOrdersRouter.get('/deliveries/mine', requirePerm('deliveries.own'), async (req, res) => {
  const orders = await prisma.order.findMany({
    where: { courierId: req.staff!.id, type: 'DELIVERY', status: { in: ['READY', 'OUT_FOR_DELIVERY', 'DELIVERED'] }, updatedAt: { gte: new Date(Date.now() - 24 * 3600_000) } },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true, number: true, status: true, customerName: true, customerPhone: true, whatsappOptIn: true,
      addressStreet: true, addressNumber: true, addressDistrict: true, addressComplement: true, addressReference: true,
      totalCents: true, paymentMethod: true, paymentStatus: true, changeForCents: true, notes: true,
      items: { where: { canceledAt: null }, select: { name: true, quantity: true, description: true } },
    },
  });
  res.json(orders);
});

adminOrdersRouter.get('/:id', requirePerm('orders.view', 'deliveries.own'), async (req, res) => {
  const order = await prisma.order.findUnique({ where: { id: String(req.params.id) }, include: orderInclude });
  if (!order) throw notFound();
  if (req.staff!.role === 'COURIER' && order.courierId !== req.staff!.id) throw forbidden();
  const notifications = await prisma.whatsappNotification.findMany({ where: { orderId: order.id }, orderBy: { createdAt: 'asc' } });
  res.json({ ...serializeOrder(order), notifications });
});

/** Link wa.me com a mensagem do evento, para envio manual pelo atendente. */
adminOrdersRouter.get('/:id/whatsapp-link', requirePerm('orders.manage', 'deliveries.own'), async (req, res) => {
  const event = z.enum(EVENTS).parse(req.query.event);
  const order = await prisma.order.findUnique({ where: { id: String(req.params.id) }, include: { items: true } });
  if (!order) throw notFound();
  if (req.staff!.role === 'COURIER' && order.courierId !== req.staff!.id) throw forbidden();
  res.json({ url: await manualLinkFor(order, event as WhatsappEvent) });
});

adminOrdersRouter.post('/:id/accept', requirePerm('orders.manage'), async (req, res) => {
  const { minutes } = z.object({ minutes: z.number().int().min(1).max(600).nullable() }).parse(req.body);
  res.json(serializeOrder(await acceptOrder(String(req.params.id), minutes, staffActor(req))));
});

adminOrdersRouter.post('/:id/refuse', requirePerm('orders.manage'), async (req, res) => {
  const { reason } = z.object({ reason: text(300).min(3, 'Informe o motivo') }).parse(req.body);
  res.json(serializeOrder(await cancelOrder(String(req.params.id), reason, staffActor(req))));
});

adminOrdersRouter.post('/:id/status', requirePerm('orders.advance'), async (req, res) => {
  const { status } = z.object({ status: z.enum(STATUSES) }).parse(req.body);
  const order = await advanceOrder(String(req.params.id), status as OrderStatus, { ...staffActor(req), role: req.staff!.role });
  res.json(serializeOrder(order));
});

adminOrdersRouter.post('/:id/courier', requirePerm('orders.manage'), async (req, res) => {
  const { courierId } = z.object({ courierId: z.string().max(40).nullable() }).parse(req.body);
  res.json(serializeOrder(await assignCourier(String(req.params.id), courierId, staffActor(req))));
});

adminOrdersRouter.post('/:id/payments', requirePerm('payments.manage'), async (req, res) => {
  const body = z.object({ method: paymentMethod, amountCents: z.number().int().min(1), notes: text(200).nullish() }).parse(req.body);
  const key = idempotencyKey.parse(req.get('idempotency-key') ?? undefined);
  res.json(serializeOrder(await confirmOrderPayment(String(req.params.id), { ...body, idempotencyKey: key }, staffActor(req))));
});

adminOrdersRouter.post('/:id/refunded', requirePerm('payments.manage'), async (req, res) => {
  res.json(serializeOrder(await markRefunded(String(req.params.id), staffActor(req))));
});

adminOrdersRouter.post('/items/:itemId/cancel', requirePerm('orders.manage'), async (req, res) => {
  const { reason } = z.object({ reason: text(200).min(3, 'Informe o motivo') }).parse(req.body);
  res.json(serializeOrder(await cancelOrderItem(String(req.params.itemId), reason, staffActor(req))));
});

/** Pedido lançado pela equipe (balcão, telefone ou mesa). */
adminOrdersRouter.post('/', requirePerm('orders.manage'), async (req, res) => {
  const body = z
    .object({
      type: z.enum(['DELIVERY', 'PICKUP', 'TABLE']),
      items: cartItems,
      customer: z.object({ name: text(80).min(2), phone: phone.nullish() }),
      address: address.nullish(),
      paymentMethod,
      changeForCents: z.number().int().min(0).nullish(),
      notes: text(500).nullish(),
      whatsappOptIn: z.boolean().default(false),
      table: z.object({ sessionId: z.string().max(40), allocations: z.array(allocation).max(60) }).nullish(),
    })
    .parse(req.body);
  const key = idempotencyKey.parse(req.get('idempotency-key') ?? undefined);
  const order = await createOrder(
    {
      type: body.type,
      items: body.items,
      customerName: body.customer.name,
      customerPhone: body.customer.phone ?? null,
      whatsappOptIn: body.whatsappOptIn,
      address: body.address ?? null,
      paymentMethod: body.type === 'TABLE' ? 'IN_PERSON' : body.paymentMethod,
      changeForCents: body.changeForCents,
      notes: body.notes,
      idempotencyKey: key ?? null,
      table: body.table ? { sessionId: body.table.sessionId, placedByParticipantId: null, allocations: body.table.allocations } : undefined,
    },
    { actor: staffActor(req), staff: true },
  );
  res.status(201).json(serializeOrder(order));
});
