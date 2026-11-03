import { Prisma, type PaymentMethod, type SplitMode } from '@prisma/client';
import { prisma, withTx } from '../db';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { randomToken, sha256 } from '../lib/crypto';
import { audit, type Actor } from '../lib/audit';
import { computeSplit, type SplitConfig } from '../lib/split';
import { getSettings } from '../lib/settings';
import { statusLabel } from '../lib/orderStatus';
import { realtime } from '../realtime';
import { env } from '../env';

export function tableUrl(token: string) {
  return `${env.PUBLIC_APP_URL.replace(/\/$/, '')}/mesa/${token}`;
}

export const newTableToken = () => randomToken(12); // 96 bits, link curto o suficiente para NFC NTAG213

const sessionInclude = {
  table: true,
  participants: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
  orders: {
    orderBy: { createdAt: 'asc' },
    include: {
      items: { include: { allocations: true } },
      placedByParticipant: { select: { id: true, name: true } },
    },
  },
  payments: { where: { status: { not: 'VOIDED' } }, include: { allocations: true }, orderBy: { createdAt: 'asc' } },
} satisfies Prisma.TableSessionInclude;

export type FullSession = Prisma.TableSessionGetPayload<{ include: typeof sessionInclude }>;

export async function loadSession(sessionId: string) {
  const s = await prisma.tableSession.findUnique({ where: { id: sessionId }, include: sessionInclude });
  if (!s) throw notFound('Comanda não encontrada.');
  return s;
}

export function billOf(s: FullSession, mode?: SplitMode, config?: SplitConfig | null) {
  const items = s.orders
    .filter((o) => o.status !== 'CANCELED')
    .flatMap((o) => o.items.filter((i) => !i.canceledAt))
    .map((i) => ({
      id: i.id,
      name: `${i.quantity}x ${i.name}`,
      totalCents: i.totalCents,
      allocations: i.allocations.map((a) => ({ participantId: a.participantId, weight: a.weight })),
    }));
  const confirmed = s.payments.filter((p) => p.status === 'CONFIRMED');
  const paid = confirmed.flatMap((p) => p.allocations.map((a) => ({ participantId: a.participantId, amountCents: a.amountCents })));
  const unassignedPaidCents = confirmed.reduce(
    (sum, p) => sum + p.amountCents - p.allocations.reduce((x, a) => x + a.amountCents, 0),
    0,
  );
  return computeSplit({
    participants: s.participants.map((p) => ({ id: p.id, name: p.name })),
    items,
    mode: mode ?? s.splitMode,
    config: (config !== undefined ? config : (s.splitConfig as SplitConfig | null)) ?? null,
    paid,
    unassignedPaidCents,
  });
}

/** Status visual da mesa no painel. */
export function tableStatus(s: FullSession | null, lastClosedAt?: Date | null) {
  if (!s) {
    if (lastClosedAt && Date.now() - lastClosedAt.getTime() < 5 * 60_000) return 'FINALIZADA';
    return 'LIVRE';
  }
  if (s.status === 'CLOSE_REQUESTED') return 'AGUARDANDO_PAGAMENTO';
  const active = s.orders.filter((o) => o.status !== 'CANCELED');
  if (active.some((o) => o.status === 'AWAITING_ACCEPT')) return 'PEDIDO_PENDENTE';
  if (active.some((o) => ['ACCEPTED', 'PREPARING', 'READY'].includes(o.status))) return 'EM_ATENDIMENTO';
  return 'OCUPADA';
}

export function serializeSession(s: FullSession, opts: { forParticipantId?: string } = {}) {
  const bill = billOf(s);
  return {
    id: s.id,
    status: s.status,
    splitMode: s.splitMode,
    splitConfig: s.splitConfig,
    openedAt: s.openedAt,
    closeRequestedAt: s.closeRequestedAt,
    closedAt: s.closedAt,
    table: { id: s.table.id, name: s.table.name, number: s.table.number },
    participants: s.participants.map((p) => ({
      id: p.id,
      name: p.name,
      hasDevice: !!p.deviceTokenHash,
      addedById: p.addedById,
      isMe: p.id === opts.forParticipantId,
    })),
    orders: s.orders.map((o) => ({
      id: o.id,
      number: o.number,
      status: o.status,
      statusLabel: statusLabel(o.type, o.status),
      createdAt: o.createdAt,
      totalCents: o.totalCents,
      cancelReason: o.cancelReason,
      placedBy: o.placedByParticipant,
      items: o.items.map((i) => ({
        id: i.id,
        name: i.name,
        description: i.description,
        quantity: i.quantity,
        unitPriceCents: i.unitPriceCents,
        totalCents: i.totalCents,
        notes: i.notes,
        canceled: !!i.canceledAt,
        allocations: i.allocations.map((a) => ({ participantId: a.participantId, weight: a.weight })),
      })),
    })),
    payments: s.payments.map((p) => ({
      id: p.id,
      receiptNumber: p.receiptNumber,
      method: p.method,
      amountCents: p.amountCents,
      status: p.status,
      createdAt: p.createdAt,
      confirmedAt: p.confirmedAt,
      allocations: p.allocations.map((a) => ({ participantId: a.participantId, amountCents: a.amountCents })),
    })),
    bill,
  };
}

