import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bike, Check, ChefHat, Clock, MapPin, MessageCircle, Phone, Printer, Store, UtensilsCrossed, X } from 'lucide-react';
import { api, newIdempotencyKey } from '../lib/api';
import { useStore, useToast } from '../lib/context';
import { brl, dateTime, formatPhone, minutesSince, PAYMENT_LABELS, time, TYPE_LABELS } from '../lib/format';
import { Empty, Field, Modal, Spinner, StatusBadge } from '../components/ui';
import { PageTitle, useAdmin } from './AdminApp';
import { printOrder, type PrintableOrder } from './print';

export interface AdminOrder extends PrintableOrder {
  id: string;
  publicToken: string;
  status: string;
  statusLabel: string;
  acceptedAt: string | null;
  scheduledFor: string | null;
  cancelReason: string | null;
  courierId: string | null;
  courier: { id: string; name: string } | null;
  whatsappOptIn: boolean;
  itemsTotalCents: number;
  couponCode: string | null;
  items: (PrintableOrder['items'][number] & { id: string })[];
  payments: { id: string; amountCents: number; method: string; status: string }[];
  statusHistory: { toStatus: string; createdAt: string; note: string | null }[];
}

const NEXT: Record<string, Record<string, { to: string; label: string }>> = {
  DELIVERY: { ACCEPTED: { to: 'PREPARING', label: 'Iniciar preparo' }, PREPARING: { to: 'READY', label: 'Pronto' }, READY: { to: 'OUT_FOR_DELIVERY', label: 'Saiu para entrega' }, OUT_FOR_DELIVERY: { to: 'DELIVERED', label: 'Entregue' } },
  PICKUP: { ACCEPTED: { to: 'PREPARING', label: 'Iniciar preparo' }, PREPARING: { to: 'READY', label: 'Pronto p/ retirada' }, READY: { to: 'PICKED_UP', label: 'Retirado' } },
  TABLE: { ACCEPTED: { to: 'PREPARING', label: 'Iniciar preparo' }, PREPARING: { to: 'READY', label: 'Pronto' }, READY: { to: 'SERVED', label: 'Entregue na mesa' } },
};

const COLUMNS = [
  { title: 'Aguardando', statuses: ['AWAITING_ACCEPT'], tone: 'bg-gold-500' },
  { title: 'Aceitos', statuses: ['ACCEPTED'], tone: 'bg-sky-600' },
  { title: 'Preparando', statuses: ['PREPARING'], tone: 'bg-orange-500' },
  { title: 'Prontos', statuses: ['READY', 'OUT_FOR_DELIVERY'], tone: 'bg-emerald-600' },
  { title: 'Finalizados', statuses: ['DELIVERED', 'PICKED_UP', 'SERVED', 'CANCELED'], tone: 'bg-ink-700' },
];

export function useBoard() {
  const { orderTick } = useAdmin();
  const [orders, setOrders] = useState<AdminOrder[] | null>(null);
  const load = useCallback(() => api<AdminOrder[]>('/admin/orders/board').then(setOrders).catch(() => {}), []);
  useEffect(() => {
    void load();
  }, [load, orderTick]);
  useEffect(() => {
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load]);
  return { orders, reload: load };
}

// ------------------- WhatsApp com um clique (sem API da Meta) -------------------

const WA_KEY = 'ld-wa-auto';
export const waAutoOpen = () => {
  try {
    return localStorage.getItem(WA_KEY) !== '0';
  } catch {
    return true;
  }
};
export const setWaAutoOpen = (v: boolean) => {
  try {
    localStorage.setItem(WA_KEY, v ? '1' : '0');
  } catch {
    /* ignora */
  }
};

/**
 * Abre a janela ainda no clique (senão o navegador bloqueia o pop-up),
 * executa a ação e então leva a janela para o WhatsApp com a mensagem pronta.
 */
