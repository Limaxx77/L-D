import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { api } from '../lib/api';
import { brl, dateTime, formatPhone, TYPE_LABELS } from '../lib/format';
import { Modal, Spinner, StatusBadge } from '../components/ui';
import { PageTitle } from './AdminApp';

interface Row { id: string; name: string; phone: string; email: string | null; registered: boolean; whatsappOptIn: boolean; totalSpentCents: number; ordersCount: number; lastOrderAt: string | null }
interface Detail {
  id: string; name: string; phone: string; email: string | null; registered: boolean; createdAt: string;
  addresses: { id: string; street: string; number: string; neighborhood: string; complement: string | null }[];
  orders: { id: string; number: number; type: string; status: string; totalCents: number; createdAt: string }[];
}

export default function Customers() {
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<'recent' | 'spent' | 'orders'>('recent');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ total: number; customers: Row[] } | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  useEffect(() => {
    const t = setTimeout(() => {
      api<{ total: number; customers: Row[] }>(`/admin/customers?search=${encodeURIComponent(search)}&sort=${sort}&page=${page}`).then(setData).catch(() => {});
    }, 250);
    return () => clearTimeout(t);
  }, [search, sort, page]);

  return (
    <div>
      <PageTitle title="Clientes" />
      <div className="mb-4 flex flex-wrap gap-2">
        <div className="relative min-w-60 flex-1">
          <Search size={16} className="absolute left-3 top-3.5 text-black/40" />
          <input className="input pl-9" placeholder="Buscar por nome ou telefone" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        </div>
        <select className="input w-auto" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
          <option value="recent">Mais recentes</option><option value="spent">Maior gasto (página)</option><option value="orders">Mais pedidos (página)</option>
        </select>
      </div>
      {!data ? <Spinner /> : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-gold-50 text-left">
              <tr><th className="p-3">Nome</th><th>Telefone</th><th>Compras</th><th>Total gasto</th><th>Última compra</th><th>Conta</th></tr>
            </thead>
            <tbody className="divide-y divide-black/5">
              {data.customers.map((c) => (
                <tr key={c.id} className="cursor-pointer hover:bg-gold-50/60" onClick={() => api<Detail>(`/admin/customers/${c.id}`).then(setDetail)}>
                  <td className="p-3 font-semibold">{c.name}</td>
                  <td>{formatPhone(c.phone)}</td>
                  <td>{c.ordersCount}</td>
                  <td>{brl(c.totalSpentCents)}</td>
                  <td>{c.lastOrderAt ? dateTime(c.lastOrderAt) : '—'}</td>
                  <td>{c.registered ? 'Cadastrado' : 'Visitante'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex items-center justify-between p-3 text-sm">
            <span>{data.total} cliente(s)</span>
            <span className="flex gap-2">
              <button className="btn-ghost btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Anterior</button>
              <button className="btn-ghost btn-sm" disabled={page * 30 >= data.total} onClick={() => setPage(page + 1)}>Próxima</button>
            </span>
          </div>
        </div>
      )}
      <p className="mt-3 text-xs text-ink-700">Dados pessoais protegidos pela LGPD. Cada consulta de cliente é registrada na auditoria.</p>
      {detail && (
        <Modal open onClose={() => setDetail(null)} size="lg" title={detail.name}>
          <p className="text-sm">{formatPhone(detail.phone)}{detail.email ? ` · ${detail.email}` : ''} · cliente desde {dateTime(detail.createdAt)}</p>
          {detail.addresses.length > 0 && (
            <div className="mt-3">
              <p className="label">Endereços</p>
              <ul className="text-sm">{detail.addresses.map((a) => <li key={a.id}>{a.street}, {a.number} — {a.neighborhood}{a.complement ? ` (${a.complement})` : ''}</li>)}</ul>
            </div>
          )}
          <p className="label mt-4">Histórico de pedidos</p>
          <ul className="divide-y divide-black/5 text-sm">
            {detail.orders.map((o) => (
              <li key={o.id} className="flex items-center justify-between py-2">
                <span>#{o.number} · {TYPE_LABELS[o.type]} · {dateTime(o.createdAt)}</span>
                <span className="flex items-center gap-2"><StatusBadge status={o.status} label={o.status === 'CANCELED' ? 'Cancelado' : 'OK'} /> {brl(o.totalCents)}</span>
              </li>
            ))}
          </ul>
        </Modal>
      )}
    </div>
  );
}
