import { useCallback, useEffect, useState } from 'react';
import { Download, Plus, Trash2 } from 'lucide-react';
import { api, apiUrl } from '../lib/api';
import { useToast } from '../lib/context';
import { brl, centsToInput, dateTime, parseBRL, PAYMENT_LABELS, todayISO } from '../lib/format';
import { Field, Modal, Spinner } from '../components/ui';
import { PageTitle } from './AdminApp';

interface Summary {
  orders: number; grossCents: number; promoSavingsCents: number; couponDiscountCents: number; deliveryFeesCents: number; revenueCents: number; averageTicketCents: number;
  canceled: { count: number; totalCents: number }; refundsPending: { count: number; totalCents: number };
  salesByMethod: { method: string; count: number; totalCents: number }[]; receivedByMethod: { method: string; count: number; totalCents: number }[];
  receivedCents: number; pendingCents: number; pendingCount: number; openTableSessions: number; productCostCents: number; itemsWithoutCost: number; expensesCents: number; estimatedProfitCents: number;
}

function usePeriod() {
  const [from, setFrom] = useState(todayISO(-29));
  const [to, setTo] = useState(todayISO());
  const qs = `from=${from}&to=${to}`;
  const bar = (
    <div className="flex flex-wrap items-end gap-2">
      <Field label="De"><input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
      <Field label="Até"><input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
      {[['Hoje', 0], ['7 dias', 6], ['30 dias', 29]].map(([l, d]) => (
        <button key={l} className="btn-ghost btn-sm mb-1" onClick={() => { setFrom(todayISO(-Number(d))); setTo(todayISO()); }}>{l}</button>
      ))}
      <a className="btn-ghost btn-sm mb-1" href={apiUrl(`/admin/finance/export.csv?${qs}`)}><Download size={14} /> CSV</a>
      <a className="btn-ghost btn-sm mb-1" href={apiUrl(`/admin/finance/export.pdf?${qs}`)}><Download size={14} /> PDF</a>
    </div>
  );
  return { qs, bar };
}

const Tile = ({ label, value, hint }: { label: string; value: string; hint?: string }) => (
  <div className="card p-4">
    <p className="text-xs font-semibold text-ink-700">{label}</p>
    <p className="mt-1 font-display text-2xl font-extrabold">{value}</p>
    {hint && <p className="text-xs text-ink-700">{hint}</p>}
  </div>
);

export function Finance() {
  const { qs, bar } = usePeriod();
  const [s, setS] = useState<Summary | null>(null);
  useEffect(() => {
    setS(null);
    api<Summary>(`/admin/finance/summary?${qs}`).then(setS).catch(() => {});
  }, [qs]);
  return (
    <div>
      <PageTitle title="Financeiro" />
      <div className="card mb-5 p-4">{bar}</div>
      {!s ? <Spinner /> : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Tile label="Faturamento bruto" value={brl(s.revenueCents)} hint={`${s.orders} pedidos`} />
            <Tile label="Recebimentos confirmados" value={brl(s.receivedCents)} />
            <Tile label="Contas pendentes" value={brl(s.pendingCents)} hint={`${s.pendingCount} pedido(s) · ${s.openTableSessions} mesa(s) abertas`} />
            <Tile label="Ticket médio" value={brl(s.averageTicketCents)} />
            <Tile label="Economia em combos/promoções" value={brl(s.promoSavingsCents)} hint="Já embutida nos preços" />
            <Tile label="Descontos de cupons" value={brl(s.couponDiscountCents)} />
            <Tile label="Taxas de entrega" value={brl(s.deliveryFeesCents)} />
            <Tile label="Cancelamentos" value={String(s.canceled.count)} hint={`${brl(s.canceled.totalCents)} · estornos pendentes: ${s.refundsPending.count}`} />
          </div>
          <div className="card mt-5 p-5">
            <h2 className="text-xl font-bold">Lucro estimado</h2>
            <p className="text-sm text-ink-700">Faturamento não é lucro. Este cálculo usa os custos cadastrados nos produtos e as despesas lançadas abaixo.</p>
            <dl className="mt-3 max-w-md space-y-1 text-sm">
              <div className="flex justify-between"><dt>Faturamento</dt><dd>{brl(s.revenueCents)}</dd></div>
              <div className="flex justify-between"><dt>(−) Custo dos produtos</dt><dd>{brl(s.productCostCents)}</dd></div>
              <div className="flex justify-between"><dt>(−) Despesas</dt><dd>{brl(s.expensesCents)}</dd></div>
              <div className="flex justify-between border-t pt-1 text-lg font-extrabold"><dt>Lucro estimado</dt><dd>{brl(s.estimatedProfitCents)}</dd></div>
            </dl>
            {s.itemsWithoutCost > 0 && <p className="mt-2 text-xs font-semibold text-gold-700">{s.itemsWithoutCost} item(ns) vendidos sem custo cadastrado — o lucro está superestimado.</p>}
          </div>
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <MethodTable title="Vendas por forma de pagamento" rows={s.salesByMethod} />
            <MethodTable title="Recebimentos por forma" rows={s.receivedByMethod} />
          </div>
          <Expenses qs={qs} />
        </>
      )}
    </div>
  );
}

