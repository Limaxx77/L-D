import { Prisma, type OrderStatus, type OrderType, type PaymentMethod, type RoleKey } from '@prisma/client';
import { prisma, withTx, type Tx } from '../db';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { couponDiscount, deliveryFee, priceCart, type CartLineInput } from '../lib/pricing';
import { canAdvance, FINAL_STATUSES, notificationEvent, statusLabel } from '../lib/orderStatus';
import { randomToken } from '../lib/crypto';
import { audit, type Actor } from '../lib/audit';
import { isWithinHours, startOfLocalDay } from '../lib/hours';
import { comboSoldToday, loadCatalog, storeStatus } from './catalog';
import { notifyOrder, type WhatsappEvent } from './whatsapp';
import { realtime } from '../realtime';

export const orderInclude = {
  items: { include: { allocations: { include: { participant: { select: { id: true, name: true } } } } } },
  statusHistory: { orderBy: { createdAt: 'asc' } },
  payments: { where: { status: { not: 'VOIDED' } } },
  courier: { select: { id: true, name: true } },
  tableSession: { select: { id: true, table: { select: { id: true, name: true, number: true } } } },
  placedByParticipant: { select: { id: true, name: true } },
} satisfies Prisma.OrderInclude;

export type FullOrder = Prisma.OrderGetPayload<{ include: typeof orderInclude }>;

export interface LineAllocation {
  /** Participantes que dividem o item (pesos opcionais; padrão 1 cada). */
  participants: { participantId: string; weight?: number }[];
}

export interface CreateOrderInput {
  type: OrderType;
  items: CartLineInput[];
  customerName: string;
  customerPhone: string | null;
  whatsappOptIn: boolean;
  address?: {
    street: string;
    number: string;
    neighborhood: string;
    complement?: string | null;
    reference?: string | null;
    deliveryAreaId: string | null;
  } | null;
  paymentMethod: PaymentMethod;
  changeForCents?: number | null;
  couponCode?: string | null;
  notes?: string | null;
  scheduledFor?: Date | null;
  idempotencyKey?: string | null;
  saveAddress?: boolean;
  table?: { sessionId: string; placedByParticipantId: string | null; allocations: LineAllocation[] };
}

export interface CreateContext {
  actor: Actor;
  customerId?: string | null;
  /** Pedido lançado pela equipe (ignora horário de funcionamento). */
  staff?: boolean;
}

export async function findByIdempotencyKey(key: string) {
  return prisma.order.findUnique({ where: { idempotencyKey: key }, include: orderInclude });
}

async function restock(tx: Tx, items: { productId: string | null; quantity: number; selections: Prisma.JsonValue; kind: string; canceledAt: Date | null }[]) {
  const usage = new Map<string, number>();
  for (const it of items) {
    if (it.canceledAt) continue;
    if (it.kind === 'PRODUCT' && it.productId) usage.set(it.productId, (usage.get(it.productId) ?? 0) + it.quantity);
    if (it.kind === 'COMBO' && it.selections) {
      const sel = it.selections as { pastels?: { productId: string; quantity: number }[]; drinks?: { productId: string; quantity: number }[] };
      for (const s of [...(sel.pastels ?? []), ...(sel.drinks ?? [])])
        usage.set(s.productId, (usage.get(s.productId) ?? 0) + s.quantity * it.quantity);
    }
  }
  for (const [id, q] of usage) {
    await tx.product.updateMany({ where: { id, stockQty: { not: null } }, data: { stockQty: { increment: q } } });
  }
}

