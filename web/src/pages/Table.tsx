import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Receipt, Send, UserPlus, Users, UtensilsCrossed, Wallet } from 'lucide-react';
import { api, ApiError, newIdempotencyKey } from '../lib/api';
import { CartProvider, useCart, useStore, useToast } from '../lib/context';
import { useSocket } from '../lib/socket';
import { brl, time } from '../lib/format';
import { MenuView } from '../components/menu';
import { Logo } from '../components/brand';
import { Empty, Modal, QtyStepper, Spinner, StatusBadge } from '../components/ui';

interface Participant {
  id: string;
  name: string;
  hasDevice: boolean;
  addedById: string | null;
  isMe: boolean;
}
interface Share {
  participantId: string;
  name: string;
  dueCents: number;
  paidCents: number;
  remainingCents: number;
  items: { itemId: string; name: string; amountCents: number }[];
}
interface Bill {
  mode: string;
  totalCents: number;
  paidCents: number;
  remainingCents: number;
  shares: Share[];
}
interface SessionView {
  id: string;
  status: 'OPEN' | 'CLOSE_REQUESTED' | 'CLOSED';
  splitMode: string;
  table: { name: string };
  participants: Participant[];
  orders: {
    id: string;
    number: number;
    status: string;
    statusLabel: string;
    createdAt: string;
    totalCents: number;
    placedBy: { id: string; name: string } | null;
    items: { id: string; name: string; description: string | null; quantity: number; totalCents: number; notes: string | null; canceled: boolean; allocations: { participantId: string; weight: number }[] }[];
  }[];
  bill: Bill;
}

const storageKey = (token: string) => `ld-table-${token}`;

export default function TablePage() {
  const { token = '' } = useParams();
  return (
    <CartProvider storageKey={`ld-table-cart-${token}`}>
      <TableInner token={token} />
    </CartProvider>
  );
}

function TableInner({ token }: { token: string }) {
  const toast = useToast();
  const [deviceToken, setDeviceToken] = useState<string | null>(() => {
    try {
      return localStorage.getItem(storageKey(token));
    } catch {
      return null;
    }
  });
  const [state, setState] = useState<{ table: { name: string }; sessionOpen: boolean; participantId: string | null; session: SessionView | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'menu' | 'comanda' | 'conta'>('menu');

  const load = useCallback(async () => {
    try {
      const r = await api<typeof state>(`/table/t/${token}`, { participantToken: deviceToken });
      setState(r);
      setError(null);
      if (r && !r.participantId && deviceToken) {
        localStorage.removeItem(storageKey(token));
        setDeviceToken(null);
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }, [token, deviceToken]);

  useEffect(() => {
    void load();
  }, [load]);

  useSocket(
    deviceToken ? async () => ({ participantToken: deviceToken }) : null,
    { 'session:updated': () => void load(), $connect: () => void load() },
    [deviceToken],
  );

  if (error) return <div className="p-10 text-center font-semibold text-brand-700">{error}</div>;
  if (!state) return <Spinner label="Abrindo a mesa..." />;

  if (!state.participantId || !state.session)
    return (
      <Join
        tableName={state.table.name}
        onJoin={async (name) => {
          try {
            const r = await api<{ deviceToken: string }>(`/table/t/${token}/join`, { body: { name } });
            localStorage.setItem(storageKey(token), r.deviceToken);
            setDeviceToken(r.deviceToken);
          } catch (e) {
            toast((e as Error).message, 'error');
          }
        }}
      />
    );

  const s = state.session;
  const me = s.participants.find((p) => p.isMe)!;
  return (
    <div className="min-h-dvh pb-32">
      <header className="sticky top-0 z-30 border-b border-black/5 bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-[60px] max-w-4xl items-center justify-between px-4">
          <Logo size={34} withText={false} />
          <div className="text-center">
            <p className="font-display text-xl font-extrabold leading-none">{s.table.name}</p>
            <p className="text-xs text-ink-700">Você: {me.name}</p>
          </div>
          <span className="chip bg-gold-100 text-gold-700">
            <Users size={14} /> {s.participants.length}
          </span>
        </div>
        <nav className="mx-auto grid max-w-4xl grid-cols-3 px-2 pb-2">
          {[
            { id: 'menu' as const, label: 'Cardápio', icon: <UtensilsCrossed size={18} /> },
            { id: 'comanda' as const, label: 'Comanda', icon: <Receipt size={18} /> },
            { id: 'conta' as const, label: 'Conta', icon: <Wallet size={18} /> },
          ].map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)} className={`mx-1 flex items-center justify-center gap-1.5 rounded-xl py-2 text-sm font-bold ${tab === t.id ? 'bg-brand-600 text-white' : 'bg-gold-50'}`}>
              {t.icon} {t.label}
            </button>
          ))}
        </nav>
      </header>
      {s.status === 'CLOSE_REQUESTED' && (
        <div className="bg-gold-500 px-4 py-2 text-center text-sm font-bold">Fechamento solicitado — o atendente está a caminho.</div>
      )}
      <main className="mx-auto max-w-4xl px-4 py-4">
        {tab === 'menu' && <MenuView allowFavorites={false} />}
        {tab === 'comanda' && <Comanda s={s} deviceToken={deviceToken!} onChange={load} />}
        {tab === 'conta' && <Conta s={s} deviceToken={deviceToken!} onChange={load} />}
      </main>
      {tab === 'menu' && <SendBar s={s} me={me} deviceToken={deviceToken!} onSent={() => { void load(); setTab('comanda'); }} />}
    </div>
  );
}

