import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AlertTriangle } from 'lucide-react';
import { api } from '../lib/api';
import { useStore } from '../lib/context';
import { brl, todayISO } from '../lib/format';
import { Spinner } from '../components/ui';
import { PageTitle, useAdmin } from './AdminApp';

interface Dash {
  ordersToday: number; awaiting: number; preparing: number; completed: number; canceled: number; revenueCents: number; averageTicketCents: number;
  pastelsSold: number; drinksSold: number; combosSold: number; occupiedTables: number; deliveriesInProgress: number;
}
interface Point { bucket: string; orders: number; revenueCents: number; canceled: number }

const RANGES = { day: { label: 'Dia', days: 14 }, week: { label: 'Semana', days: 84 }, month: { label: 'Mês', days: 365 } } as const;

export default function Dashboard() {
  const { orderTick } = useAdmin();
  const [d, setD] = useState<Dash | null>(null);
  const [g, setG] = useState<keyof typeof RANGES>('day');
  const [series, setSeries] = useState<Point[] | null>(null);

  useEffect(() => {
    api<Dash>('/admin/finance/dashboard').then(setD).catch(() => {});
  }, [orderTick]);
  useEffect(() => {
    api<Point[]>(`/admin/finance/series?granularity=${g}&from=${todayISO(-RANGES[g].days)}&to=${todayISO()}`).then(setSeries).catch(() => setSeries([]));
  }, [g, orderTick]);

  if (!d) return <Spinner />;
  const tiles = [
    { label: 'Pedidos hoje', value: d.ordersToday },
    { label: 'Aguardando aceite', value: d.awaiting, alert: d.awaiting > 0, to: '/admin/pedidos' },
    { label: 'Em preparação', value: d.preparing },
    { label: 'Concluídos', value: d.completed },
    { label: 'Cancelados', value: d.canceled },
    { label: 'Faturamento do dia', value: brl(d.revenueCents) },
    { label: 'Ticket médio', value: brl(d.averageTicketCents) },
    { label: 'Pastéis vendidos', value: d.pastelsSold },
    { label: 'Refrigerantes vendidos', value: d.drinksSold },
    { label: 'Combos vendidos', value: d.combosSold },
    { label: 'Mesas ocupadas', value: d.occupiedTables, to: '/admin/mesas' },
    { label: 'Delivery em andamento', value: d.deliveriesInProgress },
  ];
  const fmtBucket = (b: string) => {
    const [y, m, day] = b.split('-');
    return g === 'month' ? `${m}/${y.slice(2)}` : `${day}/${m}`;
  };

  return (
    <div>
      <PageTitle title="Dashboard" />
      <SetupChecklist />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {tiles.map((t) => {
          const body = (
            <div className={`card h-full p-4 ${t.alert ? 'ring-2 ring-gold-500' : ''}`}>
              <p className="text-xs font-semibold text-ink-700">{t.label}</p>
              <p className="mt-1 font-display text-3xl font-extrabold">{t.value}</p>
            </div>
          );
          return t.to ? <Link key={t.label} to={t.to}>{body}</Link> : <div key={t.label}>{body}</div>;
        })}
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-2">
        {(Object.keys(RANGES) as (keyof typeof RANGES)[]).map((k) => (
          <button key={k} className={`btn-sm ${g === k ? 'btn-dark' : 'btn-ghost'}`} onClick={() => setG(k)}>Por {RANGES[k].label.toLowerCase()}</button>
        ))}
      </div>
      <div className="mt-3 grid gap-4 lg:grid-cols-2">
        <ChartCard title="Faturamento" data={series} dataKey="revenueCents" color="#D7261E" format={(v) => brl(v)} fmtBucket={fmtBucket} />
        <ChartCard title="Pedidos" data={series} dataKey="orders" color="#3a3a3a" format={(v) => String(v)} fmtBucket={fmtBucket} />
      </div>
    </div>
  );
}

function ChartCard({ title, data, dataKey, color, format, fmtBucket }: { title: string; data: Point[] | null; dataKey: 'revenueCents' | 'orders'; color: string; format: (v: number) => string; fmtBucket: (b: string) => string }) {
  return (
    <div className="card p-4">
      <h2 className="mb-2 text-xl font-bold">{title}</h2>
      {!data ? (
        <Spinner />
      ) : !data.length ? (
        <p className="py-10 text-center text-sm text-ink-700">Sem vendas no período.</p>
      ) : (
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap={2}>
              <CartesianGrid vertical={false} stroke="#00000012" />
              <XAxis dataKey="bucket" tickFormatter={fmtBucket} tick={{ fontSize: 11, fill: '#555' }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={(v) => (dataKey === 'revenueCents' ? `R$${Math.round(v / 100)}` : String(v))} tick={{ fontSize: 11, fill: '#555' }} axisLine={false} tickLine={false} width={56} allowDecimals={false} />
              <Tooltip cursor={{ fill: '#00000008' }} formatter={(v) => [format(Number(v)), title]} labelFormatter={(l) => fmtBucket(String(l))} />
              <Bar dataKey={dataKey} fill={color} radius={[4, 4, 0, 0]} maxBarSize={36} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

/** Itens obrigatórios de configuração antes de operar. */
function SetupChecklist() {
  const { info } = useStore();
  const [wa, setWa] = useState<{ ready: boolean } | null>(null);
  const { can } = useAdmin();
  useEffect(() => {
    if (can('integrations.manage')) api<{ ready: boolean }>('/admin/integrations/whatsapp').then(setWa).catch(() => {});
  }, [can]);
  if (!info || !can('settings.manage')) return null;
  const items = [
    { ok: info.hours.length > 0, text: 'Configure os horários de funcionamento (sem horários a loja aparece fechada).' },
    { ok: !info.delivery.enabled || info.delivery.areas.length > 0 || info.delivery.allowOutsideArea, text: 'Cadastre os bairros atendidos e as taxas de entrega.' },
    { ok: !info.payment.methods.PIX || !!info.payment.pixKey, text: 'Informe a chave PIX da loja.' },
    { ok: wa?.ready ?? true, text: 'WhatsApp automático não configurado — as mensagens ficam disponíveis para envio manual.' },
  ].filter((i) => !i.ok);
  if (!items.length) return null;
  return (
    <div className="card mb-5 border-l-4 border-gold-500 p-4">
      <p className="flex items-center gap-2 font-bold"><AlertTriangle className="text-gold-600" size={18} /> Pendências de configuração</p>
      <ul className="mt-1 list-disc pl-6 text-sm">
        {items.map((i) => <li key={i.text}>{i.text}</li>)}
      </ul>
      <Link to="/admin/configuracoes" className="mt-2 inline-block text-sm font-bold text-brand-600">Ir para configurações →</Link>
    </div>
  );
}