export async function createOrder(input: CreateOrderInput, ctx: CreateContext): Promise<FullOrder> {
  if (input.idempotencyKey) {
    const existing = await findByIdempotencyKey(input.idempotencyKey);
    if (existing) return existing;
  }
  const { settings, ranges, state } = await storeStatus();
  const now = new Date();

  // Horário de funcionamento / agendamento
  let scheduledFor: Date | null = null;
  if (!ctx.staff) {
    if (input.scheduledFor) {
      if (!settings.hours.acceptScheduled) throw badRequest('SCHEDULE_DISABLED', 'Não estamos aceitando pedidos agendados.');
      const t = input.scheduledFor;
      if (t.getTime() < now.getTime() + 15 * 60_000 || t.getTime() > now.getTime() + 7 * 86_400_000)
        throw badRequest('SCHEDULE_INVALID', 'Escolha um horário entre 15 minutos e 7 dias a partir de agora.');
      if (!isWithinHours(t, ranges, settings.store.timezone))
        throw badRequest('SCHEDULE_OUTSIDE_HOURS', 'O horário agendado está fora do nosso horário de funcionamento.');
      scheduledFor = t;
    } else if (!state.open && !(state.reason === 'CLOSED' && settings.hours.acceptOutsideHours)) {
      throw badRequest('STORE_CLOSED', settings.hours.closedMessage);
    }
  }

  if (!settings.payment.methods[input.paymentMethod])
    throw badRequest('PAYMENT_METHOD_DISABLED', 'Forma de pagamento indisponível.');
  if (input.type === 'PICKUP' && !settings.delivery.pickupEnabled && !ctx.staff)
    throw badRequest('PICKUP_DISABLED', 'Retirada no local indisponível no momento.');
  if (input.type === 'DELIVERY' && !input.address) throw badRequest('ADDRESS_REQUIRED', 'Informe o endereço de entrega.');
  if (input.type !== 'TABLE' && !input.customerPhone && !ctx.staff) throw badRequest('PHONE_REQUIRED', 'Informe seu telefone/WhatsApp.');
  if (input.type === 'TABLE' && !input.table) throw badRequest('TABLE_REQUIRED', 'Mesa não identificada.');
  if (input.type === 'TABLE' && input.couponCode) throw badRequest('COUPON_NOT_ALLOWED', 'Cupons não se aplicam a pedidos na mesa.');
  if (input.table && input.table.allocations.length !== input.items.length)
    throw badRequest('ALLOCATION_REQUIRED', 'Informe para quem é cada item.');

  const comboIds = [...new Set(input.items.filter((i) => i.type === 'combo').map((i) => (i as { comboId: string }).comboId))];
  const dayStart = startOfLocalDay(now, settings.store.timezone);

  let order: FullOrder;
  try {
    order = await withTx(async (tx) => {
      const catalog = await loadCatalog(tx, comboIds);
      const priced = priceCart(catalog, input.items);

      // Limite diário de combos (combos bloqueados acima garantem consistência sob concorrência)
      const sold = await comboSoldToday(tx, comboIds, dayStart);
      for (const [comboId, qty] of priced.comboUsage) {
        const combo = await tx.combo.findUniqueOrThrow({ where: { id: comboId } });
        if (combo.dailyLimit !== null && (sold.get(comboId) ?? 0) + qty > combo.dailyLimit) {
          const left = Math.max(0, combo.dailyLimit - (sold.get(comboId) ?? 0));
          throw badRequest('COMBO_DAILY_LIMIT', left ? `Restam apenas ${left} unidade(s) do ${combo.name} hoje.` : `O ${combo.name} esgotou por hoje.`);
        }
      }

      // Baixa atômica de estoque
      for (const [productId, qty] of priced.stockUsage) {
        const p = catalog.products.get(productId)!;
        if (p.stockQty === null) continue;
        const r = await tx.product.updateMany({ where: { id: productId, stockQty: { gte: qty } }, data: { stockQty: { decrement: qty } } });
        if (r.count === 0) throw badRequest('OUT_OF_STOCK', `${p.name} acabou de esgotar. Atualize seu carrinho.`);
      }

      // Cupom (linha bloqueada para respeitar limite de uso)
      let discountCents = 0;
      let couponId: string | null = null;
      let couponCode: string | null = null;
      if (input.couponCode) {
        const code = input.couponCode.trim().toUpperCase();
        const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM coupons WHERE code = ${code} FOR UPDATE`;
        if (!rows.length) throw badRequest('COUPON_INVALID', 'Cupom inválido.');
        const coupon = await tx.coupon.findUniqueOrThrow({ where: { id: rows[0].id } });
        discountCents = couponDiscount(coupon, priced.itemsTotalCents, now);
        await tx.coupon.update({ where: { id: coupon.id }, data: { usedCount: { increment: 1 } } });
        couponId = coupon.id;
        couponCode = coupon.code;
      }

      // Taxa de entrega
      let deliveryFeeCents = 0;
      let deliveryAreaId: string | null = null;
      if (input.type === 'DELIVERY') {
        const area = input.address!.deliveryAreaId
          ? await tx.deliveryArea.findUnique({ where: { id: input.address!.deliveryAreaId } })
          : null;
        if (input.address!.deliveryAreaId && !area) throw badRequest('AREA_NOT_FOUND', 'Bairro não encontrado.');
        deliveryFeeCents = deliveryFee(settings.delivery, area, priced.itemsTotalCents - discountCents);
        deliveryAreaId = area?.active ? area.id : null;
      }

      const totalCents = priced.itemsTotalCents - discountCents + deliveryFeeCents;
      if (input.paymentMethod === 'CASH' && input.changeForCents != null && input.changeForCents < totalCents)
        throw badRequest('INVALID_CHANGE', 'O valor para troco deve ser maior que o total do pedido.');

      // Mesa: valida sessão e atribuições
      let tableSessionId: string | null = null;
      if (input.table) {
        const session = await tx.tableSession.findUnique({
          where: { id: input.table.sessionId },
          include: { participants: true, table: true },
        });
        if (!session || session.status === 'CLOSED') throw badRequest('SESSION_CLOSED', 'Esta comanda já foi encerrada.');
        if (!session.table.active) throw badRequest('TABLE_INACTIVE', 'Mesa desativada.');
        const ids = new Set(session.participants.map((p) => p.id));
        const placer = input.table.placedByParticipantId;
        for (const a of input.table.allocations) {
          if (!a.participants.length) throw badRequest('ALLOCATION_REQUIRED', 'Cada item precisa de um responsável.');
          for (const p of a.participants) {
            if (!ids.has(p.participantId)) throw badRequest('INVALID_PARTICIPANT', 'Participante não pertence a esta mesa.');
            if (p.weight !== undefined && (!Number.isInteger(p.weight) || p.weight < 1 || p.weight > 100))
              throw badRequest('INVALID_WEIGHT', 'Fração inválida.');
          }
          if (placer && !ctx.staff) {
            // Participante só lança item para si, para quem ele adicionou, ou compartilhado consigo.
            const includesSelf = a.participants.some((p) => p.participantId === placer);
            const allowedOthers = a.participants.every((p) => {
              if (p.participantId === placer) return true;
              const target = session.participants.find((x) => x.id === p.participantId)!;
              return target.addedById === placer || includesSelf;
            });
            if (!allowedOthers) throw forbidden('Você só pode lançar itens para você, para quem você adicionou ou compartilhados com você.');
          }
        }
        tableSessionId = session.id;
        if (session.status === 'CLOSE_REQUESTED')
          await tx.tableSession.update({ where: { id: session.id }, data: { status: 'OPEN', closeRequestedAt: null } });
      }

      // Cliente: vincula por conta logada ou por telefone de visitante (sem senha).
      let customerId: string | null = ctx.customerId ?? null;
      if (!customerId && input.customerPhone) {
        const existing = await tx.customer.findUnique({ where: { phone: input.customerPhone } });
        if (existing && !existing.passwordHash && !existing.anonymizedAt) {
          customerId = existing.id;
          await tx.customer.update({
            where: { id: existing.id },
            data: { name: input.customerName, whatsappOptIn: input.whatsappOptIn || existing.whatsappOptIn },
          });
        } else if (!existing) {
          const c = await tx.customer.create({
            data: { name: input.customerName, phone: input.customerPhone, whatsappOptIn: input.whatsappOptIn },
          });
          customerId = c.id;
        }
      }
      if (customerId && input.saveAddress && input.address && ctx.customerId) {
        const dup = await tx.customerAddress.findFirst({
          where: { customerId, street: input.address.street, number: input.address.number, neighborhood: input.address.neighborhood },
        });
        if (!dup)
          await tx.customerAddress.create({
            data: {
              customerId,
              street: input.address.street,
              number: input.address.number,
              neighborhood: input.address.neighborhood,
              complement: input.address.complement ?? null,
              reference: input.address.reference ?? null,
              deliveryAreaId,
            },
          });
      }

      const autoAccept = input.type === 'TABLE' && !settings.tables.requireAcceptForTableOrders;
      const status: OrderStatus = autoAccept ? 'ACCEPTED' : 'AWAITING_ACCEPT';

      const created = await tx.order.create({
        data: {
          publicToken: randomToken(18),
          idempotencyKey: input.idempotencyKey ?? null,
          type: input.type,
          status,
          customerId,
          customerName: input.customerName,
          customerPhone: input.customerPhone,
          whatsappOptIn: input.whatsappOptIn,
          addressStreet: input.address?.street ?? null,
          addressNumber: input.address?.number ?? null,
          addressDistrict: input.address?.neighborhood ?? null,
          addressComplement: input.address?.complement ?? null,
          addressReference: input.address?.reference ?? null,
          deliveryAreaId,
          grossCents: priced.grossCents,
          comboSavingsCents: priced.savingsCents,
          itemsTotalCents: priced.itemsTotalCents,
          couponId,
          couponCode,
          discountCents,
          deliveryFeeCents,
          totalCents,
          paymentMethod: input.paymentMethod,
          changeForCents: input.paymentMethod === 'CASH' ? input.changeForCents ?? null : null,
          notes: input.notes?.trim() || null,
          scheduledFor,
          acceptedAt: autoAccept ? now : null,
          tableSessionId,
          placedByParticipantId: input.table?.placedByParticipantId ?? null,
          statusHistory: {
            create: [
              { toStatus: 'AWAITING_ACCEPT', userId: ctx.actor.kind === 'user' ? ctx.actor.id : null },
              ...(autoAccept ? [{ fromStatus: 'AWAITING_ACCEPT' as const, toStatus: 'ACCEPTED' as const, note: 'Aceite automático (mesa)' }] : []),
            ],
          },
        },
      });

      for (const [idx, line] of priced.lines.entries()) {
        const item = await tx.orderItem.create({
          data: {
            orderId: created.id,
            kind: line.kind,
            productId: line.productId,
            optionId: line.optionId,
            comboId: line.comboId,
            name: line.name,
            description: line.description,
            selections: line.selections ? (line.selections as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
            quantity: line.quantity,
            unitPriceCents: line.unitPriceCents,
            unitRegularCents: line.unitRegularCents,
            unitCostCents: line.unitCostCents,
            totalCents: line.totalCents,
            notes: line.notes,
          },
        });
        const alloc = input.table?.allocations[idx];
        if (alloc) {
          const merged = new Map<string, number>();
          for (const p of alloc.participants) merged.set(p.participantId, (merged.get(p.participantId) ?? 0) + (p.weight ?? 1));
          await tx.itemAllocation.createMany({
            data: [...merged].map(([participantId, weight]) => ({ orderItemId: item.id, participantId, weight })),
          });
        }
      }

      await audit(ctx.actor, 'order.create', 'order', created.id, { number: created.number, totalCents }, tx);
      return tx.order.findUniqueOrThrow({ where: { id: created.id }, include: orderInclude });
    });
  } catch (e) {
    // Requisição repetida simultânea com a mesma chave: devolve o pedido já criado.
    if (input.idempotencyKey && e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      const existing = await findByIdempotencyKey(input.idempotencyKey);
      if (existing) return existing;
    }
    throw e;
  }

  publishOrder(order, 'order:new');
  void notifyOrder(order.id, 'ORDER_RECEIVED');
  if (order.status === 'ACCEPTED') void notifyOrder(order.id, 'ORDER_ACCEPTED');
  return order;
}

export function publishOrder(order: FullOrder, event: 'order:new' | 'order:updated') {
  const summary = serializeOrder(order);
  realtime.staff(event, summary);
  if (order.courierId) realtime.courier(order.courierId, 'order:updated', summary);
  realtime.order(order.publicToken, 'order:status', publicOrderView(order));
  if (order.tableSessionId) realtime.session(order.tableSessionId, 'session:updated', { orderId: order.id });
}

export function serializeOrder(o: FullOrder) {
  return {
    ...o,
    statusLabel: statusLabel(o.type, o.status),
    table: o.tableSession?.table ?? null,
  };
}

/** Visão pública do pedido (link de acompanhamento): sem dados de terceiros. */
export function publicOrderView(o: FullOrder) {
  return {
    number: o.number,
    publicToken: o.publicToken,
    type: o.type,
    status: o.status,
    statusLabel: statusLabel(o.type, o.status),
    customerName: o.customerName.split(' ')[0],
    items: o.items.map((i) => ({
      id: i.id,
      name: i.name,
      description: i.description,
      quantity: i.quantity,
      unitPriceCents: i.unitPriceCents,
      totalCents: i.totalCents,
      notes: i.notes,
      canceled: !!i.canceledAt,
    })),
    grossCents: o.grossCents,
    comboSavingsCents: o.comboSavingsCents,
    itemsTotalCents: o.itemsTotalCents,
    discountCents: o.discountCents,
    couponCode: o.couponCode,
    deliveryFeeCents: o.deliveryFeeCents,
    totalCents: o.totalCents,
    paymentMethod: o.paymentMethod,
    paymentStatus: o.paymentStatus,
    changeForCents: o.changeForCents,
    estimatedMinutes: o.estimatedMinutes,
    acceptedAt: o.acceptedAt,
    scheduledFor: o.scheduledFor,
    cancelReason: o.cancelReason,
    createdAt: o.createdAt,
    address:
      o.type === 'DELIVERY'
        ? { street: o.addressStreet, number: o.addressNumber, neighborhood: o.addressDistrict, complement: o.addressComplement }
        : null,
    history: o.statusHistory.map((h) => ({ status: h.toStatus, label: statusLabel(o.type, h.toStatus), at: h.createdAt })),
    table: o.tableSession?.table ? { name: o.tableSession.table.name } : null,
  };
}

async function reload(id: string) {
  return prisma.order.findUniqueOrThrow({ where: { id }, include: orderInclude });
}

export async function acceptOrder(orderId: string, minutes: number | null, actor: Actor) {
  const now = new Date();
  await withTx(async (tx) => {
    const r = await tx.order.updateMany({
      where: { id: orderId, status: 'AWAITING_ACCEPT' },
      data: { status: 'ACCEPTED', estimatedMinutes: minutes, acceptedAt: now, acceptedById: actor.id },
    });
    if (r.count === 0) {
      const exists = await tx.order.findUnique({ where: { id: orderId }, select: { id: true } });
      if (!exists) throw notFound('Pedido não encontrado.');
      throw conflict('ALREADY_PROCESSED', 'Este pedido já foi processado por outra pessoa.');
    }
    await tx.orderStatusHistory.create({
      data: { orderId, fromStatus: 'AWAITING_ACCEPT', toStatus: 'ACCEPTED', userId: actor.id, note: minutes ? `Prazo: ${minutes} min` : null },
    });
    await audit(actor, 'order.accept', 'order', orderId, { minutes }, tx);
  });
  const order = await reload(orderId);
  publishOrder(order, 'order:updated');
  void notifyOrder(orderId, 'ORDER_ACCEPTED');
  return order;
}

export async function cancelOrder(orderId: string, reason: string, actor: Actor, opts: { byCustomer?: boolean; onlyPending?: boolean } = {}) {
  const now = new Date();
  await withTx(async (tx) => {
    const current = await tx.order.findUnique({ where: { id: orderId }, include: { items: true } });
    if (!current) throw notFound('Pedido não encontrado.');
    const allowedFrom: OrderStatus[] = opts.onlyPending
      ? ['AWAITING_ACCEPT']
      : (['AWAITING_ACCEPT', 'ACCEPTED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY'] as OrderStatus[]);
    if (!allowedFrom.includes(current.status))
      throw conflict('CANNOT_CANCEL', opts.onlyPending ? 'O pedido já foi aceito e não pode mais ser cancelado por aqui. Fale conosco pelo WhatsApp.' : 'Este pedido não pode mais ser cancelado.');
    const confirmedPaid = await tx.payment.aggregate({ where: { orderId, status: 'CONFIRMED' }, _sum: { amountCents: true } });
    const r = await tx.order.updateMany({
      where: { id: orderId, status: current.status },
      data: {
        status: 'CANCELED',
        cancelReason: reason,
        canceledAt: now,
        canceledById: actor.kind === 'user' ? actor.id : null,
        canceledByCustomer: !!opts.byCustomer,
        paymentStatus: (confirmedPaid._sum.amountCents ?? 0) > 0 ? 'REFUND_PENDING' : current.paymentStatus,
      },
    });
    if (r.count === 0) throw conflict('ALREADY_PROCESSED', 'Este pedido foi alterado por outra pessoa. Atualize a tela.');
    await tx.orderStatusHistory.create({
      data: { orderId, fromStatus: current.status, toStatus: 'CANCELED', userId: actor.kind === 'user' ? actor.id : null, note: reason },
    });
    await restock(tx, current.items);
    if (current.couponId) await tx.coupon.updateMany({ where: { id: current.couponId, usedCount: { gt: 0 } }, data: { usedCount: { decrement: 1 } } });
    await tx.payment.updateMany({ where: { orderId, status: 'PENDING' }, data: { status: 'VOIDED', voidedAt: now, voidReason: 'Pedido cancelado' } });
    await audit(actor, 'order.cancel', 'order', orderId, { reason, from: current.status }, tx);
  });
  const order = await reload(orderId);
  publishOrder(order, 'order:updated');
  void notifyOrder(orderId, 'ORDER_CANCELED', { reason });
  return order;
}

export async function advanceOrder(orderId: string, to: OrderStatus, actor: Actor & { role: RoleKey }) {
  const now = new Date();
  await withTx(async (tx) => {
    const o = await tx.order.findUnique({ where: { id: orderId } });
    if (!o) throw notFound('Pedido não encontrado.');
    if (!canAdvance(actor.role, o.type, o.status, to)) throw forbidden('Mudança de status não permitida.');
    if (actor.role === 'COURIER' && o.courierId !== actor.id) throw forbidden('Esta entrega não está atribuída a você.');
    const final = FINAL_STATUSES.includes(to);
    const r = await tx.order.updateMany({
      where: { id: orderId, status: o.status },
      data: { status: to, completedAt: final ? now : undefined },
    });
    if (r.count === 0) throw conflict('ALREADY_PROCESSED', 'O pedido já foi atualizado por outra pessoa.');
    await tx.orderStatusHistory.create({ data: { orderId, fromStatus: o.status, toStatus: to, userId: actor.id } });
  });
  const order = await reload(orderId);
  publishOrder(order, 'order:updated');
  const event = notificationEvent(to) as WhatsappEvent | null;
  if (event && order.type !== 'TABLE') void notifyOrder(orderId, event);
  return order;
}

export async function assignCourier(orderId: string, courierId: string | null, actor: Actor) {
  if (courierId) {
    const u = await prisma.user.findUnique({ where: { id: courierId } });
    if (!u || u.roleKey !== 'COURIER' || !u.active) throw badRequest('INVALID_COURIER', 'Entregador inválido.');
  }
  const o = await prisma.order.findUnique({ where: { id: orderId } });
  if (!o) throw notFound();
  if (o.type !== 'DELIVERY') throw badRequest('NOT_DELIVERY', 'Somente pedidos de delivery têm entregador.');
  const prev = o.courierId;
  await prisma.order.update({ where: { id: orderId }, data: { courierId } });
  await audit(actor, 'order.assignCourier', 'order', orderId, { courierId, prev });
  const order = await reload(orderId);
  publishOrder(order, 'order:updated');
  if (prev && prev !== courierId) realtime.courier(prev, 'order:removed', { id: orderId });
  return order;
}

/** Pagamento de pedido avulso (delivery/retirada) confirmado pelo atendente. */
export async function confirmOrderPayment(
  orderId: string,
  data: { method: PaymentMethod; amountCents: number; notes?: string | null; idempotencyKey?: string | null },
  actor: Actor,
) {
  await withTx(async (tx) => {
    const o = await tx.order.findUnique({ where: { id: orderId } });
    if (!o) throw notFound();
    if (o.tableSessionId) throw badRequest('USE_TABLE_PAYMENT', 'Pagamentos de mesa são registrados na comanda.');
    if (o.status === 'CANCELED') throw badRequest('ORDER_CANCELED', 'Pedido cancelado.');
    if (o.paymentStatus === 'PAID') throw conflict('ALREADY_PAID', 'Este pedido já está quitado.');
    const paid = await tx.payment.aggregate({ where: { orderId, status: 'CONFIRMED' }, _sum: { amountCents: true } });
    const remaining = o.totalCents - (paid._sum.amountCents ?? 0);
    if (data.amountCents > remaining) throw badRequest('OVERPAYMENT', 'Valor maior que o saldo do pedido.');
    await tx.payment.create({
      data: {
        orderId,
        method: data.method,
        amountCents: data.amountCents,
        status: 'CONFIRMED',
        provider: 'manual',
        notes: data.notes ?? null,
        idempotencyKey: data.idempotencyKey ?? null,
        confirmedById: actor.id,
        confirmedAt: new Date(),
      },
    });
    if (data.amountCents === remaining) await tx.order.update({ where: { id: orderId }, data: { paymentStatus: 'PAID' } });
    await audit(actor, 'payment.confirm', 'order', orderId, { amountCents: data.amountCents, method: data.method }, tx);
  });
  const order = await reload(orderId);
  publishOrder(order, 'order:updated');
  return order;
}

export async function markRefunded(orderId: string, actor: Actor) {
  const r = await prisma.order.updateMany({ where: { id: orderId, paymentStatus: 'REFUND_PENDING' }, data: { paymentStatus: 'REFUNDED' } });
  if (r.count === 0) throw conflict('NOT_REFUNDABLE', 'Pedido não está aguardando estorno.');
  await audit(actor, 'payment.refund', 'order', orderId);
  const order = await reload(orderId);
  publishOrder(order, 'order:updated');
  return order;
}

/** Cancela um item (correção por atendente), recalculando totais. Auditoria obrigatória. */
export async function cancelOrderItem(itemId: string, reason: string, actor: Actor) {
  const orderId = await withTx(async (tx) => {
    const item = await tx.orderItem.findUnique({ where: { id: itemId }, include: { order: true } });
    if (!item) throw notFound();
    if (item.canceledAt) throw conflict('ALREADY_CANCELED', 'Item já cancelado.');
    if (item.order.status === 'CANCELED') throw badRequest('ORDER_CANCELED', 'Pedido cancelado.');
    if (item.order.type !== 'TABLE' && item.order.paymentStatus === 'PAID')
      throw badRequest('ORDER_PAID', 'Pedido já pago; cancele o pedido e sinalize estorno.');
    const active = await tx.orderItem.count({ where: { orderId: item.orderId, canceledAt: null } });
    if (active <= 1) throw badRequest('LAST_ITEM', 'Este é o único item; cancele o pedido inteiro.');
    await tx.orderItem.update({ where: { id: itemId }, data: { canceledAt: new Date(), cancelReason: reason } });
    const savings = (item.unitRegularCents - item.unitPriceCents) * item.quantity;
    const itemsTotal = item.order.itemsTotalCents - item.totalCents;
    const discount = Math.min(item.order.discountCents, itemsTotal);
    await tx.order.update({
      where: { id: item.orderId },
      data: {
        itemsTotalCents: itemsTotal,
        comboSavingsCents: item.order.comboSavingsCents - savings,
        grossCents: item.order.grossCents - item.totalCents - savings,
        discountCents: discount,
        totalCents: itemsTotal - discount + item.order.deliveryFeeCents,
      },
    });
    await restock(tx, [{ ...item, canceledAt: null }]);
    await audit(actor, 'orderItem.cancel', 'order_item', itemId, { reason, orderId: item.orderId, totalCents: item.totalCents }, tx);
    return item.orderId;
  });
  const order = await reload(orderId);
  publishOrder(order, 'order:updated');
  return order;
}
