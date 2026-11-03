import { Router } from 'express';
import { z } from 'zod';
import QRCode from 'qrcode';
import { prisma } from '../../db';
import { badRequest, notFound } from '../../lib/errors';
import { audit } from '../../lib/audit';
import { requirePerm, staffActor } from '../../middleware/auth';
import {
  addPerson,
  closeSession,
  confirmPayment,
  currentSession,
  loadSession,
  newTableToken,
  openSession,
  reallocateItem,
  registerTablePayment,
  serializeSession,
  setSplit,
  tableStatus,
  tableUrl,
  transferSession,
  voidPayment,
} from '../../services/tables';
import { idempotencyKey, paymentMethod, splitConfig, splitMode, text } from '../schemas';

export const adminTablesRouter = Router();

// --------------------- Cadastro de mesas / NFC / QR ---------------------

adminTablesRouter.get('/tables', requirePerm('tables.manage'), async (_req, res) => {
  const tables = await prisma.table.findMany({ orderBy: { number: 'asc' } });
  const board = await Promise.all(
    tables.map(async (t) => {
      const s = await currentSession(t.id);
      const last = s ? null : await prisma.tableSession.findFirst({ where: { tableId: t.id, status: 'CLOSED' }, orderBy: { closedAt: 'desc' }, select: { closedAt: true } });
      const view = s ? serializeSession(s) : null;
      return {
        id: t.id,
        name: t.name,
        number: t.number,
        active: t.active,
        url: tableUrl(t.token),
        status: tableStatus(s, last?.closedAt),
        session: view
          ? {
              id: view.id,
              openedAt: view.openedAt,
              participants: view.participants.length,
              totalCents: view.bill.totalCents,
              paidCents: view.bill.paidCents,
              remainingCents: view.bill.remainingCents,
              pendingOrders: view.orders.filter((o) => o.status === 'AWAITING_ACCEPT').length,
              closeRequested: view.status === 'CLOSE_REQUESTED',
            }
          : null,
      };
    }),
  );
  res.json(board);
});

const tableSchema = z.object({ name: text(40).min(1), number: z.number().int().min(1).max(9999), active: z.boolean().default(true) });

adminTablesRouter.post('/tables', requirePerm('tables.configure'), async (req, res) => {
  const t = await prisma.table.create({ data: { ...tableSchema.parse(req.body), token: newTableToken() } });
  await audit(staffActor(req), 'table.create', 'table', t.id, { name: t.name });
  res.status(201).json({ ...t, url: tableUrl(t.token) });
});

adminTablesRouter.put('/tables/:id', requirePerm('tables.configure'), async (req, res) => {
  const t = await prisma.table.update({ where: { id: String(req.params.id) }, data: tableSchema.parse(req.body) });
  await audit(staffActor(req), 'table.update', 'table', t.id);
  res.json({ ...t, url: tableUrl(t.token) });
});

/** Gera novo link: cartões/QR antigos param de funcionar imediatamente. */
adminTablesRouter.post('/tables/:id/regenerate', requirePerm('tables.configure'), async (req, res) => {
  const t = await prisma.table.update({ where: { id: String(req.params.id) }, data: { token: newTableToken() } });
  await audit(staffActor(req), 'table.regenerateLink', 'table', t.id);
  res.json({ ...t, url: tableUrl(t.token) });
});

adminTablesRouter.delete('/tables/:id', requirePerm('tables.configure'), async (req, res) => {
  const id = String(req.params.id);
  const sessions = await prisma.tableSession.count({ where: { tableId: id } });
  if (sessions) {
    const open = await currentSession(id);
    if (open) throw badRequest('TABLE_IN_USE', 'Feche a comanda da mesa antes de removê-la.');
    await prisma.table.update({ where: { id }, data: { active: false, token: newTableToken() } });
  } else {
    await prisma.table.delete({ where: { id } });
  }
  await audit(staffActor(req), 'table.delete', 'table', id);
  res.json({ ok: true });
});