function publishSession(sessionId: string) {
  realtime.session(sessionId, 'session:updated', { sessionId });
  realtime.staff('table:updated', { sessionId });
}

export async function tableByToken(token: string) {
  if (!/^[\w-]{8,64}$/.test(token)) throw notFound('Mesa não encontrada.');
  const table = await prisma.table.findUnique({ where: { token } });
  if (!table || !table.active) throw notFound('Este link de mesa não é válido. Chame um atendente.');
  return table;
}

export async function currentSession(tableId: string) {
  return prisma.tableSession.findFirst({ where: { tableId, status: { not: 'CLOSED' } }, include: sessionInclude });
}

export async function openSession(tableId: string, actor: Actor) {
  try {
    const s = await prisma.tableSession.create({ data: { tableId } });
    await audit(actor, 'table.open', 'table_session', s.id, { tableId });
    publishSession(s.id);
    return s;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      const existing = await prisma.tableSession.findFirst({ where: { tableId, status: { not: 'CLOSED' } } });
      if (existing) return existing;
    }
    throw e;
  }
}

/** Participante identificado pelo token guardado no aparelho. */
export async function participantFromToken(token: string | undefined) {
  if (!token || token.length > 64) throw forbidden('Entre na mesa para continuar.');
  const p = await prisma.tableParticipant.findUnique({
    where: { deviceTokenHash: sha256(token) },
    include: { session: { include: { table: true } } },
  });
  if (!p || p.session.status === 'CLOSED') throw forbidden('Sua participação nesta mesa foi encerrada. Entre novamente.');
  return p;
}

export async function joinTable(tableToken: string, name: string, ip?: string) {
  const table = await tableByToken(tableToken);
  const settings = await getSettings();
  let session = await prisma.tableSession.findFirst({ where: { tableId: table.id, status: { not: 'CLOSED' } } });
  if (!session) {
    if (!settings.tables.autoOpenOnJoin) throw badRequest('TABLE_CLOSED', 'Esta mesa ainda não foi aberta. Chame um atendente.');
    session = await openSession(table.id, { kind: 'system', ip });
  }
  const count = await prisma.tableParticipant.count({ where: { sessionId: session.id } });
  if (count >= 30) throw badRequest('TABLE_FULL', 'Limite de participantes atingido nesta mesa.');
  const deviceToken = randomToken(24);
  const participant = await prisma.tableParticipant.create({
    data: { sessionId: session.id, name: name.trim(), deviceTokenHash: sha256(deviceToken) },
  });
  await audit({ kind: 'participant', id: participant.id, ip }, 'table.join', 'table_session', session.id, { name: participant.name });
  publishSession(session.id);
  return { deviceToken, participantId: participant.id, sessionId: session.id };
}

export async function addPerson(sessionId: string, name: string, actor: Actor, addedById: string | null) {
  const s = await prisma.tableSession.findUnique({ where: { id: sessionId } });
  if (!s || s.status === 'CLOSED') throw badRequest('SESSION_CLOSED', 'Comanda encerrada.');
  const count = await prisma.tableParticipant.count({ where: { sessionId } });
  if (count >= 30) throw badRequest('TABLE_FULL', 'Limite de participantes atingido nesta mesa.');
  const p = await prisma.tableParticipant.create({ data: { sessionId, name: name.trim(), addedById } });
  await audit(actor, 'table.addPerson', 'table_session', sessionId, { participantId: p.id, name: p.name });
  publishSession(sessionId);
  return p;
}

export async function requestClose(sessionId: string, mode: SplitMode, config: SplitConfig | null, actor: Actor) {
  const s = await loadSession(sessionId);
  if (s.status === 'CLOSED') throw badRequest('SESSION_CLOSED', 'Comanda encerrada.');
  billOf(s, mode, config); // valida a configuração
  await prisma.tableSession.update({
    where: { id: sessionId },
    data: { status: 'CLOSE_REQUESTED', closeRequestedAt: new Date(), splitMode: mode, splitConfig: (config ?? Prisma.JsonNull) as Prisma.InputJsonValue },
  });
  await audit(actor, 'table.requestClose', 'table_session', sessionId, { mode });
  realtime.staff('table:closeRequested', { sessionId, table: s.table.name });
  publishSession(sessionId);
}