function Join({ tableName, onJoin }: { tableName: string; onJoin: (name: string) => Promise<void> }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-ink-900 px-6 text-white">
      <Logo size={160} withText={false} />
      <h1 className="mt-6 text-center text-4xl font-extrabold">Bem-vindo à {tableName}!</h1>
      <p className="mt-2 text-center text-white/80">Informe seu nome para pedir e acompanhar a comanda da mesa.</p>
      <form
        className="mt-6 w-full max-w-sm space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          await onJoin(name.trim());
          setBusy(false);
        }}
      >
        <input className="input text-ink-900" required minLength={2} maxLength={40} placeholder="Seu nome" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        <button className="btn-gold w-full py-4 text-lg" disabled={busy}>
          Entrar na mesa
        </button>
      </form>
    </div>
  );
}

/** Envio do pedido: cada item precisa de um responsável (ou ser compartilhado). */
function SendBar({ s, me, deviceToken, onSent }: { s: SessionView; me: Participant; deviceToken: string; onSent: () => void }) {
  const cart = useCart();
  const { reload } = useStore();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [assign, setAssign] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState(false);
  const idem = useRef(newIdempotencyKey());
  // Posso lançar para mim, para quem eu adicionei, ou compartilhar comigo
  const forOthers = s.participants.filter((p) => !p.isMe && p.addedById === me.id);
  if (!cart.count) return null;

  const who = (key: string) => assign[key] ?? [me.id];
  const toggle = (key: string, pid: string) => {
    const cur = who(key);
    const next = cur.includes(pid) ? cur.filter((x) => x !== pid) : [...cur, pid];
    setAssign({ ...assign, [key]: next.length ? next : cur });
  };
  const valid = cart.lines.every((l) => {
    const w = who(l.key);
    return w.includes(me.id) || w.every((id) => forOthers.some((p) => p.id === id));
  });

  const send = async () => {
    setBusy(true);
    try {
      await api('/table/session/orders', {
        participantToken: deviceToken,
        idempotencyKey: idem.current,
        body: {
          items: cart.lines.map((l) => l.input),
          allocations: cart.lines.map((l) => ({ participants: who(l.key).map((participantId) => ({ participantId })) })),
        },
      });
      cart.clear();
      setAssign({});
      idem.current = newIdempotencyKey();
      setOpen(false);
      toast('Pedido enviado para a cozinha!');
      onSent();
    } catch (e) {
      toast((e as ApiError).message, 'error');
      void reload();
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="fixed inset-x-0 bottom-0 z-40 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <button onClick={() => setOpen(true)} className="animate-slide-up mx-auto flex w-full max-w-xl items-center justify-between rounded-2xl bg-brand-600 px-5 py-4 font-bold text-white shadow-2xl">
          <span className="flex items-center gap-2">
            <Send size={18} /> Revisar e enviar ({cart.count})
          </span>
          <span>{brl(cart.estimateCents)}</span>
        </button>
      </div>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Revisar pedido"
        footer={
          <button className="btn-primary w-full" disabled={busy || !valid} onClick={send}>
            {busy ? 'Enviando...' : `Enviar pedido · ${brl(cart.estimateCents)}`}
          </button>
        }
      >
        <ul className="space-y-4">
          {cart.lines.map((l) => (
            <li key={l.key} className="rounded-2xl p-3 ring-1 ring-black/10">
              <div className="flex justify-between gap-2">
                <div>
                  <p className="font-bold">{l.name}</p>
                  {l.description && <p className="text-sm text-ink-700">{l.description}</p>}
                </div>
                <span className="font-semibold">{brl(l.unitPriceCents * l.input.quantity)}</span>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <QtyStepper size="sm" value={l.input.quantity} onChange={(v) => cart.setQty(l.key, v)} />
              </div>
              <p className="mt-3 text-xs font-semibold uppercase text-black/50">Para quem?</p>
              <div className="mt-1 flex flex-wrap gap-2">
                {s.participants.map((p) => {
                  const selectable = p.isMe || forOthers.some((x) => x.id === p.id) || who(l.key).includes(me.id);
                  const on = who(l.key).includes(p.id);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      disabled={!selectable}
                      onClick={() => toggle(l.key, p.id)}
                      className={`chip py-1.5 text-sm ${on ? 'bg-brand-600 text-white' : 'bg-gold-50 text-ink-800 ring-1 ring-black/10'} disabled:opacity-30`}
                    >
                      {p.isMe ? `${p.name} (você)` : p.name}
                    </button>
                  );
                })}
              </div>
              {who(l.key).length > 1 && <p className="mt-1 text-xs text-ink-700">Compartilhado: dividido igualmente entre {who(l.key).length} pessoas.</p>}
            </li>
          ))}
        </ul>
        <p className="mt-4 text-xs text-ink-700">Você pode lançar itens para você, para quem você adicionou à mesa, ou compartilhar itens com outras pessoas.</p>
      </Modal>
    </>
  );
}

