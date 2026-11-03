import { Router } from 'express';
import { z } from 'zod';
import PDFDocument from 'pdfkit';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../db';
import { requirePerm, staffActor } from '../../middleware/auth';
import { audit } from '../../lib/audit';
import { formatBRL } from '../../lib/money';
import { statusLabel } from '../../lib/orderStatus';
import { getSettings } from '../../lib/settings';
import { dashboard, financeSummary, ordersForExport, periodFromQuery, salesSeries, topItems } from '../../services/reports';
import { cents, text } from '../schemas';

export const adminFinanceRouter = Router();

const periodQuery = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  granularity: z.enum(['day', 'week', 'month']).default('day'),
});

const METHOD_LABEL: Record<string, string> = { PIX: 'PIX', CASH: 'Dinheiro', DEBIT: 'Débito', CREDIT: 'Crédito', IN_PERSON: 'Presencial' };

adminFinanceRouter.get('/dashboard', requirePerm('dashboard.view'), async (_req, res) => {
  res.json(await dashboard());
});

adminFinanceRouter.get('/series', requirePerm('dashboard.view'), async (req, res) => {
  const q = periodQuery.parse(req.query);
  const { start, end, tz } = await periodFromQuery(q.from, q.to);
  res.json(await salesSeries(start, end, tz, q.granularity));
});

adminFinanceRouter.get('/summary', requirePerm('finance.view'), async (req, res) => {
  const q = periodQuery.parse(req.query);
  const { start, end } = await periodFromQuery(q.from, q.to);
  res.json({ period: { start, end }, ...(await financeSummary(start, end)) });
});

adminFinanceRouter.get('/top', requirePerm('finance.view'), async (req, res) => {
  const q = periodQuery.parse(req.query);
  const { start, end } = await periodFromQuery(q.from, q.to);
  res.json(await topItems(start, end));
});

function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // evita injeção de fórmulas em planilhas
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const money = (c: number) => (c / 100).toFixed(2).replace('.', ',');