export async function setSplit(sessionId: string, mode: SplitMode, config: SplitConfig | null, actor: Actor) {
  const s = await loadSession(sessionId);
  if (s.status === 'CLOSED') throw badRequest('SESSION_CLOSED', 'Comanda encerrada.');
  billOf(s, mode, config);
  await prisma.tableSession.update({
    where: { id: sessionId },
    data: { splitMode: mode, splitConfig: (config ?? Prisma.JsonNull) as Prisma.InputJsonValue },
  });
  await audit(actor, 'table.setSplit', 'table_session', sessionId, { mode, config: config as Prisma.InputJsonValue });
  publishSession(sessionId);
}

/** Correção de atribuição de item pela equipe (auditada). */
export async function reallocateItem(itemId: string, allocations: { participantId: string; weight: number }[], actor: Actor) {
  const item = await prisma.orderItem.findUnique({
    where: { id: itemId },
    include: { allocations: true, order: { include: { tableSession: { include: { participants: true } } } } },
  });
  if (!item || !item.order.tableSession) throw notFound('Item de mesa não encontrado.');
  if (item.order.tableSession.status === 'CLOSED') throw badRequest('SESSION_CLOSED', 'Comanda encerrada.');
  const ids = new Set(item.order.tableSession.participants.map((p) => p.id));
  if (!allocations.length) throw badRequest('ALLOCATION_REQUIRED', 'Cada item precisa de um responsável.');
  for (const a of allocations) if (!ids.has(a.participantId)) throw badRequest('INVALID_PARTICIPANT', 'Participante inválido.');
  await withTx(async (tx) => {
    await tx.itemAllocation.deleteMany({ where: { orderItemId: itemId } });
    await tx.itemAllocation.createMany({ data: allocations.map((a) => ({ orderItemId: itemId, participantId: a.participantId, weight: a.weight })) });
    await audit(
      actor,
      'orderItem.reallocate',
      'order_item',
      itemId,
      { before: item.allocations.map((a) => ({ p: a.participantId, w: a.weight })), after: allocations },
      tx,
    );
  });
  publishSession(item.order.tableSession.id);
}

export async function registerTablePayment(
  sessionId: string,
  data: {
    method: PaymentMethod;
    amountCents: number;
    allocations: { participantId: string; amountCents: number }[];
    confirm: boolean;
    notes?: string | null;
    idempotencyKey?: string | null;
  },
  actor: Actor,
) {
  if (data.idempotencyKey) {
    const existing = await prisma.payment.findUnique({ where: { idempotencyKey: data.idempotencyKey } });
    if (existing) return existing;
  }
  const payment = await withTx(async (tx) => {
    await tx.$queryRaw`SELECT id FROM table_sessions WHERE id = ${sessionId} FOR UPDATE`;
    const s = await tx.tableSession.findUnique({ where: { id: sessionId }, include: sessionInclude });
    if (!s) throw notFound();
    if (s.status === 'CLOSED') throw badRequest('SESSION_CLOSED', 'Comanda encerrada.');
    const bill = billOf(s);
    const pendingSum = s.payments.filter((p) => p.status === 'PENDING').reduce((x, p) => x + p.amountCents, 0);
    if (data.amountCents > bill.remainingCents - pendingSum)
      throw badRequest('OVERPAYMENT', 'Valor maior que o saldo pendente da mesa.');
    const allocSum = data.allocations.reduce((x, a) => x + a.amountCents, 0);
    if (allocSum > data.amountCents) throw badRequest('INVALID_ALLOCATION', 'A soma por pessoa excede o valor do pagamento.');
    const ids = new Set(s.participants.map((p) => p.id));
    for (const a of data.allocations) if (!ids.has(a.participantId)) throw badRequest('INVALID_PARTICIPANT', 'Participante inválido.');
    const p = await tx.payment.create({
      data: {
        sessionId,
        method: data.method,
        amountCents: data.amountCents,
        status: data.confirm ? 'CONFIRMED' : 'PENDING',
        provider: 'manual',
        notes: data.notes ?? null,
        idempotencyKey: data.idempotencyKey ?? null,
        confirmedById: data.confirm ? actor.id : null,
        confirmedAt: data.confirm ? new Date() : null,
        allocations: { create: data.allocations.filter((a) => a.amountCents > 0) },
      },
    });
    await audit(actor, data.confirm ? 'payment.confirm' : 'payment.register', 'table_session', sessionId, {
      paymentId: p.id,
      amountCents: p.amountCents,
      method: p.method,
    }, tx);
    return p;
  });
  publishSession(sessionId);
  return payment;
}

