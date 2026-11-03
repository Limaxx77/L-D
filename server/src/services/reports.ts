import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { getSettings } from '../lib/settings';
import { startOfLocalDay } from '../lib/hours';

/**
 * Relatórios financeiros. "Faturamento" = soma dos pedidos não cancelados (vendas);
 * "Recebimentos" = pagamentos confirmados; "Lucro estimado" = faturamento − custos
 * dos produtos (quando cadastrados) − despesas lançadas. Faturamento não é lucro.
 */

export type Granularity = 'day' | 'week' | 'month';

export async function periodFromQuery(from?: string, to?: string) {
  const tz = (await getSettings()).store.timezone;
  const now = new Date();
  const start = from ? localDateToUtc(from, tz) : startOfLocalDay(new Date(now.getTime() - 29 * 86_400_000), tz);
  const end = to ? localDateToUtc(to, tz, 1) : startOfLocalDay(new Date(now.getTime() + 86_400_000), tz);
  return { start, end, tz };
}

/** "AAAA-MM-DD" no fuso da loja -> instante UTC da meia-noite local (+ dias). */
function localDateToUtc(date: string, tz: string, addDays = 0) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Data inválida');
  const [y, m, d] = date.split('-').map(Number);
  const noonUtc = new Date(Date.UTC(y, m - 1, d + addDays, 12));
  return startOfLocalDay(noonUtc, tz);
}

export async function dashboard() {
  const tz = (await getSettings()).store.timezone;
  const today = startOfLocalDay(new Date(), tz);
  const orders = await prisma.order.findMany({
    where: { createdAt: { gte: today } },
    select: { status: true, totalCents: true, type: true, items: { where: { canceledAt: null }, select: { kind: true, quantity: true, selections: true, product: { select: { kind: true } } } } },
  });
  const valid = orders.filter((o) => o.status !== 'CANCELED');
  const revenue = valid.reduce((s, o) => s + o.totalCents, 0);
  let pastels = 0;
  let drinks = 0;
  let combos = 0;
  for (const o of valid)
    for (const i of o.items) {
      if (i.kind === 'COMBO') {
        combos += i.quantity;
        const sel = i.selections as { pastels?: { quantity: number }[]; drinks?: { quantity: number }[] } | null;
        pastels += (sel?.pastels ?? []).reduce((s, x) => s + x.quantity, 0) * i.quantity;
        drinks += (sel?.drinks ?? []).reduce((s, x) => s + x.quantity, 0) * i.quantity;
      } else if (i.product?.kind === 'PASTEL') pastels += i.quantity;
      else if (i.product?.kind === 'DRINK') drinks += i.quantity;
    }
  const [occupiedTables, deliveriesInProgress] = await Promise.all([
    prisma.tableSession.count({ where: { status: { not: 'CLOSED' } } }),
    prisma.order.count({ where: { type: 'DELIVERY', status: { in: ['ACCEPTED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY'] } } }),
  ]);
  return {
    ordersToday: orders.length,
    awaiting: orders.filter((o) => o.status === 'AWAITING_ACCEPT').length,
    preparing: orders.filter((o) => ['ACCEPTED', 'PREPARING'].includes(o.status)).length,
    completed: orders.filter((o) => ['DELIVERED', 'PICKED_UP', 'SERVED'].includes(o.status)).length,
    canceled: orders.filter((o) => o.status === 'CANCELED').length,
    revenueCents: revenue,
    averageTicketCents: valid.length ? Math.round(revenue / valid.length) : 0,
    pastelsSold: pastels,
    drinksSold: drinks,
    combosSold: combos,
    occupiedTables,
    deliveriesInProgress,
  };
}

export async function salesSeries(start: Date, end: Date, tz: string, granularity: Granularity) {
  const unit = Prisma.raw(`'${granularity}'`);
  const rows = await prisma.$queryRaw<{ bucket: Date; orders: bigint; revenue: bigint; canceled: bigint }[]>`
    SELECT date_trunc(${unit}, ("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${tz}) AS bucket,
           COUNT(*) FILTER (WHERE status <> 'CANCELED') AS orders,
           COALESCE(SUM("totalCents") FILTER (WHERE status <> 'CANCELED'), 0) AS revenue,
           COUNT(*) FILTER (WHERE status = 'CANCELED') AS canceled
    FROM orders
    WHERE "createdAt" >= ${start} AND "createdAt" < ${end}
    GROUP BY 1 ORDER BY 1`;
  return rows.map((r) => ({
    bucket: r.bucket.toISOString().slice(0, 10),
    orders: Number(r.orders),
    revenueCents: Number(r.revenue),
    canceled: Number(r.canceled),
  }));
}

