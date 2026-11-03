import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRightLeft, Plus, Printer, UserPlus } from 'lucide-react';
import { api, newIdempotencyKey } from '../lib/api';
import { CartProvider, useCart, useStore, useToast } from '../lib/context';
import { brl, PAYMENT_LABELS, parseBRL, time } from '../lib/format';
import { MenuView } from '../components/menu';
import { Field, Modal, Spinner, StatusBadge } from '../components/ui';
import { PageTitle, useAdmin } from './AdminApp';
import { printThermal } from './print';

interface BoardTable {
  id: string;
  name: string;
  number: number;
  active: boolean;
  url: string;
  status: 'LIVRE' | 'OCUPADA' | 'PEDIDO_PENDENTE' | 'EM_ATENDIMENTO' | 'AGUARDANDO_PAGAMENTO' | 'FINALIZADA';
  session: { id: string; openedAt: string; participants: number; totalCents: number; paidCents: number; remainingCents: number; pendingOrders: number; closeRequested: boolean } | null;
}

const STATUS_STYLE: Record<BoardTable['status'], { label: string; cls: string }> = {
  LIVRE: { label: 'Livre', cls: 'bg-white ring-black/10' },
  OCUPADA: { label: 'Ocupada', cls: 'bg-sky-50 ring-sky-300' },
  PEDIDO_PENDENTE: { label: 'Pedido pendente', cls: 'bg-gold-100 ring-gold-500 animate-pulse-ring' },
  EM_ATENDIMENTO: { label: 'Em atendimento', cls: 'bg-orange-50 ring-orange-400' },
  AGUARDANDO_PAGAMENTO: { label: 'Aguardando pagamento', cls: 'bg-brand-50 ring-brand-600' },
  FINALIZADA: { label: 'Finalizada', cls: 'bg-green-50 ring-green-500' },
};