export async function confirmPayment(paymentId: string, actor: Actor) {
  const p = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (!p) throw notFound();
  const r = await prisma.payment.updateMany({
    where: { id: paymentId, status: 'PENDING' },
    data: { status: 'CONFIRMED', confirmedById: actor.id, confirmedAt: new Date() },
  });
  if (r.count === 0) throw conflict('ALREADY_PROCESSED', 'Pagamento já processado.');
  await audit(actor, 'payment.confirm', 'payment', paymentId);
  if (p.sessionId) publishSession(p.sessionId);
}

export async function voidPayment(paymentId: string, reason: string, actor: Actor) {
  const p = await prisma.payment.findUnique({ where: { id: paymentId }, include: { session: true } });
  if (!p) throw notFound();
  if (p.session?.status === 'CLOSED') throw badRequest('SESSION_CLOSED', 'Comanda encerrada; não é possível estornar por aqui.');
  const r = await prisma.payment.updateMany({
    where: { id: paymentId, status: { not: 'VOIDED' } },
    data: { status: 'VOIDED', voidedAt: new Date(), voidReason: reason },
  });
  if (r.count === 0) throw conflict('ALREADY_PROCESSED', 'Pagamento já anulado.');
  await audit(actor, 'payment.void', 'payment', paymentId, { reason, amountCents: p.amountCents });
  if (p.sessionId) publishSession(p.sessionId);
}

export async function closeSession(sessionId: string, actor: Actor & { role: string }, force?: { reason: string }) {
  await withTx(async (tx) => {
    await tx.$queryRaw`SELECT id FROM table_sessions WHERE id = ${sessionId} FOR UPDATE`;
    const s = await tx.tableSession.findUnique({ where: { id: sessionId }, include: sessionInclude });
    if (!s) throw notFound();
    if (s.status === 'CLOSED') throw conflict('ALREADY_CLOSED', 'Comanda já encerrada.');
    const bill = billOf(s);
    const openOrders = s.orders.filter((o) => ['AWAITING_ACCEPT', 'ACCEPTED', 'PREPARING', 'READY'].includes(o.status));
    if (bill.remainingCents > 0 || openOrders.length) {
      if (!force) {
        throw badRequest(
          'PENDING_BALANCE',
          bill.remainingCents > 0
            ? `Ainda há saldo pendente de R$ ${(bill.remainingCents / 100).toFixed(2).replace('.', ',')}.`
            : 'Há pedidos ainda não entregues nesta mesa.',
        );
      }
      if (actor.role !== 'ADMIN') throw forbidden('Somente o administrador pode encerrar com pendências.');
    }
    if (s.payments.some((p) => p.status === 'PENDING') && !force)
      throw badRequest('PENDING_PAYMENTS', 'Há pagamentos aguardando confirmação.');
    await tx.tableSession.update({
      where: { id: sessionId },
      data: {
        status: 'CLOSED',
        closedAt: new Date(),
        closedById: actor.id,
        forcedClose: !!force,
        forcedReason: force?.reason ?? null,
      },
    });
    // Pedidos já entregues/servidos ficam como estão; os demais (força) são marcados como servidos.
    for (const o of openOrders) {
      await tx.order.update({ where: { id: o.id }, data: { status: 'SERVED', completedAt: new Date() } });
      await tx.orderStatusHistory.create({ data: { orderId: o.id, fromStatus: o.status, toStatus: 'SERVED', userId: actor.id, note: 'Encerramento da mesa' } });
    }
    // Pedidos de mesa ficam quitados quando a comanda fecha sem saldo
    if (bill.remainingCents <= 0)
      await tx.order.updateMany({ where: { tableSessionId: sessionId, status: { not: 'CANCELED' } }, data: { paymentStatus: 'PAID' } });
    await audit(actor, force ? 'table.forceClose' : 'table.close', 'table_session', sessionId, {
      remainingCents: bill.remainingCents,
      reason: force?.reason,
    }, tx);
  });
  publishSession(sessionId);
}

export async function transferSession(sessionId: string, targetTableId: string, actor: Actor) {
  const s = await prisma.tableSession.findUnique({ where: { id: sessionId }, include: { table: true } });
  if (!s || s.status === 'CLOSED') throw badRequest('SESSION_CLOSED', 'Comanda encerrada.');
  const target = await prisma.table.findUnique({ where: { id: targetTableId } });
  if (!target || !target.active) throw badRequest('INVALID_TABLE', 'Mesa de destino inválida.');
  try {
    await prisma.tableSession.update({ where: { id: sessionId }, data: { tableId: targetTableId } });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')
      throw conflict('TABLE_OCCUPIED', `${target.name} já está ocupada.`);
    throw e;
  }
  await audit(actor, 'table.transfer', 'table_session', sessionId, { from: s.table.name, to: target.name });
  publishSession(sessionId);
}