function MethodTable({ title, rows }: { title: string; rows: { method: string; count: number; totalCents: number }[] }) {
  return (
    <div className="card p-4">
      <h3 className="mb-2 font-bold">{title}</h3>
      <table className="w-full text-sm">
        <tbody className="divide-y divide-black/5">
          {rows.map((r) => <tr key={r.method}><td className="py-1.5">{PAYMENT_LABELS[r.method]}</td><td className="text-right">{r.count}</td><td className="text-right font-semibold">{brl(r.totalCents)}</td></tr>)}
          {!rows.length && <tr><td className="py-2 text-ink-700">Sem registros.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

interface Expense { id: string; description: string; category: string; amountCents: number; date: string }

function Expenses({ qs }: { qs: string }) {
  const toast = useToast();
  const [list, setList] = useState<Expense[]>([]);
  const [edit, setEdit] = useState<{ id?: string; description: string; category: string; amount: string; date: string } | null>(null);
  const load = useCallback(() => api<Expense[]>(`/admin/finance/expenses?${qs}`).then(setList).catch(() => {}), [qs]);
  useEffect(() => {
    void load();
  }, [load]);
  const save = async () => {
    if (!edit) return;
    try {
      const body = { description: edit.description, category: edit.category || 'Geral', amountCents: parseBRL(edit.amount) ?? 0, date: edit.date };
      await api(edit.id ? `/admin/finance/expenses/${edit.id}` : '/admin/finance/expenses', { method: edit.id ? 'PUT' : 'POST', body });
      setEdit(null);
      void load();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };
  return (
    <div className="card mt-5 p-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="font-bold">Custos e despesas</h3>
        <button className="btn-ghost btn-sm" onClick={() => setEdit({ description: '', category: 'Geral', amount: '', date: todayISO() })}><Plus size={14} /> Lançar despesa</button>
      </div>
      <table className="w-full text-sm">
        <tbody className="divide-y divide-black/5">
          {list.map((e) => (
            <tr key={e.id}>
              <td className="py-1.5">{e.date.slice(0, 10).split('-').reverse().join('/')}</td>
              <td><button className="text-left underline decoration-dotted" onClick={() => setEdit({ id: e.id, description: e.description, category: e.category, amount: centsToInput(e.amountCents), date: e.date.slice(0, 10) })}>{e.description}</button></td>
              <td className="text-ink-700">{e.category}</td>
              <td className="text-right font-semibold">{brl(e.amountCents)}</td>
              <td className="text-right"><button className="text-brand-700" onClick={() => window.confirm('Excluir despesa?') && api(`/admin/finance/expenses/${e.id}`, { method: 'DELETE' }).then(load)}><Trash2 size={14} /></button></td>
            </tr>
          ))}
          {!list.length && <tr><td className="py-2 text-ink-700">Nenhuma despesa no período.</td></tr>}
        </tbody>
      </table>
      {edit && (
        <Modal open onClose={() => setEdit(null)} size="sm" title="Despesa" footer={<button className="btn-primary w-full" onClick={save}>Salvar</button>}>
          <div className="space-y-3">
            <Field label="Descrição"><input className="input" value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></Field>
            <Field label="Categoria"><input className="input" value={edit.category} onChange={(e) => setEdit({ ...edit, category: e.target.value })} placeholder="Insumos, aluguel, gás..." /></Field>
            <Field label="Valor (R$)"><input className="input" inputMode="decimal" value={edit.amount} onChange={(e) => setEdit({ ...edit, amount: e.target.value })} /></Field>
            <Field label="Data"><input className="input" type="date" value={edit.date} onChange={(e) => setEdit({ ...edit, date: e.target.value })} /></Field>
          </div>
        </Modal>
      )}
    </div>
  );
}

interface Top { products: Rank[]; combos: Rank[]; comboFlavors: Rank[] }
interface Rank { name: string; quantity: number; totalCents: number }
interface OrderRow { id: string; number: number; createdAt: string; customerName: string; type: string; statusLabel: string; totalCents: number; paymentMethod: string }

export function Reports() {
  const { qs, bar } = usePeriod();
  const [top, setTop] = useState<Top | null>(null);
  const [orders, setOrders] = useState<{ total: number; orders: OrderRow[] } | null>(null);
  const [page, setPage] = useState(1);
  const [range] = [qs.match(/from=([\d-]+)&to=([\d-]+)/)!];
  useEffect(() => {
    api<Top>(`/admin/finance/top?${qs}`).then(setTop).catch(() => {});
  }, [qs]);
  useEffect(() => {
    const from = new Date(`${range[1]}T00:00:00`).toISOString();
    const to = new Date(new Date(`${range[2]}T00:00:00`).getTime() + 86_400_000).toISOString();
    api<{ total: number; orders: OrderRow[] }>(`/admin/orders?from=${from}&to=${to}&page=${page}`).then(setOrders).catch(() => {});
  }, [qs, page]); // eslint-disable-line react-hooks/exhaustive-deps

  const RankList = ({ title, rows, money = true }: { title: string; rows: Rank[]; money?: boolean }) => {
    const max = Math.max(1, ...rows.map((r) => r.quantity));
    return (
      <div className="card p-4">
        <h3 className="mb-3 font-bold">{title}</h3>
        <ul className="space-y-2 text-sm">
          {rows.map((r) => (
            <li key={r.name}>
              <div className="flex justify-between"><span className="font-semibold">{r.name}</span><span>{r.quantity} un.{money ? ` · ${brl(r.totalCents)}` : ''}</span></div>
              <div className="mt-1 h-2 rounded-full bg-gold-100"><div className="h-2 rounded-full bg-brand-600" style={{ width: `${(r.quantity / max) * 100}%` }} /></div>
            </li>
          ))}
          {!rows.length && <li className="text-ink-700">Sem vendas no período.</li>}
        </ul>
      </div>
    );
  };

  return (
    <div>
      <PageTitle title="Relatórios" />
      <div className="card mb-5 p-4">{bar}</div>
      {!top ? <Spinner /> : (
        <div className="grid gap-4 lg:grid-cols-3">
          <RankList title="Produtos mais vendidos (avulsos)" rows={top.products} />
          <RankList title="Combos mais vendidos" rows={top.combos} />
          <RankList title="Sabores escolhidos nos combos" rows={top.comboFlavors} money={false} />
        </div>
      )}
      <div className="card mt-5 overflow-x-auto p-4">
        <h3 className="mb-2 font-bold">Pedidos do período</h3>
        {!orders ? <Spinner /> : (
          <>
            <table className="w-full min-w-[600px] text-sm">
              <thead className="text-left text-ink-700"><tr><th className="py-1">#</th><th>Data</th><th>Cliente</th><th>Tipo</th><th>Status</th><th>Pagamento</th><th className="text-right">Total</th></tr></thead>
              <tbody className="divide-y divide-black/5">
                {orders.orders.map((o) => (
                  <tr key={o.id}><td className="py-1.5 font-semibold">{o.number}</td><td>{dateTime(o.createdAt)}</td><td>{o.customerName}</td><td>{o.type}</td><td>{o.statusLabel}</td><td>{PAYMENT_LABELS[o.paymentMethod]}</td><td className="text-right">{brl(o.totalCents)}</td></tr>
                ))}
              </tbody>
            </table>
            <div className="mt-2 flex justify-between text-sm">
              <span>{orders.total} pedido(s)</span>
              <span className="flex gap-2">
                <button className="btn-ghost btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Anterior</button>
                <button className="btn-ghost btn-sm" disabled={page * 30 >= orders.total} onClick={() => setPage(page + 1)}>Próxima</button>
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