export async function financeSummary(start: Date, end: Date) {
  const where: Prisma.OrderWhereInput = { createdAt: { gte: start, lt: end } };
  const [sales, canceled, byMethod, received, pendingOrders, expenses, cost, openSessions] = await Promise.all([
    prisma.order.aggregate({
      where: { ...where, status: { not: 'CANCELED' } },
      _sum: { totalCents: true, grossCents: true, comboSavingsCents: true, discountCents: true, deliveryFeeCents: true, itemsTotalCents: true },
      _count: true,
    }),
    prisma.order.aggregate({ where: { ...where, status: 'CANCELED' }, _sum: { totalCents: true }, _count: true }),
    prisma.order.groupBy({ by: ['paymentMethod'], where: { ...where, status: { not: 'CANCELED' } }, _sum: { totalCents: true }, _count: true }),
    prisma.payment.groupBy({
      by: ['method'],
      where: { status: 'CONFIRMED', confirmedAt: { gte: start, lt: end } },
      _sum: { amountCents: true },
      _count: true,
    }),
    prisma.order.aggregate({
      where: { ...where, status: { not: 'CANCELED' }, paymentStatus: 'PENDING', tableSessionId: null },
      _sum: { totalCents: true },
      _count: true,
    }),
    prisma.expense.aggregate({ where: { date: { gte: start, lt: end } }, _sum: { amountCents: true } }),
    prisma.$queryRaw<{ cost: bigint | null; unknown: bigint }[]>`
      SELECT SUM(oi."unitCostCents" * oi.quantity) AS cost,
             COUNT(*) FILTER (WHERE oi."unitCostCents" IS NULL) AS unknown
      FROM order_items oi JOIN orders o ON o.id = oi."orderId"
      WHERE o."createdAt" >= ${start} AND o."createdAt" < ${end} AND o.status <> 'CANCELED' AND oi."canceledAt" IS NULL`,
    prisma.tableSession.count({ where: { status: { not: 'CLOSED' } } }),
  ]);
  const refunds = await prisma.order.aggregate({ where: { ...where, paymentStatus: 'REFUND_PENDING' }, _sum: { totalCents: true }, _count: true });
  const revenue = sales._sum.totalCents ?? 0;
  const productCost = Number(cost[0]?.cost ?? 0);
  const expenseTotal = expenses._sum.amountCents ?? 0;
  return {
    orders: sales._count,
    grossCents: sales._sum.grossCents ?? 0,
    promoSavingsCents: sales._sum.comboSavingsCents ?? 0,
    couponDiscountCents: sales._sum.discountCents ?? 0,
    deliveryFeesCents: sales._sum.deliveryFeeCents ?? 0,
    revenueCents: revenue,
    averageTicketCents: sales._count ? Math.round(revenue / sales._count) : 0,
    canceled: { count: canceled._count, totalCents: canceled._sum.totalCents ?? 0 },
    refundsPending: { count: refunds._count, totalCents: refunds._sum.totalCents ?? 0 },
    salesByMethod: byMethod.map((m) => ({ method: m.paymentMethod, count: m._count, totalCents: m._sum.totalCents ?? 0 })),
    receivedByMethod: received.map((m) => ({ method: m.method, count: m._count, totalCents: m._sum.amountCents ?? 0 })),
    receivedCents: received.reduce((s, m) => s + (m._sum.amountCents ?? 0), 0),
    pendingCents: pendingOrders._sum.totalCents ?? 0,
    pendingCount: pendingOrders._count,
    openTableSessions: openSessions,
    productCostCents: productCost,
    itemsWithoutCost: Number(cost[0]?.unknown ?? 0),
    expensesCents: expenseTotal,
    estimatedProfitCents: revenue - productCost - expenseTotal,
  };
}

export async function topItems(start: Date, end: Date) {
  const products = await prisma.$queryRaw<{ name: string; qty: bigint; total: bigint }[]>`
    SELECT COALESCE(p.name, oi.name) AS name, SUM(oi.quantity) AS qty, SUM(oi."totalCents") AS total
    FROM order_items oi JOIN orders o ON o.id = oi."orderId" LEFT JOIN products p ON p.id = oi."productId"
    WHERE o."createdAt" >= ${start} AND o."createdAt" < ${end} AND o.status <> 'CANCELED'
      AND oi."canceledAt" IS NULL AND oi.kind = 'PRODUCT'
    GROUP BY 1 ORDER BY 2 DESC LIMIT 20`;
  const combos = await prisma.$queryRaw<{ name: string; qty: bigint; total: bigint }[]>`
    SELECT oi.name AS name, SUM(oi.quantity) AS qty, SUM(oi."totalCents") AS total
    FROM order_items oi JOIN orders o ON o.id = oi."orderId"
    WHERE o."createdAt" >= ${start} AND o."createdAt" < ${end} AND o.status <> 'CANCELED'
      AND oi."canceledAt" IS NULL AND oi.kind = 'COMBO'
    GROUP BY 1 ORDER BY 2 DESC LIMIT 20`;
  // Sabores escolhidos dentro dos combos
  const flavors = await prisma.$queryRaw<{ name: string; qty: bigint }[]>`
    SELECT s->>'name' AS name, SUM((s->>'quantity')::int * oi.quantity) AS qty
    FROM order_items oi JOIN orders o ON o.id = oi."orderId",
         jsonb_array_elements(COALESCE(oi.selections->'pastels', '[]'::jsonb)) s
    WHERE o."createdAt" >= ${start} AND o."createdAt" < ${end} AND o.status <> 'CANCELED'
      AND oi."canceledAt" IS NULL AND oi.kind = 'COMBO'
    GROUP BY 1 ORDER BY 2 DESC LIMIT 20`;
  const map = (r: { name: string; qty: bigint; total?: bigint }) => ({ name: r.name, quantity: Number(r.qty), totalCents: Number(r.total ?? 0) });
  return { products: products.map(map), combos: combos.map(map), comboFlavors: flavors.map(map) };
}

export async function ordersForExport(start: Date, end: Date) {
  return prisma.order.findMany({
    where: { createdAt: { gte: start, lt: end } },
    orderBy: { createdAt: 'asc' },
    select: {
      number: true,
      createdAt: true,
      type: true,
      status: true,
      customerName: true,
      paymentMethod: true,
      paymentStatus: true,
      grossCents: true,
      comboSavingsCents: true,
      discountCents: true,
      deliveryFeeCents: true,
      totalCents: true,
      cancelReason: true,
    },
  });
}