adminTablesRouter.get('/tables/:id/qr.:format', requirePerm('tables.manage'), async (req, res) => {
  const t = await prisma.table.findUnique({ where: { id: String(req.params.id) } });
  if (!t) throw notFound();
  const url = tableUrl(t.token);
  const filename = `qrcode-${t.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  if (req.params.format === 'svg') {
    const svg = await QRCode.toString(url, { type: 'svg', errorCorrectionLevel: 'M', margin: 2, color: { dark: '#111111', light: '#ffffff' } });
    res.set('Content-Type', 'image/svg+xml');
    if (req.query.download) res.set('Content-Disposition', `attachment; filename="${filename}.svg"`);
    return res.send(svg);
  }
  if (req.params.format !== 'png') throw notFound();
  const png = await QRCode.toBuffer(url, { type: 'png', errorCorrectionLevel: 'M', margin: 2, width: 1024 });
  res.set('Content-Type', 'image/png');
  if (req.query.download) res.set('Content-Disposition', `attachment; filename="${filename}.png"`);
  res.send(png);
});

// ------------------------- Comandas (sessões) -------------------------

adminTablesRouter.post('/tables/:id/open', requirePerm('tables.manage'), async (req, res) => {
  const t = await prisma.table.findUnique({ where: { id: String(req.params.id) } });
  if (!t || !t.active) throw notFound();
  const s = await openSession(t.id, staffActor(req));
  res.json({ sessionId: s.id });
});

adminTablesRouter.get('/sessions/:id', requirePerm('tables.manage'), async (req, res) => {
  const s = await loadSession(String(req.params.id));
  res.json({ ...serializeSession(s), tableUrl: tableUrl(s.table.token) });
});

adminTablesRouter.get('/tables/:id/history', requirePerm('tables.manage'), async (req, res) => {
  const sessions = await prisma.tableSession.findMany({
    where: { tableId: String(req.params.id), status: 'CLOSED' },
    orderBy: { closedAt: 'desc' },
    take: 30,
    select: { id: true, openedAt: true, closedAt: true, forcedClose: true, forcedReason: true, _count: { select: { participants: true, orders: true } } },
  });
  res.json(sessions);
});

adminTablesRouter.post('/sessions/:id/people', requirePerm('tables.manage'), async (req, res) => {
  const { name } = z.object({ name: text(40).min(2) }).parse(req.body);
  const p = await addPerson(String(req.params.id), name, staffActor(req), null);
  res.status(201).json({ id: p.id, name: p.name });
});

adminTablesRouter.put('/sessions/:id/split', requirePerm('tables.manage'), async (req, res) => {
  const body = z.object({ mode: splitMode, config: splitConfig.optional() }).parse(req.body);
  await setSplit(String(req.params.id), body.mode, body.config ?? null, staffActor(req));
  res.json({ ok: true });
});

adminTablesRouter.put('/items/:itemId/allocations', requirePerm('tables.manage'), async (req, res) => {
  const body = z.object({ allocations: z.array(z.object({ participantId: z.string().max(40), weight: z.number().int().min(1).max(100) })).min(1).max(30) }).parse(req.body);
  await reallocateItem(String(req.params.itemId), body.allocations, staffActor(req));
  res.json({ ok: true });
});

adminTablesRouter.post('/sessions/:id/payments', requirePerm('payments.manage'), async (req, res) => {
  const body = z
    .object({
      method: paymentMethod,
      amountCents: z.number().int().min(1),
      allocations: z.array(z.object({ participantId: z.string().max(40), amountCents: z.number().int().min(0) })).max(30).default([]),
      confirm: z.boolean().default(true),
      notes: text(200).nullish(),
    })
    .parse(req.body);
  const key = idempotencyKey.parse(req.get('idempotency-key') ?? undefined);
  const p = await registerTablePayment(String(req.params.id), { ...body, idempotencyKey: key }, staffActor(req));
  res.status(201).json(p);
});

adminTablesRouter.post('/payments/:id/confirm', requirePerm('payments.manage'), async (req, res) => {
  await confirmPayment(String(req.params.id), staffActor(req));
  res.json({ ok: true });
});

adminTablesRouter.post('/payments/:id/void', requirePerm('payments.manage'), async (req, res) => {
  const { reason } = z.object({ reason: text(200).min(3, 'Informe o motivo') }).parse(req.body);
  await voidPayment(String(req.params.id), reason, staffActor(req));
  res.json({ ok: true });
});

/** Comprovante simples de pagamento. */
adminTablesRouter.get('/payments/:id/receipt', requirePerm('payments.manage'), async (req, res) => {
  const p = await prisma.payment.findUnique({
    where: { id: String(req.params.id) },
    include: { allocations: { include: { participant: true } }, session: { include: { table: true } }, order: true, confirmedBy: { select: { name: true } } },
  });
  if (!p) throw notFound();
  res.json(p);
});

adminTablesRouter.post('/sessions/:id/close', requirePerm('tables.manage'), async (req, res) => {
  const body = z.object({ force: z.boolean().default(false), reason: text(300).optional() }).parse(req.body ?? {});
  if (body.force && (!body.reason || body.reason.length < 5)) throw badRequest('REASON_REQUIRED', 'Informe o motivo do encerramento com pendência.');
  await closeSession(String(req.params.id), { ...staffActor(req), role: req.staff!.role }, body.force ? { reason: body.reason! } : undefined);
  res.json({ ok: true });
});

adminTablesRouter.post('/sessions/:id/transfer', requirePerm('tables.manage'), async (req, res) => {
  const { tableId } = z.object({ tableId: z.string().max(40) }).parse(req.body);
  await transferSession(String(req.params.id), tableId, staffActor(req));
  res.json({ ok: true });
});