export async function withWhatsApp<T>(
  o: { id: string; customerPhone: string | null; whatsappOptIn?: boolean },
  event: string,
  action: () => Promise<T>,
  opts: { force?: boolean } = {},
): Promise<T> {
  const open = !!o.customerPhone && (opts.force || (waAutoOpen() && o.whatsappOptIn !== false));
  const win = open ? window.open('about:blank', '_blank') : null;
  try {
    const result = await action();
    if (win) {
      const r = await api<{ url: string | null }>(`/admin/orders/${o.id}/whatsapp-link?event=${event}`);
      if (r.url) win.location.href = r.url;
      else win.close();
    }
    return result;
  } catch (e) {
    win?.close();
    throw e;
  }
}

const typeIcon = (t: string) => (t === 'DELIVERY' ? <Bike size={14} /> : t === 'PICKUP' ? <Store size={14} /> : <UtensilsCrossed size={14} />);

export default function Orders() {
  const { orders, reload } = useBoard();
  const { can } = useAdmin();
  const [filter, setFilter] = useState<'ALL' | 'DELIVERY' | 'PICKUP' | 'TABLE'>('ALL');
  const [accepting, setAccepting] = useState<AdminOrder | null>(null);
  const [refusing, setRefusing] = useState<AdminOrder | null>(null);
  const [detail, setDetail] = useState<AdminOrder | null>(null);
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  if (!orders) return <Spinner />;
  const list = orders.filter((o) => filter === 'ALL' || o.type === filter);

  return (
    <div>
      <PageTitle title="Pedidos">
        {(['ALL', 'DELIVERY', 'PICKUP', 'TABLE'] as const).map((f) => (
          <button key={f} className={`btn-sm ${filter === f ? 'btn-dark' : 'btn-ghost'}`} onClick={() => setFilter(f)}>
            {f === 'ALL' ? 'Todos' : TYPE_LABELS[f]}
          </button>
        ))}
      </PageTitle>
      <div className="-mx-4 flex snap-x gap-4 overflow-x-auto px-4 pb-4 xl:mx-0 xl:grid xl:grid-cols-5 xl:overflow-visible xl:px-0">
        {COLUMNS.map((col) => {
          const items = list.filter((o) => col.statuses.includes(o.status));
          return (
            <section key={col.title} className="w-[85vw] max-w-sm shrink-0 snap-start xl:w-auto xl:max-w-none">
              <h2 className="mb-2 flex items-center gap-2 font-display text-lg font-bold">
                <span className={`h-3 w-3 rounded-full ${col.tone}`} /> {col.title}
                <span className="chip bg-black/10">{items.length}</span>
              </h2>
              <div className="space-y-3">
                {items.map((o) => (
                  <OrderCard key={o.id} o={o} onAccept={() => setAccepting(o)} onRefuse={() => setRefusing(o)} onOpen={() => setDetail(o)} onChanged={reload} canManage={can('orders.manage')} />
                ))}
                {!items.length && <p className="rounded-2xl border-2 border-dashed border-black/10 p-4 text-center text-sm text-black/40">Nenhum pedido</p>}
              </div>
            </section>
          );
        })}
      </div>
      {accepting && <AcceptModal order={accepting} onClose={() => setAccepting(null)} onDone={reload} />}
      {refusing && <RefuseModal order={refusing} onClose={() => setRefusing(null)} onDone={reload} />}
      {detail && <OrderDetail id={detail.id} onClose={() => setDetail(null)} onChanged={reload} />}
    </div>
  );
}