function Comanda({ s, deviceToken, onChange }: { s: SessionView; deviceToken: string; onChange: () => void }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const names = useMemo(() => Object.fromEntries(s.participants.map((p) => [p.id, p.name])), [s.participants]);
  const me = s.participants.find((p) => p.isMe)!;

  const addPerson = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api('/table/session/people', { participantToken: deviceToken, body: { name } });
      setName('');
      onChange();
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };
  const cancel = async (orderId: string) => {
    if (!window.confirm('Cancelar este pedido?')) return;
    try {
      await api(`/table/session/orders/${orderId}/cancel`, { participantToken: deviceToken, body: {} });
      onChange();
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  return (
    <div className="space-y-5">
      <section className="card p-4">
        <h2 className="mb-2 text-xl font-extrabold">Pessoas na mesa</h2>
        <div className="flex flex-wrap gap-2">
          {s.participants.map((p) => (
            <span key={p.id} className={`chip py-1.5 text-sm ${p.isMe ? 'bg-brand-600 text-white' : 'bg-gold-100 text-ink-800'}`}>
              {p.name}
              {p.isMe ? ' (você)' : ''}
            </span>
          ))}
        </div>
        <form onSubmit={addPerson} className="mt-3 flex gap-2">
          <input className="input" placeholder="Adicionar pessoa sem celular" value={name} onChange={(e) => setName(e.target.value)} minLength={2} maxLength={40} required />
          <button className="btn-gold shrink-0">
            <UserPlus size={18} />
          </button>
        </form>
      </section>

      <section>
        <h2 className="mb-2 text-xl font-extrabold">Pedidos da mesa</h2>
        {!s.orders.length ? (
          <Empty title="Nenhum pedido ainda">Escolha no cardápio e envie seu pedido.</Empty>
        ) : (
          <div className="space-y-3">
            {s.orders.map((o) => (
              <div key={o.id} className="card p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-bold">
                    #{o.number} · {time(o.createdAt)} {o.placedBy && <span className="font-normal text-ink-700">por {o.placedBy.name}</span>}
                  </p>
                  <StatusBadge status={o.status} label={o.statusLabel} />
                </div>
                <ul className="mt-2 space-y-1 text-sm">
                  {o.items.map((i) => (
                    <li key={i.id} className={`flex justify-between gap-2 ${i.canceled || o.status === 'CANCELED' ? 'line-through opacity-50' : ''}`}>
                      <span>
                        {i.quantity}x {i.name}
                        {i.description && <span className="block text-xs text-ink-700">{i.description}</span>}
                        <span className="block text-xs text-brand-700">{i.allocations.map((a) => names[a.participantId]).join(' + ')}</span>
                      </span>
                      <span className="font-semibold">{brl(i.totalCents)}</span>
                    </li>
                  ))}
                </ul>
                {o.status === 'AWAITING_ACCEPT' && o.placedBy?.id === me.id && (
                  <button className="btn-danger btn-sm mt-2" onClick={() => cancel(o.id)}>
                    Cancelar
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Conta({ s, deviceToken, onChange }: { s: SessionView; deviceToken: string; onChange: () => void }) {
  const toast = useToast();
  const [mode, setMode] = useState<'CONSUMPTION' | 'EQUAL' | 'CUSTOM'>((s.splitMode as 'CONSUMPTION') ?? 'CONSUMPTION');
  const [selected, setSelected] = useState<string[]>(s.participants.map((p) => p.id));
  const [custom, setCustom] = useState<Record<string, string[]>>({});
  const [bill, setBill] = useState<Bill>(s.bill);
  const items = s.orders.filter((o) => o.status !== 'CANCELED').flatMap((o) => o.items.filter((i) => !i.canceled));

  const config = useMemo(() => {
    if (mode === 'EQUAL') return { participantIds: selected };
    if (mode === 'CUSTOM')
      return { items: Object.fromEntries(Object.entries(custom).filter(([, v]) => v.length).map(([itemId, ids]) => [itemId, Object.fromEntries(ids.map((id) => [id, 1]))])) };
    return null;
  }, [mode, selected, custom]);

  useEffect(() => {
    api<Bill>('/table/session/split-preview', { participantToken: deviceToken, body: { mode, config } })
      .then(setBill)
      .catch((e) => toast((e as Error).message, 'error'));
  }, [mode, config, deviceToken, toast, s]);

  const requestClose = async () => {
    try {
      await api('/table/session/request-close', { participantToken: deviceToken, body: { mode, config } });
      toast('Fechamento solicitado! O atendente virá até a mesa.');
      onChange();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  return (
    <div className="space-y-5">
      <section className="card p-5">
        <div className="flex items-end justify-between">
          <div>
            <p className="text-sm text-ink-700">Total da mesa</p>
            <p className="text-4xl font-extrabold">{brl(bill.totalCents)}</p>
          </div>
          <div className="text-right text-sm">
            <p className="text-green-700">Pago: {brl(bill.paidCents)}</p>
            <p className="font-bold text-brand-700">Falta: {brl(bill.remainingCents)}</p>
          </div>
        </div>
      </section>

      <section className="card p-5">
        <h2 className="mb-3 text-xl font-extrabold">Como dividir?</h2>
        <div className="grid gap-2 sm:grid-cols-3">
          {[
            { v: 'CONSUMPTION' as const, t: 'Por consumo', d: 'Cada um paga o que pediu' },
            { v: 'EQUAL' as const, t: 'Igualmente', d: 'Total dividido entre as pessoas' },
            { v: 'CUSTOM' as const, t: 'Personalizada', d: 'Escolha quem divide cada item' },
          ].map((o) => (
            <button key={o.v} type="button" onClick={() => setMode(o.v)} className={`rounded-2xl p-3 text-left ring-1 ${mode === o.v ? 'bg-gold-50 ring-2 ring-gold-500' : 'ring-black/10'}`}>
              <p className="font-bold">{o.t}</p>
              <p className="text-xs text-ink-700">{o.d}</p>
            </button>
          ))}
        </div>
        {mode === 'EQUAL' && (
          <div className="mt-4 flex flex-wrap gap-2">
            {s.participants.map((p) => (
              <button
                key={p.id}
                onClick={() => setSelected((cur) => (cur.includes(p.id) ? (cur.length > 1 ? cur.filter((x) => x !== p.id) : cur) : [...cur, p.id]))}
                className={`chip py-1.5 text-sm ${selected.includes(p.id) ? 'bg-brand-600 text-white' : 'bg-gold-50 ring-1 ring-black/10'}`}
              >
                {p.name}
              </button>
            ))}
          </div>
        )}
        {mode === 'CUSTOM' && (
          <ul className="mt-4 space-y-3">
            {items.map((i) => {
              const cur = custom[i.id] ?? i.allocations.map((a) => a.participantId);
              return (
                <li key={i.id} className="rounded-2xl p-3 ring-1 ring-black/10">
                  <p className="flex justify-between text-sm font-bold">
                    <span>
                      {i.quantity}x {i.name}
                    </span>
                    <span>{brl(i.totalCents)}</span>
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {s.participants.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => {
                          const next = cur.includes(p.id) ? cur.filter((x) => x !== p.id) : [...cur, p.id];
                          if (next.length) setCustom({ ...custom, [i.id]: next });
                        }}
                        className={`chip py-1 ${cur.includes(p.id) ? 'bg-brand-600 text-white' : 'bg-gold-50 ring-1 ring-black/10'}`}
                      >
                        {p.name}
                      </button>
                    ))}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="card p-5">
        <h2 className="mb-3 text-xl font-extrabold">Valor por pessoa</h2>
        <ul className="divide-y divide-black/5">
          {bill.shares.map((sh) => (
            <li key={sh.participantId} className="py-3">
              <div className="flex items-center justify-between">
                <span className="font-bold">{sh.name}</span>
                <span className="text-lg font-extrabold">{brl(sh.dueCents)}</span>
              </div>
              <div className="flex justify-between text-xs text-ink-700">
                <span>{sh.items.map((x) => x.name).join(', ')}</span>
                <span className={sh.remainingCents > 0 ? 'text-brand-700' : 'text-green-700'}>
                  {sh.remainingCents > 0 ? `falta ${brl(sh.remainingCents)}` : sh.dueCents > 0 ? 'pago' : ''}
                </span>
              </div>
            </li>
          ))}
        </ul>
        <button className="btn-primary mt-4 w-full py-4" disabled={bill.totalCents === 0 || s.status === 'CLOSE_REQUESTED'} onClick={requestClose}>
          {s.status === 'CLOSE_REQUESTED' ? 'Fechamento solicitado' : 'Solicitar fechamento da conta'}
        </button>
        <p className="mt-2 text-center text-xs text-ink-700">O pagamento é feito com o atendente, que confirma cada recebimento.</p>
      </section>
    </div>
  );
}