export function TablesBoard() {
  const { tableTick, orderTick } = useAdmin();
  const toast = useToast();
  const [tables, setTables] = useState<BoardTable[] | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const load = useCallback(() => api<BoardTable[]>('/admin/tables').then(setTables).catch((e) => toast((e as Error).message, 'error')), [toast]);
  useEffect(() => {
    void load();
  }, [load, tableTick, orderTick]);
  if (!tables) return <Spinner />;

  const open = async (t: BoardTable) => {
    if (t.session) return setSessionId(t.session.id);
    if (!t.active) return;
    if (!window.confirm(`Abrir ${t.name}?`)) return;
    const r = await api<{ sessionId: string }>(`/admin/tables/${t.id}/open`, { body: {} });
    setSessionId(r.sessionId);
    void load();
  };

  return (
    <div>
      <PageTitle title="Mesas e comandas" />
      <div className="mb-4 flex flex-wrap gap-2 text-xs">
        {Object.entries(STATUS_STYLE).map(([k, v]) => (
          <span key={k} className={`chip ring-1 ${v.cls.replace('animate-pulse-ring', '')}`}>{v.label}</span>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6">
        {tables.filter((t) => t.active || t.session).map((t) => {
          const st = STATUS_STYLE[t.status];
          return (
            <button key={t.id} onClick={() => open(t)} className={`rounded-3xl p-4 text-left ring-2 transition hover:-translate-y-0.5 ${st.cls}`}>
              <p className="font-display text-2xl font-extrabold">{t.name}</p>
              <p className="text-sm font-semibold">{st.label}</p>
              {t.session ? (
                <div className="mt-2 text-sm">
                  <p>Desde {time(t.session.openedAt)} · {t.session.participants} pessoa(s)</p>
                  <p className="font-bold">{brl(t.session.totalCents)}</p>
                  {t.session.remainingCents > 0 && <p className="text-brand-700">Falta {brl(t.session.remainingCents)}</p>}
                  {t.session.pendingOrders > 0 && <p className="font-bold text-gold-700">{t.session.pendingOrders} pedido(s) aguardando</p>}
                </div>
              ) : (
                <p className="mt-2 text-sm text-ink-700">Toque para abrir</p>
              )}
            </button>
          );
        })}
      </div>
      {sessionId && <SessionPanel sessionId={sessionId} tables={tables} onClose={() => { setSessionId(null); void load(); }} />}
    </div>
  );
}

interface Participant { id: string; name: string; hasDevice: boolean }
interface SessionItem { id: string; name: string; description: string | null; quantity: number; unitPriceCents: number; totalCents: number; notes: string | null; canceled: boolean; allocations: { participantId: string; weight: number }[] }
interface AdminSession {
  id: string;
  status: string;
  splitMode: 'CONSUMPTION' | 'EQUAL' | 'CUSTOM';
  splitConfig: { participantIds?: string[]; items?: Record<string, Record<string, number>> } | null;
  openedAt: string;
  closeRequestedAt: string | null;
  table: { id: string; name: string };
  participants: Participant[];
  orders: { id: string; number: number; status: string; statusLabel: string; createdAt: string; totalCents: number; placedBy: { name: string } | null; items: SessionItem[] }[];
  payments: { id: string; receiptNumber: number; method: string; amountCents: number; status: string; createdAt: string; allocations: { participantId: string; amountCents: number }[] }[];
  bill: { totalCents: number; paidCents: number; remainingCents: number; shares: { participantId: string; name: string; dueCents: number; paidCents: number; remainingCents: number; items: { name: string; amountCents: number }[] }[] };
}

const SPLIT_LABEL = { CONSUMPTION: 'Por consumo', EQUAL: 'Igualmente', CUSTOM: 'Personalizada' };

function SessionPanel({ sessionId, tables, onClose }: { sessionId: string; tables: BoardTable[]; onClose: () => void }) {
  const toast = useToast();
  const { info } = useStore();
  const { staff, tableTick, orderTick } = useAdmin();
  const [s, setS] = useState<AdminSession | null>(null);
  const [payFor, setPayFor] = useState<{ participantId: string | null; amount: number } | null>(null);
  const [manual, setManual] = useState(false);
  const [realloc, setRealloc] = useState<SessionItem | null>(null);
  const [newPerson, setNewPerson] = useState('');

  const load = useCallback(() => api<AdminSession>(`/admin/sessions/${sessionId}`).then(setS).catch((e) => toast((e as Error).message, 'error')), [sessionId, toast]);
  useEffect(() => {
    void load();
  }, [load, tableTick, orderTick]);
  const names = useMemo(() => Object.fromEntries((s?.participants ?? []).map((p) => [p.id, p.name])), [s]);
  if (!s) return <Modal open onClose={onClose}><Spinner /></Modal>;

  const act = async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      await fn();
      if (ok) toast(ok);
      await load();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  const close = async () => {
    if (s.bill.remainingCents > 0) {
      if (staff.role !== 'ADMIN') return toast(`Ainda falta receber ${brl(s.bill.remainingCents)}.`, 'error');
      const reason = window.prompt(`Há saldo pendente de ${brl(s.bill.remainingCents)}. Para encerrar mesmo assim, informe o motivo (fica registrado em auditoria):`);
      if (!reason) return;
      return act(() => api(`/admin/sessions/${s.id}/close`, { body: { force: true, reason } }), 'Mesa encerrada com pendência registrada.').then(onClose);
    }
    if (!window.confirm(`Encerrar a comanda da ${s.table.name}?`)) return;
    try {
      await api(`/admin/sessions/${s.id}/close`, { body: {} });
      toast('Mesa encerrada. Status: livre.');
      onClose();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  const transfer = async () => {
    const free = tables.filter((t) => !t.session && t.active && t.id !== s.table.id);
    if (!free.length) return toast('Nenhuma mesa livre para transferir.', 'error');
    const name = window.prompt(`Transferir para qual mesa? Livres: ${free.map((t) => t.number).join(', ')}`);
    const target = free.find((t) => String(t.number) === name?.trim());
    if (!target) return;
    if (!window.confirm(`Confirmar transferência de ${s.table.name} para ${target.name}?`)) return;
    await act(() => api(`/admin/sessions/${s.id}/transfer`, { body: { tableId: target.id } }), `Transferida para ${target.name}.`);
  };

  const printBill = () => {
    const rows = s.bill.shares
      .map((sh) => `<div class="row b"><span>${sh.name}</span><span>${brl(sh.dueCents)}</span></div>${sh.items.map((i) => `<div class="row muted"><span>${i.name}</span><span>${brl(i.amountCents)}</span></div>`).join('')}`)
      .join('<hr/>');
    printThermal(
      `Comanda ${s.table.name}`,
      `<h1>${info?.store.name ?? 'Pastel L&D'}</h1><div class="c big b">${s.table.name}</div><div class="c">Divisão: ${SPLIT_LABEL[s.splitMode]}</div><hr/>${rows}<hr/>
       <div class="row big b"><span>TOTAL</span><span>${brl(s.bill.totalCents)}</span></div>
       <div class="row"><span>Pago</span><span>${brl(s.bill.paidCents)}</span></div>
       <div class="row b"><span>Falta</span><span>${brl(s.bill.remainingCents)}</span></div>`,
    );
  };

  const printReceipt = (p: AdminSession['payments'][number]) =>
    printThermal(
      `Comprovante ${p.receiptNumber}`,
      `<h1>${info?.store.name ?? 'Pastel L&D'}</h1><div class="c b">COMPROVANTE DE PAGAMENTO Nº ${p.receiptNumber}</div><div class="c">${s.table.name} · ${new Date(p.createdAt).toLocaleString('pt-BR')}</div><hr/>
       ${p.allocations.map((a) => `<div class="row"><span>${names[a.participantId] ?? ''}</span><span>${brl(a.amountCents)}</span></div>`).join('')}
       <div class="row big b"><span>${PAYMENT_LABELS[p.method]}</span><span>${brl(p.amountCents)}</span></div><hr/><div class="c muted">Documento sem valor fiscal</div>`,
    );

  return (
    <Modal open onClose={onClose} size="xl" title={<span>{s.table.name} {s.status === 'CLOSE_REQUESTED' && <span className="chip ml-2 bg-brand-600 text-white">Fechamento solicitado</span>}</span>}>
      <div className="grid gap-5 lg:grid-cols-[1.3fr_1fr]">
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <button className="btn-primary btn-sm" onClick={() => setManual(true)}><Plus size={16} /> Pedido manual</button>
            <button className="btn-ghost btn-sm" onClick={printBill}><Printer size={16} /> Imprimir comanda</button>
            <button className="btn-ghost btn-sm" onClick={transfer}><ArrowRightLeft size={16} /> Transferir</button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {s.participants.map((p) => <span key={p.id} className="chip bg-gold-100 py-1 text-sm">{p.name}{p.hasDevice ? ' 📱' : ''}</span>)}
            <form className="flex gap-1" onSubmit={(e) => { e.preventDefault(); void act(() => api(`/admin/sessions/${s.id}/people`, { body: { name: newPerson } }).then(() => setNewPerson(''))); }}>
              <input className="input py-1 text-sm" placeholder="Adicionar cliente" value={newPerson} onChange={(e) => setNewPerson(e.target.value)} minLength={2} required />
              <button className="btn-gold btn-sm"><UserPlus size={16} /></button>
            </form>
          </div>
          {s.orders.map((o) => (
            <div key={o.id} className="rounded-2xl p-3 ring-1 ring-black/10">
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="font-bold">#{o.number} · {time(o.createdAt)} {o.placedBy ? `· ${o.placedBy.name}` : '· atendente'}</span>
                <span className="flex items-center gap-2">
                  <StatusBadge status={o.status} label={o.statusLabel} />
                  {o.status === 'AWAITING_ACCEPT' && <button className="btn-sm rounded-xl bg-green-600 font-bold text-white" onClick={() => act(() => api(`/admin/orders/${o.id}/accept`, { body: { minutes: null } }), 'Pedido confirmado.')}>Confirmar</button>}
                  {o.status === 'READY' && <button className="btn-primary btn-sm" onClick={() => act(() => api(`/admin/orders/${o.id}/status`, { body: { status: 'SERVED' } }))}>Entregue</button>}
                </span>
              </div>
              <ul className="mt-2 space-y-1 text-sm">
                {o.items.map((i) => (
                  <li key={i.id} className={`flex justify-between gap-2 ${i.canceled || o.status === 'CANCELED' ? 'line-through opacity-50' : ''}`}>
                    <button className="text-left" onClick={() => !i.canceled && o.status !== 'CANCELED' && setRealloc(i)} title="Corrigir atribuição">
                      {i.quantity}x {i.name}
                      {i.description && <span className="block text-xs text-ink-700">{i.description}</span>}
                      <span className="block text-xs text-brand-700 underline decoration-dotted">{i.allocations.map((a) => `${names[a.participantId]}${a.weight > 1 ? ` (${a.weight})` : ''}`).join(' + ')}</span>
                    </button>
                    <span className="font-semibold">{brl(i.totalCents)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {!s.orders.length && <p className="text-sm text-ink-700">Nenhum pedido ainda.</p>}
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl bg-ink-900 p-4 text-white">
            <p className="text-sm opacity-80">Total consumido</p>
            <p className="text-3xl font-extrabold">{brl(s.bill.totalCents)}</p>
            <p className="text-sm">Pago {brl(s.bill.paidCents)} · <span className="font-bold text-gold-300">Falta {brl(s.bill.remainingCents)}</span></p>
          </div>
          <div>
            <p className="label">Divisão</p>
            <div className="grid grid-cols-3 gap-1">
              {(['CONSUMPTION', 'EQUAL', 'CUSTOM'] as const).map((m) => (
                <button
                  key={m}
                  disabled={m === 'CUSTOM'}
                  title={m === 'CUSTOM' ? 'Use “corrigir atribuição” nos itens ou peça ao cliente para propor pela mesa' : undefined}
                  className={`btn-sm rounded-xl ring-1 ${s.splitMode === m ? 'bg-brand-600 text-white ring-brand-600' : 'ring-black/10'}`}
                  onClick={() => act(() => api(`/admin/sessions/${s.id}/split`, { method: 'PUT', body: { mode: m, config: m === 'EQUAL' ? { participantIds: s.participants.map((p) => p.id) } : null } }))}
                >
                  {SPLIT_LABEL[m]}
                </button>
              ))}
            </div>
          </div>
          <ul className="divide-y divide-black/5 rounded-2xl ring-1 ring-black/10">
            {s.bill.shares.map((sh) => (
              <li key={sh.participantId} className="flex items-center justify-between gap-2 p-3 text-sm">
                <div>
                  <p className="font-bold">{sh.name}</p>
                  <p className="text-xs text-ink-700">Deve {brl(sh.dueCents)} · pagou {brl(sh.paidCents)}</p>
                </div>
                {sh.remainingCents > 0 ? (
                  <button className="btn-gold btn-sm" onClick={() => setPayFor({ participantId: sh.participantId, amount: sh.remainingCents })}>Receber {brl(sh.remainingCents)}</button>
                ) : (
                  <span className="chip bg-green-100 text-green-800">{sh.dueCents ? 'Pago' : '—'}</span>
                )}
              </li>
            ))}
          </ul>
          {s.bill.remainingCents > 0 && <button className="btn-ghost btn-sm w-full" onClick={() => setPayFor({ participantId: null, amount: s.bill.remainingCents })}>Registrar pagamento da mesa (valor livre)</button>}

          <div>
            <p className="label">Pagamentos registrados</p>
            <ul className="space-y-1 text-sm">
              {s.payments.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2 rounded-xl bg-gold-50 px-3 py-2">
                  <span>
                    #{p.receiptNumber} · {PAYMENT_LABELS[p.method]} · {brl(p.amountCents)}
                    <span className="block text-xs text-ink-700">{p.allocations.map((a) => names[a.participantId]).join(', ') || 'Mesa'} · {time(p.createdAt)}</span>
                  </span>
                  <span className="flex gap-1">
                    {p.status === 'PENDING' && <button className="btn-sm rounded-xl bg-green-600 text-white" onClick={() => act(() => api(`/admin/payments/${p.id}/confirm`, { body: {} }), 'Pagamento confirmado.')}>Confirmar</button>}
                    <button className="btn-ghost btn-sm" onClick={() => printReceipt(p)} aria-label="Comprovante"><Printer size={14} /></button>
                    <button className="btn-danger btn-sm" onClick={() => { const r = window.prompt('Motivo para anular o pagamento:'); if (r) void act(() => api(`/admin/payments/${p.id}/void`, { body: { reason: r } }), 'Pagamento anulado.'); }}>Anular</button>
                  </span>
                </li>
              ))}
              {!s.payments.length && <li className="text-ink-700">Nenhum pagamento.</li>}
            </ul>
          </div>
          <button className="btn-dark w-full" onClick={close}>Fechar mesa</button>
        </div>
      </div>

      {payFor && <PaymentModal session={s} payFor={payFor} onClose={() => setPayFor(null)} onDone={load} />}
      {realloc && <ReallocModal item={realloc} participants={s.participants} onClose={() => setRealloc(null)} onDone={load} />}
      {manual && (
        <CartProvider storageKey={`ld-admin-manual-${s.id}`}>
          <ManualOrder session={s} onClose={() => setManual(false)} onDone={load} />
        </CartProvider>
      )}
    </Modal>
  );
}

function PaymentModal({ session, payFor, onClose, onDone }: { session: AdminSession; payFor: { participantId: string | null; amount: number }; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [method, setMethod] = useState('PIX');
  const [amount, setAmount] = useState((payFor.amount / 100).toFixed(2).replace('.', ','));
  const [received, setReceived] = useState('');
  const [busy, setBusy] = useState(false);
  const [key] = useState(newIdempotencyKey);
  const cents = parseBRL(amount) ?? 0;
  const change = method === 'CASH' && received ? (parseBRL(received) ?? 0) - cents : 0;
  const name = payFor.participantId ? session.participants.find((p) => p.id === payFor.participantId)?.name : 'Mesa';
  const submit = async () => {
    setBusy(true);
    try {
      await api(`/admin/sessions/${session.id}/payments`, {
        idempotencyKey: key,
        body: { method, amountCents: cents, confirm: true, allocations: payFor.participantId ? [{ participantId: payFor.participantId, amountCents: cents }] : [] },
      });
      toast('Pagamento registrado.');
      onDone();
      onClose();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} size="sm" title={`Receber — ${name}`} footer={<button className="btn-primary w-full" disabled={busy || cents <= 0} onClick={submit}>Confirmar recebimento de {brl(cents)}</button>}>
      <div className="grid grid-cols-2 gap-2">
        {Object.entries(PAYMENT_LABELS).filter(([k]) => k !== 'IN_PERSON').map(([k, l]) => (
          <button key={k} className={`rounded-2xl py-3 text-sm font-bold ring-1 ${method === k ? 'bg-brand-600 text-white ring-brand-600' : 'ring-black/10'}`} onClick={() => setMethod(k)}>{l}</button>
        ))}
      </div>
      <Field label="Valor (pagamento parcial permitido)">
        <input className="input mt-1" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </Field>
      {method === 'CASH' && (
        <Field label="Valor recebido em dinheiro" hint={change > 0 ? `Troco: ${brl(change)}` : undefined}>
          <input className="input mt-1" inputMode="decimal" value={received} onChange={(e) => setReceived(e.target.value)} />
        </Field>
      )}
      <p className="mt-3 text-xs text-ink-700">Confirme somente após receber o valor. Pagamentos ficam registrados com seu usuário.</p>
    </Modal>
  );
}

function ReallocModal({ item, participants, onClose, onDone }: { item: SessionItem; participants: Participant[]; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [weights, setWeights] = useState<Record<string, number>>(Object.fromEntries(item.allocations.map((a) => [a.participantId, a.weight])));
  const total = Object.values(weights).reduce((s, w) => s + w, 0);
  const submit = async () => {
    try {
      await api(`/admin/items/${item.id}/allocations`, { method: 'PUT', body: { allocations: Object.entries(weights).filter(([, w]) => w > 0).map(([participantId, weight]) => ({ participantId, weight })) } });
      toast('Atribuição corrigida (registrada em auditoria).');
      onDone();
      onClose();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };
  return (
    <Modal open onClose={onClose} size="sm" title="Corrigir atribuição" footer={<button className="btn-primary w-full" disabled={total === 0} onClick={submit}>Salvar</button>}>
      <p className="mb-3 font-semibold">{item.quantity}x {item.name} — {brl(item.totalCents)}</p>
      <p className="mb-2 text-xs text-ink-700">Defina a fração de cada pessoa (ex.: 1 e 1 = meio a meio; 2 e 1 = 2/3 e 1/3).</p>
      <ul className="space-y-2">
        {participants.map((p) => (
          <li key={p.id} className="flex items-center justify-between gap-2">
            <span>{p.name}</span>
            <span className="flex items-center gap-2">
              <input type="number" min={0} max={100} className="input w-20 py-1" value={weights[p.id] ?? 0} onChange={(e) => setWeights({ ...weights, [p.id]: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })} />
              <span className="w-20 text-right text-sm">{total ? brl(Math.round((item.totalCents * (weights[p.id] ?? 0)) / total)) : '—'}</span>
            </span>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

function ManualOrder({ session, onClose, onDone }: { session: AdminSession; onClose: () => void; onDone: () => void }) {
  const cart = useCart();
  const toast = useToast();
  const [who, setWho] = useState<string[]>(session.participants[0] ? [session.participants[0].id] : []);
  const [busy, setBusy] = useState(false);
  const [key] = useState(newIdempotencyKey);
  const submit = async () => {
    if (!who.length) return toast('Adicione um cliente à mesa primeiro.', 'error');
    setBusy(true);
    try {
      await api('/admin/orders', {
        idempotencyKey: key,
        body: {
          type: 'TABLE',
          items: cart.lines.map((l) => l.input),
          customer: { name: `${session.table.name} · atendente` },
          paymentMethod: 'IN_PERSON',
          table: { sessionId: session.id, allocations: cart.lines.map(() => ({ participants: who.map((participantId) => ({ participantId })) })) },
        },
      });
      cart.clear();
      toast('Pedido lançado.');
      onDone();
      onClose();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} size="xl" title={`Pedido manual — ${session.table.name}`} footer={
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1 text-sm">
          <span className="font-semibold">Para:</span>
          {session.participants.map((p) => (
            <button key={p.id} onClick={() => setWho(who.includes(p.id) ? who.filter((x) => x !== p.id) : [...who, p.id])} className={`chip py-1 ${who.includes(p.id) ? 'bg-brand-600 text-white' : 'bg-gold-50 ring-1 ring-black/10'}`}>{p.name}</button>
          ))}
        </div>
        <button className="btn-primary" disabled={busy || !cart.count || !who.length} onClick={submit}>Lançar {cart.count} item(ns) · {brl(cart.estimateCents)}</button>
      </div>
    }>
      <MenuView allowFavorites={false} />
    </Modal>
  );
}