function OrderCard({ o, onAccept, onRefuse, onOpen, onChanged, canManage }: { o: AdminOrder; onAccept: () => void; onRefuse: () => void; onOpen: () => void; onChanged: () => void; canManage: boolean }) {
  const toast = useToast();
  const { info } = useStore();
  const [busy, setBusy] = useState(false);
  const next = NEXT[o.type]?.[o.status];
  const elapsed = minutesSince(o.createdAt);
  const eta = o.acceptedAt && o.estimatedMinutes ? new Date(new Date(o.acceptedAt).getTime() + o.estimatedMinutes * 60_000) : null;
  const late = eta && Date.now() > eta.getTime() && !['DELIVERED', 'PICKED_UP', 'SERVED', 'CANCELED'].includes(o.status);
  const isNew = o.status === 'AWAITING_ACCEPT';

  const advance = async () => {
    if (!next) return;
    setBusy(true);
    try {
      const go = () => api(`/admin/orders/${o.id}/status`, { body: { status: next.to } });
      if (o.type === 'TABLE') await go();
      else await withWhatsApp(o, EVENT_FOR_STATUS[next.to], go);
      onChanged();
    } catch (e) {
      toast((e as Error).message, 'error');
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className={`card overflow-hidden ${isNew ? 'animate-pulse-ring ring-2 ring-gold-500' : ''} ${o.status === 'CANCELED' ? 'opacity-60' : ''}`}>
      <button onClick={onOpen} className="block w-full p-3 text-left">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="font-display text-xl font-extrabold leading-none">#{o.number}</p>
            <p className="mt-1 flex items-center gap-1 text-xs font-semibold text-ink-700">
              {typeIcon(o.type)} {TYPE_LABELS[o.type]}
              {o.table ? ` · ${o.table.name}` : ''} · {time(o.createdAt)}
            </p>
          </div>
          <div className="text-right">
            <p className="font-bold">{brl(o.totalCents)}</p>
            <p className={`text-xs font-semibold ${elapsed > 30 && isNew ? 'text-brand-700' : 'text-ink-700'}`}>
              <Clock size={12} className="inline" /> {elapsed} min
            </p>
          </div>
        </div>
        <p className="mt-2 font-semibold">{o.customerName}</p>
        {o.customerPhone && <p className="text-xs text-ink-700">{formatPhone(o.customerPhone)}</p>}
        {o.type === 'DELIVERY' && (
          <p className="mt-1 flex gap-1 text-xs text-ink-700">
            <MapPin size={12} className="mt-0.5 shrink-0" /> {o.addressStreet}, {o.addressNumber} — {o.addressDistrict}
          </p>
        )}
        <ul className="mt-2 space-y-0.5 text-sm">
          {o.items.filter((i) => !i.canceledAt).map((i) => (
            <li key={i.id}>
              <span className="font-semibold">{i.quantity}x {i.name}</span>
              {i.description && <span className="block text-xs text-ink-700">{i.description}</span>}
              {i.notes && <span className="block text-xs font-semibold text-brand-700">Obs: {i.notes}</span>}
            </li>
          ))}
        </ul>
        {o.notes && <p className="mt-1 text-xs font-semibold text-brand-700">Obs. geral: {o.notes}</p>}
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
          <span className="chip bg-black/5">{PAYMENT_LABELS[o.paymentMethod]}{o.paymentStatus === 'PAID' ? ' ✓' : ''}</span>
          {o.changeForCents && <span className="chip bg-gold-100">Troco p/ {brl(o.changeForCents)}</span>}
          {o.paymentStatus === 'REFUND_PENDING' && <span className="chip bg-brand-100 text-brand-700">Estorno pendente</span>}
          {eta && <span className={`chip ${late ? 'bg-brand-600 text-white' : 'bg-sky-100 text-sky-800'}`}>Prazo {time(eta)}</span>}
          {o.scheduledFor && <span className="chip bg-indigo-100 text-indigo-800">Agendado {dateTime(o.scheduledFor)}</span>}
          {o.courier && <span className="chip bg-indigo-100 text-indigo-800">🛵 {o.courier.name}</span>}
          {o.status === 'CANCELED' && <span className="chip bg-brand-100 text-brand-700">{o.cancelReason}</span>}
        </div>
      </button>
      <div className="flex gap-2 border-t border-black/5 p-2">
        {isNew && canManage ? (
          <>
            <button className="btn-sm flex-1 rounded-xl bg-green-600 font-bold text-white" onClick={onAccept}>
              <Check size={16} /> ACEITAR
            </button>
            <button className="btn-danger btn-sm flex-1" onClick={onRefuse}>
              <X size={16} /> RECUSAR
            </button>
          </>
        ) : next ? (
          <button className="btn-primary btn-sm flex-1" disabled={busy} onClick={advance}>
            {next.label}
          </button>
        ) : (
          <span className="flex-1" />
        )}
        {o.customerPhone && canManage && (
          <button
            className="btn-sm rounded-xl bg-[#25D366] text-white"
            title="Avisar o cliente no WhatsApp"
            aria-label="Avisar o cliente no WhatsApp"
            onClick={() => withWhatsApp(o, EVENT_FOR_STATUS[o.status] ?? 'ORDER_RECEIVED', async () => null, { force: true }).catch((e) => toast((e as Error).message, 'error'))}
          >
            <MessageCircle size={16} />
          </button>
        )}
        <button className="btn-ghost btn-sm" onClick={() => printOrder(o, info?.store.name)} aria-label="Imprimir">
          <Printer size={16} />
        </button>
      </div>
    </article>
  );
}

function AcceptModal({ order, onClose, onDone }: { order: AdminOrder; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const { info } = useStore();
  const [minutes, setMinutes] = useState<number | null>(order.type === 'TABLE' ? null : info?.delivery.defaultPrepMinutes ?? 40);
  const [custom, setCustom] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    const m = custom ? Number(custom) : minutes;
    if (order.type !== 'TABLE' && (!m || m < 1)) return toast('Informe o prazo estimado.', 'error');
    setBusy(true);
    try {
      await withWhatsApp(order, 'ORDER_ACCEPTED', () => api(`/admin/orders/${order.id}/accept`, { body: { minutes: m || null } }));
      toast(`Pedido #${order.number} aceito.`);
      onDone();
      onClose();
    } catch (e) {
      toast((e as Error).message, 'error');
      onDone();
      onClose();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} title={`Aceitar pedido #${order.number}`} size="sm" footer={<button className="btn-primary w-full" disabled={busy} onClick={submit}>Confirmar aceite</button>}>
      <p className="mb-3 text-sm text-ink-700">Prazo estimado {order.type === 'DELIVERY' ? 'de entrega' : 'de preparo'} (contado a partir de agora):</p>
      <div className="grid grid-cols-3 gap-2">
        {[20, 30, 35, 40, 50, 60].map((m) => (
          <button key={m} className={`rounded-2xl py-3 font-bold ring-1 ${minutes === m && !custom ? 'bg-brand-600 text-white ring-brand-600' : 'ring-black/10'}`} onClick={() => { setMinutes(m); setCustom(''); }}>
            {m} min
          </button>
        ))}
      </div>
      <Field label="Prazo personalizado (min)">
        <input className="input mt-1" inputMode="numeric" value={custom} onChange={(e) => setCustom(e.target.value.replace(/\D/g, '').slice(0, 3))} placeholder="Ex.: 45" />
      </Field>
    </Modal>
  );
}

const REASONS = ['Produto indisponível', 'Endereço fora da área de entrega', 'Estabelecimento encerrando atividades', 'Alta demanda'];

function RefuseModal({ order, onClose, onDone }: { order: AdminOrder; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [other, setOther] = useState('');
  const [busy, setBusy] = useState(false);
  const final = reason === 'outro' ? other.trim() : reason;
  const submit = async () => {
    if (final.length < 3) return toast('Informe o motivo da recusa.', 'error');
    setBusy(true);
    try {
      await withWhatsApp(order, 'ORDER_CANCELED', () => api(`/admin/orders/${order.id}/refuse`, { body: { reason: final } }));
      toast(`Pedido #${order.number} recusado.`);
      onDone();
      onClose();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} title={`Recusar pedido #${order.number}`} size="sm" footer={<button className="btn-primary w-full" disabled={busy || final.length < 3} onClick={submit}>Confirmar recusa</button>}>
      <p className="mb-3 text-sm text-ink-700">O motivo é obrigatório e será enviado ao cliente.</p>
      <div className="grid gap-2">
        {[...REASONS, 'outro'].map((r) => (
          <label key={r} className={`flex cursor-pointer items-center gap-3 rounded-2xl px-4 py-3 ring-1 ${reason === r ? 'bg-brand-50 ring-2 ring-brand-600' : 'ring-black/10'}`}>
            <input type="radio" className="h-5 w-5 accent-brand-600" checked={reason === r} onChange={() => setReason(r)} />
            {r === 'outro' ? 'Outro motivo' : r}
          </label>
        ))}
      </div>
      {reason === 'outro' && <textarea className="input mt-3" maxLength={300} placeholder="Descreva o motivo" value={other} onChange={(e) => setOther(e.target.value)} />}
    </Modal>
  );
}

interface Notification {
  id: string;
  event: string;
  status: string;
  skipReason: string | null;
  lastError: string | null;
  createdAt: string;
}

const EVENT_FOR_STATUS: Record<string, string> = {
  AWAITING_ACCEPT: 'ORDER_RECEIVED',
  ACCEPTED: 'ORDER_ACCEPTED',
  PREPARING: 'ORDER_PREPARING',
  READY: 'ORDER_READY',
  OUT_FOR_DELIVERY: 'ORDER_OUT_FOR_DELIVERY',
  DELIVERED: 'ORDER_DELIVERED',
  PICKED_UP: 'ORDER_DELIVERED',
  CANCELED: 'ORDER_CANCELED',
};

export function OrderDetail({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const { info } = useStore();
  const { can, orderTick } = useAdmin();
  const [o, setO] = useState<(AdminOrder & { notifications: Notification[] }) | null>(null);
  const [couriers, setCouriers] = useState<{ id: string; name: string }[]>([]);
  const load = useCallback(() => api<AdminOrder & { notifications: Notification[] }>(`/admin/orders/${id}`).then(setO).catch((e) => toast((e as Error).message, 'error')), [id, toast]);
  useEffect(() => {
    void load();
  }, [load, orderTick]);
  useEffect(() => {
    if (can('orders.manage')) api<{ id: string; name: string; roleKey: string; active: boolean }[]>('/admin/users').then((u) => setCouriers(u.filter((x) => x.roleKey === 'COURIER' && x.active))).catch(() => {});
  }, [can]);

  const paid = useMemo(() => (o?.payments ?? []).filter((p) => p.status === 'CONFIRMED').reduce((s, p) => s + p.amountCents, 0), [o]);
  if (!o) return <Modal open onClose={onClose}><Spinner /></Modal>;

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast(ok);
      await load();
      onChanged();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };
  const manualWhats = () =>
    withWhatsApp(o, EVENT_FOR_STATUS[o.status] ?? 'ORDER_RECEIVED', async () => null, { force: true }).catch((e) => toast((e as Error).message, 'error'));

  return (
    <Modal open onClose={onClose} size="lg" title={<span className="flex items-center gap-2">Pedido #{o.number} <StatusBadge status={o.status} label={o.statusLabel} /></span>}>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1 text-sm">
          <p className="font-bold">{o.customerName}</p>
          {o.customerPhone && (
            <p className="flex items-center gap-1">
              <Phone size={14} /> <a href={`tel:+${o.customerPhone}`} className="underline">{formatPhone(o.customerPhone)}</a>
            </p>
          )}
          {o.type === 'DELIVERY' && (
            <p>
              {o.addressStreet}, {o.addressNumber} — {o.addressDistrict}
              {o.addressComplement && <><br />{o.addressComplement}</>}
              {o.addressReference && <><br /><span className="text-ink-700">Ref.: {o.addressReference}</span></>}
            </p>
          )}
          <p>{TYPE_LABELS[o.type]}{o.table ? ` · ${o.table.name}` : ''} · {dateTime(o.createdAt)}</p>
          <p>Pagamento: <strong>{PAYMENT_LABELS[o.paymentMethod]}</strong> · {o.paymentStatus === 'PAID' ? 'pago' : o.paymentStatus === 'REFUND_PENDING' ? 'estorno pendente' : o.paymentStatus === 'REFUNDED' ? 'estornado' : 'a receber'}</p>
          {o.changeForCents && <p>Troco para {brl(o.changeForCents)} (levar {brl(o.changeForCents - o.totalCents)})</p>}
          {o.notes && <p className="font-semibold text-brand-700">Obs.: {o.notes}</p>}
        </div>
        <div className="rounded-2xl bg-gold-50 p-3 text-sm">
          {o.items.map((i) => (
            <div key={i.id} className={`flex justify-between gap-2 py-0.5 ${i.canceledAt ? 'line-through opacity-50' : ''}`}>
              <span>
                <strong>{i.quantity}x {i.name}</strong>
                {i.description && <span className="block text-xs">{i.description}</span>}
                {i.notes && <span className="block text-xs text-brand-700">Obs: {i.notes}</span>}
              </span>
              <span className="flex items-start gap-1">
                {brl(i.totalCents)}
                {!i.canceledAt && can('orders.manage') && o.status !== 'CANCELED' && o.items.filter((x) => !x.canceledAt).length > 1 && (
                  <button
                    className="text-brand-700"
                    title="Cancelar item"
                    onClick={() => {
                      const reason = window.prompt('Motivo do cancelamento do item:');
                      if (reason) void act(() => api(`/admin/orders/items/${i.id}/cancel`, { body: { reason } }), 'Item cancelado.');
                    }}
                  >
                    <X size={14} />
                  </button>
                )}
              </span>
            </div>
          ))}
          <div className="mt-2 border-t border-black/10 pt-2">
            <div className="flex justify-between"><span>Subtotal</span><span>{brl(o.grossCents)}</span></div>
            {o.comboSavingsCents > 0 && <div className="flex justify-between text-green-700"><span>Desconto combos</span><span>-{brl(o.comboSavingsCents)}</span></div>}
            {o.discountCents > 0 && <div className="flex justify-between text-green-700"><span>Cupom {o.couponCode}</span><span>-{brl(o.discountCents)}</span></div>}
            {o.type === 'DELIVERY' && <div className="flex justify-between"><span>Entrega</span><span>{brl(o.deliveryFeeCents)}</span></div>}
            <div className="flex justify-between text-base font-extrabold"><span>Total</span><span>{brl(o.totalCents)}</span></div>
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button className="btn-ghost btn-sm" onClick={() => printOrder(o, info?.store.name)}><Printer size={16} /> Imprimir</button>
        {o.customerPhone && can('orders.manage') && <button className="btn-sm rounded-xl bg-[#25D366] font-semibold text-white" onClick={manualWhats}><MessageCircle size={16} /> Avisar cliente no WhatsApp</button>}
        {can('payments.manage') && !o.table && o.paymentStatus === 'PENDING' && o.status !== 'CANCELED' && (
          <button
            className="btn-gold btn-sm"
            onClick={() => {
              if (window.confirm(`Confirmar recebimento de ${brl(o.totalCents - paid)} (${PAYMENT_LABELS[o.paymentMethod]})?`))
                void act(() => api(`/admin/orders/${o.id}/payments`, { idempotencyKey: newIdempotencyKey(), body: { method: o.paymentMethod, amountCents: o.totalCents - paid } }), 'Pagamento confirmado.');
            }}
          >
            Confirmar pagamento
          </button>
        )}
        {can('payments.manage') && o.paymentStatus === 'REFUND_PENDING' && (
          <button className="btn-gold btn-sm" onClick={() => window.confirm('Confirmar que o estorno foi realizado?') && void act(() => api(`/admin/orders/${o.id}/refunded`, { body: {} }), 'Estorno registrado.')}>Marcar como estornado</button>
        )}
        {can('orders.manage') && !['AWAITING_ACCEPT', 'DELIVERED', 'PICKED_UP', 'SERVED', 'CANCELED'].includes(o.status) && (
          <button
            className="btn-danger btn-sm"
            onClick={() => {
              const reason = window.prompt('Motivo do cancelamento (será enviado ao cliente):');
              if (reason && reason.trim().length >= 3) void act(() => api(`/admin/orders/${o.id}/refuse`, { body: { reason } }), 'Pedido cancelado.');
            }}
          >
            Cancelar pedido
          </button>
        )}
      </div>

      {o.type === 'DELIVERY' && can('orders.manage') && (
        <div className="mt-4 max-w-xs">
          <Field label="Entregador">
            <select className="input" value={o.courierId ?? ''} onChange={(e) => void act(() => api(`/admin/orders/${o.id}/courier`, { body: { courierId: e.target.value || null } }), 'Entregador atualizado.')}>
              <option value="">Sem entregador</option>
              {couriers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
        </div>
      )}

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <div>
          <h3 className="mb-1 font-bold">Histórico</h3>
          <ul className="space-y-1 text-sm">
            {o.statusHistory.map((h, i) => (
              <li key={i}>{time(h.createdAt)} — {h.toStatus}{h.note ? ` (${h.note})` : ''}</li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="mb-1 font-bold">Notificações WhatsApp</h3>
          {!o.whatsappOptIn && <p className="text-xs text-ink-700">Cliente não autorizou mensagens automáticas.</p>}
          <ul className="space-y-1 text-xs">
            {o.notifications.map((n) => (
              <li key={n.id} className="flex flex-wrap gap-1">
                <span className="font-semibold">{n.event}</span>
                <span className={`chip ${n.status === 'SENT' || n.status === 'DELIVERED' || n.status === 'READ' ? 'bg-green-100 text-green-800' : n.status === 'FAILED' ? 'bg-brand-100 text-brand-700' : 'bg-black/5'}`}>{n.status === 'SKIPPED' ? 'não enviada' : n.status}</span>
                {(n.skipReason || n.lastError) && <span className="text-ink-700">{n.skipReason || n.lastError}</span>}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Modal>
  );
}

/** Tela simplificada da cozinha: letras grandes, foco no preparo. */
export function Kitchen() {
  const { orders, reload } = useBoard();
  const toast = useToast();
  if (!orders) return <Spinner />;
  const list = orders.filter((o) => ['ACCEPTED', 'PREPARING'].includes(o.status));
  const move = async (o: AdminOrder, to: string) => {
    try {
      await api(`/admin/orders/${o.id}/status`, { body: { status: to } });
    } catch (e) {
      toast((e as Error).message, 'error');
    }
    reload();
  };
  return (
    <div>
      <PageTitle title="Cozinha" />
      {!list.length && <Empty icon={<ChefHat size={56} />} title="Nenhum pedido para preparar agora" />}
      <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
        {list.map((o) => (
          <article key={o.id} className={`card overflow-hidden ${o.status === 'PREPARING' ? 'ring-4 ring-orange-400' : ''}`}>
            <div className={`flex items-center justify-between px-5 py-3 text-white ${o.status === 'PREPARING' ? 'bg-orange-500' : 'bg-sky-600'}`}>
              <span className="font-display text-4xl font-extrabold">#{o.number}</span>
              <span className="text-right text-lg font-bold">
                {TYPE_LABELS[o.type]}{o.table ? ` · ${o.table.name}` : ''}
                <span className="block text-sm font-semibold">{minutesSince(o.acceptedAt ?? o.createdAt)} min</span>
              </span>
            </div>
            <ul className="space-y-2 p-5">
              {o.items.filter((i) => !i.canceledAt).map((i) => (
                <li key={i.id}>
                  <p className="text-2xl font-extrabold leading-tight">{i.quantity}x {i.name}</p>
                  {i.description && <p className="text-lg font-semibold text-ink-700">{i.description}</p>}
                  {i.notes && <p className="text-lg font-bold text-brand-700">⚠ {i.notes}</p>}
                </li>
              ))}
              {o.notes && <li className="text-lg font-bold text-brand-700">⚠ {o.notes}</li>}
            </ul>
            <div className="p-3 pt-0">
              {o.status === 'ACCEPTED' ? (
                <button className="btn w-full bg-orange-500 py-5 text-xl text-white" onClick={() => move(o, 'PREPARING')}>Iniciar preparo</button>
              ) : (
                <button className="btn w-full bg-green-600 py-5 text-xl text-white" onClick={() => move(o, 'READY')}>Pronto!</button>
              )}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

interface Delivery {
  id: string;
  number: number;
  status: string;
  customerName: string;
  customerPhone: string | null;
  whatsappOptIn: boolean;
  addressStreet: string;
  addressNumber: string;
  addressDistrict: string;
  addressComplement: string | null;
  addressReference: string | null;
  totalCents: number;
  paymentMethod: string;
  paymentStatus: string;
  changeForCents: number | null;
  notes: string | null;
  items: { name: string; quantity: number; description: string | null }[];
}

/** Entregador: somente as entregas atribuídas a ele. */
export function Deliveries() {
  const { orderTick } = useAdmin();
  const toast = useToast();
  const [list, setList] = useState<Delivery[] | null>(null);
  const load = useCallback(() => api<Delivery[]>('/admin/orders/deliveries/mine').then(setList).catch(() => setList([])), []);
  useEffect(() => {
    void load();
  }, [load, orderTick]);
  if (!list) return <Spinner />;
  const move = async (d: Delivery, to: string) => {
    try {
      await withWhatsApp(d, EVENT_FOR_STATUS[to], () => api(`/admin/orders/${d.id}/status`, { body: { status: to } }));
      toast('Status atualizado.');
    } catch (e) {
      toast((e as Error).message, 'error');
    }
    void load();
  };
  return (
    <div>
      <PageTitle title="Minhas entregas" />
      {!list.length && <Empty icon={<Bike size={56} />} title="Nenhuma entrega atribuída" />}
      <div className="grid gap-4 md:grid-cols-2">
        {list.map((d) => {
          const maps = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${d.addressStreet}, ${d.addressNumber} - ${d.addressDistrict}`)}`;
          return (
            <article key={d.id} className="card p-5">
              <div className="flex items-center justify-between">
                <span className="font-display text-3xl font-extrabold">#{d.number}</span>
                <StatusBadge status={d.status} label={d.status === 'READY' ? 'Pronto para sair' : d.status === 'OUT_FOR_DELIVERY' ? 'Em rota' : 'Entregue'} />
              </div>
              <p className="mt-2 text-lg font-bold">{d.customerName}</p>
              <a href={maps} target="_blank" rel="noopener noreferrer" className="mt-1 flex gap-1 text-brand-700 underline">
                <MapPin size={18} /> {d.addressStreet}, {d.addressNumber} — {d.addressDistrict}
              </a>
              {d.addressComplement && <p className="text-sm">{d.addressComplement}</p>}
              {d.addressReference && <p className="text-sm text-ink-700">Ref.: {d.addressReference}</p>}
              {d.customerPhone && <a href={`tel:+${d.customerPhone}`} className="mt-1 block text-sm underline">{formatPhone(d.customerPhone)}</a>}
              <p className="mt-2 text-sm">{d.items.map((i) => `${i.quantity}x ${i.name}`).join(', ')}</p>
              <p className="mt-2 font-bold">
                {brl(d.totalCents)} · {PAYMENT_LABELS[d.paymentMethod]} {d.paymentStatus === 'PAID' ? '(pago)' : '(cobrar)'}
              </p>
              {d.changeForCents && <p className="font-bold text-brand-700">Levar troco: {brl(d.changeForCents - d.totalCents)} (para {brl(d.changeForCents)})</p>}
              {d.notes && <p className="text-sm text-brand-700">Obs.: {d.notes}</p>}
              {d.status === 'READY' && <button className="btn-primary mt-4 w-full py-4" onClick={() => move(d, 'OUT_FOR_DELIVERY')}>Saí para entrega</button>}
              {d.status === 'OUT_FOR_DELIVERY' && <button className="btn mt-4 w-full bg-green-600 py-4 text-white" onClick={() => move(d, 'DELIVERED')}>Entregue</button>}
            </article>
          );
        })}
      </div>
    </div>
  );
}