adminFinanceRouter.get('/export.csv', requirePerm('finance.view'), async (req, res) => {
  const q = periodQuery.parse(req.query);
  const { start, end, tz } = await periodFromQuery(q.from, q.to);
  const rows = await ordersForExport(start, end);
  const fmt = new Intl.DateTimeFormat('pt-BR', { timeZone: tz, dateStyle: 'short', timeStyle: 'short' });
  const header = ['Pedido', 'Data', 'Tipo', 'Status', 'Cliente', 'Pagamento', 'Situação pagamento', 'Valor cheio', 'Economia promoções', 'Desconto cupom', 'Taxa entrega', 'Total', 'Motivo cancelamento'];
  const lines = rows.map((o) =>
    [o.number, fmt.format(o.createdAt), o.type, statusLabel(o.type, o.status), o.customerName, METHOD_LABEL[o.paymentMethod], o.paymentStatus, money(o.grossCents), money(o.comboSavingsCents), money(o.discountCents), money(o.deliveryFeeCents), money(o.totalCents), o.cancelReason]
      .map(csvCell)
      .join(';'),
  );
  await audit(staffActor(req), 'finance.exportCsv', 'report', null, { from: q.from, to: q.to });
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="vendas-${q.from ?? 'inicio'}-${q.to ?? 'hoje'}.csv"`);
  res.send('﻿' + [header.join(';'), ...lines].join('\r\n'));
});

adminFinanceRouter.get('/export.pdf', requirePerm('finance.view'), async (req, res) => {
  const q = periodQuery.parse(req.query);
  const { start, end, tz } = await periodFromQuery(q.from, q.to);
  const [summary, top, settings] = await Promise.all([financeSummary(start, end), topItems(start, end), getSettings()]);
  const dfmt = new Intl.DateTimeFormat('pt-BR', { timeZone: tz, dateStyle: 'short' });
  await audit(staffActor(req), 'finance.exportPdf', 'report', null, { from: q.from, to: q.to });

  res.set('Content-Type', 'application/pdf');
  res.set('Content-Disposition', `attachment; filename="relatorio-${q.from ?? 'inicio'}-${q.to ?? 'hoje'}.pdf"`);
  const doc = new PDFDocument({ size: 'A4', margin: 48 });
  doc.pipe(res);
  doc.fontSize(20).fillColor('#B91C1C').text(settings.store.name, { continued: false });
  doc.fontSize(12).fillColor('#111').text(`Relatório financeiro — ${dfmt.format(start)} a ${dfmt.format(new Date(end.getTime() - 1))}`);
  doc.moveDown();
  const row = (label: string, value: string) => {
    doc.fontSize(11).fillColor('#333').text(label, { continued: true }).fillColor('#000').text(`  ${value}`, { align: 'left' });
  };
  doc.fontSize(14).fillColor('#000').text('Resumo');
  doc.moveDown(0.3);
  row('Pedidos válidos:', String(summary.orders));
  row('Valor cheio dos itens:', formatBRL(summary.grossCents));
  row('Economia em combos/promoções:', `- ${formatBRL(summary.promoSavingsCents)}`);
  row('Descontos de cupons:', `- ${formatBRL(summary.couponDiscountCents)}`);
  row('Taxas de entrega:', formatBRL(summary.deliveryFeesCents));
  row('Faturamento bruto:', formatBRL(summary.revenueCents));
  row('Ticket médio:', formatBRL(summary.averageTicketCents));
  row('Recebimentos confirmados:', formatBRL(summary.receivedCents));
  row('Pendentes de pagamento:', `${formatBRL(summary.pendingCents)} (${summary.pendingCount} pedidos)`);
  row('Cancelamentos:', `${summary.canceled.count} (${formatBRL(summary.canceled.totalCents)})`);
  row('Estornos pendentes:', `${summary.refundsPending.count} (${formatBRL(summary.refundsPending.totalCents)})`);
  doc.moveDown(0.5);
  row('Custo dos produtos (cadastrados):', formatBRL(summary.productCostCents));
  row('Despesas lançadas:', formatBRL(summary.expensesCents));
  row('Lucro estimado:', formatBRL(summary.estimatedProfitCents));
  if (summary.itemsWithoutCost) doc.fontSize(9).fillColor('#92400E').text(`Atenção: ${summary.itemsWithoutCost} item(ns) vendidos sem custo cadastrado — o lucro estimado pode estar superestimado.`);
  doc.moveDown();
  doc.fontSize(14).fillColor('#000').text('Vendas por forma de pagamento');
  for (const m of summary.salesByMethod) row(`${METHOD_LABEL[m.method]}:`, `${formatBRL(m.totalCents)} (${m.count})`);
  doc.moveDown();
  doc.fontSize(14).text('Produtos mais vendidos');
  for (const p of top.products.slice(0, 10)) row(`${p.name}:`, `${p.quantity} un. — ${formatBRL(p.totalCents)}`);
  doc.moveDown();
  doc.fontSize(14).text('Combos mais vendidos');
  for (const p of top.combos.slice(0, 10)) row(`${p.name}:`, `${p.quantity} un. — ${formatBRL(p.totalCents)}`);
  doc.moveDown();
  doc.fontSize(8).fillColor('#666').text('Faturamento não é lucro. O lucro estimado considera apenas custos de produtos cadastrados e despesas lançadas no sistema.');
  doc.end();
});

// ----------------------------- Despesas -----------------------------

const expenseSchema = z.object({
  description: text(150).min(2),
  category: text(60).default('Geral'),
  amountCents: cents.min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

adminFinanceRouter.get('/expenses', requirePerm('finance.view'), async (req, res) => {
  const q = periodQuery.parse(req.query);
  const { start, end } = await periodFromQuery(q.from, q.to);
  res.json(await prisma.expense.findMany({ where: { date: { gte: start, lt: end } }, orderBy: { date: 'desc' } }));
});

const expenseData = (b: z.infer<typeof expenseSchema>): Prisma.ExpenseCreateInput => ({
  description: b.description,
  category: b.category,
  amountCents: b.amountCents,
  date: new Date(`${b.date}T12:00:00Z`),
});

adminFinanceRouter.post('/expenses', requirePerm('finance.view'), async (req, res) => {
  const e = await prisma.expense.create({ data: expenseData(expenseSchema.parse(req.body)) });
  await audit(staffActor(req), 'expense.create', 'expense', e.id, { amountCents: e.amountCents });
  res.status(201).json(e);
});

adminFinanceRouter.put('/expenses/:id', requirePerm('finance.view'), async (req, res) => {
  const e = await prisma.expense.update({ where: { id: String(req.params.id) }, data: expenseData(expenseSchema.parse(req.body)) });
  await audit(staffActor(req), 'expense.update', 'expense', e.id);
  res.json(e);
});

adminFinanceRouter.delete('/expenses/:id', requirePerm('finance.view'), async (req, res) => {
  await prisma.expense.delete({ where: { id: String(req.params.id) } });
  await audit(staffActor(req), 'expense.delete', 'expense', String(req.params.id));
  res.json({ ok: true });
});
