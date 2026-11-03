import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import {
  BarChart3, Bell, BellOff, ChefHat, ClipboardList, Cog, FileText, LayoutDashboard, LogOut, Menu as MenuIcon, MessageCircle,
  Nfc, Package, ShieldCheck, Sparkles, Tags, Truck, Users, UtensilsCrossed, Wallet, X,
} from 'lucide-react';
import { api } from '../lib/api';
import { useSocket } from '../lib/socket';
import { useToast } from '../lib/context';
import { Logo } from '../components/brand';
import { Field, Spinner } from '../components/ui';
import Dashboard from './Dashboard';
import Orders, { Kitchen, Deliveries, setWaAutoOpen, waAutoOpen } from './Orders';
import { TablesBoard } from './Tables';
import { NfcManager } from './Nfc';
import { Categories, Combos, Products } from './Catalog';
import Customers from './Customers';
import { Finance, Reports } from './Finance';
import Settings from './Settings';
import Integrations from './Integrations';
import { Audit, UsersAdmin } from './Users';

export interface Staff {
  id: string;
  name: string;
  email: string;
  role: 'ADMIN' | 'ATTENDANT' | 'KITCHEN' | 'COURIER';
  roleName: string;
  permissions: string[];
}

interface AdminCtx {
  staff: Staff;
  can: (perm: string) => boolean;
  /** incrementa a cada evento de pedido em tempo real (para recarregar telas) */
  orderTick: number;
  tableTick: number;
  soundOn: boolean;
}
const Ctx = createContext<AdminCtx | null>(null);
export const useAdmin = () => useContext(Ctx)!;

/** Alerta sonoro gerado no navegador (requer um clique para liberar o áudio). */
function useAlarm() {
  const ctxRef = useRef<AudioContext | null>(null);
  const [enabled, setEnabled] = useState(false);
  const enable = () => {
    ctxRef.current ??= new AudioContext();
    void ctxRef.current.resume();
    setEnabled(true);
    beep();
  };
  const beep = useCallback(() => {
    const ctx = ctxRef.current;
    if (!ctx || ctx.state !== 'running') return;
    [0, 0.25, 0.5].forEach((t, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'square';
      o.frequency.value = i === 2 ? 1320 : 880;
      g.gain.setValueAtTime(0.0001, ctx.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.2);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + t);
      o.stop(ctx.currentTime + t + 0.22);
    });
  }, []);
  return { enabled, enable, disable: () => setEnabled(false), beep };
}

const NAV = [
  { to: '/admin', label: 'Dashboard', icon: LayoutDashboard, perm: 'dashboard.view', end: true },
  { to: '/admin/pedidos', label: 'Pedidos', icon: ClipboardList, perm: 'orders.view' },
  { to: '/admin/cozinha', label: 'Cozinha', icon: ChefHat, perm: 'orders.view' },
  { to: '/admin/entregas', label: 'Minhas entregas', icon: Truck, perm: 'deliveries.own' },
  { to: '/admin/mesas', label: 'Mesas e comandas', icon: UtensilsCrossed, perm: 'tables.manage' },
  { to: '/admin/produtos', label: 'Produtos', icon: Package, perm: 'catalog.manage' },
  { to: '/admin/combos', label: 'Combos', icon: Sparkles, perm: 'catalog.manage' },
  { to: '/admin/categorias', label: 'Categorias', icon: Tags, perm: 'catalog.manage' },
  { to: '/admin/clientes', label: 'Clientes', icon: Users, perm: 'customers.view' },
  { to: '/admin/financeiro', label: 'Financeiro', icon: Wallet, perm: 'finance.view' },
  { to: '/admin/relatorios', label: 'Relatórios', icon: BarChart3, perm: 'finance.view' },
  { to: '/admin/nfc', label: 'NFC e QR Codes', icon: Nfc, perm: 'tables.manage' },
  { to: '/admin/configuracoes', label: 'Configurações', icon: Cog, perm: 'settings.manage' },
  { to: '/admin/integracoes', label: 'Integrações WhatsApp', icon: MessageCircle, perm: 'integrations.manage' },
  { to: '/admin/usuarios', label: 'Usuários e permissões', icon: ShieldCheck, perm: 'users.manage' },
  { to: '/admin/auditoria', label: 'Auditoria', icon: FileText, perm: 'audit.view' },
];

export default function AdminApp() {
  const [staff, setStaff] = useState<Staff | null | undefined>(undefined);
  const load = useCallback(() => api<Staff>('/admin/auth/me').then(setStaff).catch(() => setStaff(null)), []);
  useEffect(() => {
    void load();
  }, [load]);
  if (staff === undefined) return <Spinner />;
  if (!staff) return <Login onLogin={load} />;
  return <Shell staff={staff} onLogout={() => setStaff(null)} />;
}

function Login({ onLogin }: { onLogin: () => void }) {
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex min-h-dvh items-center justify-center bg-ink-900 px-4">
      <form
        className="card w-full max-w-sm space-y-4 p-6"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await api('/admin/auth/login', { body: { email, password } });
            onLogin();
          } catch (err) {
            toast((err as Error).message, 'error');
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="flex justify-center">
          <Logo size={120} withText={false} />
        </div>
        <h1 className="text-center text-2xl font-extrabold">Painel administrativo</h1>
        <Field label="E-mail">
          <input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
        </Field>
        <Field label="Senha">
          <input className="input" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        </Field>
        <button className="btn-primary w-full" disabled={busy}>
          Entrar
        </button>
      </form>
    </div>
  );
}

function Shell({ staff, onLogout }: { staff: Staff; onLogout: () => void }) {
  const toast = useToast();
  const nav = useNavigate();
  const alarm = useAlarm();
  const [orderTick, setOrderTick] = useState(0);
  const [tableTick, setTableTick] = useState(0);
  const [open, setOpen] = useState(false);
  const [newOrders, setNewOrders] = useState(0);
  const [connected, setConnected] = useState(false);
  const [waOn, setWaOn] = useState(waAutoOpen);
  const can = (p: string) => staff.permissions.includes(p);
  const alarmRef = useRef(alarm);
  alarmRef.current = alarm;

  useSocket(
    async () => ({ staffToken: (await api<{ token: string }>('/admin/auth/realtime-token')).token }),
    {
      'order:new': (o: { number: number; customerName: string; type: string }) => {
        setOrderTick((t) => t + 1);
        if (staff.role === 'COURIER') return;
        setNewOrders((n) => n + 1);
        if (alarmRef.current.enabled) alarmRef.current.beep();
        toast(`🔔 Novo pedido #${o.number} — ${o.customerName}`, 'info');
        if ('Notification' in window && Notification.permission === 'granted')
          new Notification(`Novo pedido #${o.number}`, { body: o.customerName, icon: '/icons/icon-192.png', tag: `order-${o.number}` });
      },
      'order:updated': () => setOrderTick((t) => t + 1),
      'order:removed': () => setOrderTick((t) => t + 1),
      'table:updated': () => setTableTick((t) => t + 1),
      'table:closeRequested': (p: { table: string }) => {
        setTableTick((t) => t + 1);
        if (alarmRef.current.enabled) alarmRef.current.beep();
        toast(`🧾 ${p.table} pediu para fechar a conta`, 'info');
      },
      $connect: () => {
        setConnected(true);
        setOrderTick((t) => t + 1);
      },
      $disconnect: () => setConnected(false),
    },
    [staff.id],
  );

  // Repete o alarme enquanto houver pedidos aguardando aceite
  useEffect(() => {
    if (!alarm.enabled || staff.role === 'COURIER' || staff.role === 'KITCHEN') return;
    const t = setInterval(async () => {
      try {
        const board = await api<{ status: string }[]>('/admin/orders/board');
        if (board.some((o) => o.status === 'AWAITING_ACCEPT')) alarmRef.current.beep();
      } catch {
        /* ignora */
      }
    }, 20_000);
    return () => clearInterval(t);
  }, [alarm.enabled, staff.role]);

  const logout = async () => {
    await api('/admin/auth/logout', { body: {} });
    onLogout();
    nav('/admin');
  };

  const items = NAV.filter((n) => can(n.perm));
  const home = items[0]?.to ?? '/admin';

  return (
    <Ctx.Provider value={{ staff, can, orderTick, tableTick, soundOn: alarm.enabled }}>
      <div className="flex min-h-dvh bg-[#f6f3ec]">
        <aside className={`no-print fixed inset-y-0 left-0 z-40 w-64 transform bg-ink-900 text-white transition lg:static lg:translate-x-0 ${open ? 'translate-x-0' : '-translate-x-full'}`}>
          <div className="flex h-16 items-center justify-between px-4">
            <Logo size={34} light />
            <button className="lg:hidden" onClick={() => setOpen(false)} aria-label="Fechar menu">
              <X />
            </button>
          </div>
          <nav className="h-[calc(100dvh-8rem)] space-y-0.5 overflow-y-auto px-2">
            {items.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                onClick={() => {
                  setOpen(false);
                  if (n.to === '/admin/pedidos') setNewOrders(0);
                }}
                className={({ isActive }) => `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold ${isActive ? 'bg-brand-600 text-white' : 'text-white/75 hover:bg-white/10'}`}
              >
                <n.icon size={18} /> {n.label}
                {n.to === '/admin/pedidos' && newOrders > 0 && <span className="ml-auto rounded-full bg-gold-500 px-2 text-xs font-bold text-ink-900">{newOrders}</span>}
              </NavLink>
            ))}
          </nav>
          <div className="absolute inset-x-0 bottom-0 border-t border-white/10 p-3 text-sm">
            <p className="truncate font-semibold">{staff.name}</p>
            <p className="text-xs text-white/60">{staff.roleName}</p>
          </div>
        </aside>
        {open && <div className="fixed inset-0 z-30 bg-black/40 lg:hidden" onClick={() => setOpen(false)} />}

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="no-print sticky top-0 z-20 flex h-16 items-center justify-between gap-2 border-b border-black/5 bg-white px-4">
            <button className="lg:hidden" onClick={() => setOpen(true)} aria-label="Abrir menu">
              <MenuIcon />
            </button>
            <span className={`chip ${connected ? 'bg-green-100 text-green-800' : 'bg-brand-100 text-brand-700'}`}>
              <span className={`h-2 w-2 rounded-full ${connected ? 'bg-green-600' : 'bg-brand-600'}`} /> {connected ? 'Tempo real ativo' : 'Reconectando...'}
            </span>
            <div className="flex items-center gap-2">
              {staff.role !== 'COURIER' && (
                <button
                  className={`btn-sm ${alarm.enabled ? 'btn-gold' : 'btn-primary animate-pulse-ring'}`}
                  onClick={() => {
                    if (alarm.enabled) return alarm.disable();
                    alarm.enable();
                    if ('Notification' in window && Notification.permission === 'default') void Notification.requestPermission();
                  }}
                >
                  {alarm.enabled ? <Bell size={16} /> : <BellOff size={16} />} {alarm.enabled ? 'Som ativo' : 'Ativar alertas'}
                </button>
              )}
              {(can('orders.manage') || can('deliveries.own')) && (
                <button
                  className={`btn-sm ${waOn ? 'rounded-xl bg-[#25D366] text-white' : 'btn-ghost'}`}
                  title="Ao aceitar, recusar ou mudar o status, abre o WhatsApp com a mensagem pronta para o cliente"
                  onClick={() => {
                    setWaAutoOpen(!waOn);
                    setWaOn(!waOn);
                  }}
                >
                  <MessageCircle size={16} /> <span className="hidden md:inline">{waOn ? 'Avisar no WhatsApp: ligado' : 'Avisar no WhatsApp: desligado'}</span>
                </button>
              )}
              <a href="/" target="_blank" className="btn-ghost btn-sm hidden sm:inline-flex">
                Ver site
              </a>
              <button className="btn-ghost btn-sm" onClick={logout} aria-label="Sair">
                <LogOut size={16} />
              </button>
            </div>
          </header>
          <main className="min-w-0 flex-1 p-4 lg:p-6">
            <Routes>
              <Route index element={can('dashboard.view') ? <Dashboard /> : <Navigate to={home} replace />} />
              <Route path="pedidos" element={<Guard perm="orders.view"><Orders /></Guard>} />
              <Route path="cozinha" element={<Guard perm="orders.view"><Kitchen /></Guard>} />
              <Route path="entregas" element={<Guard perm="deliveries.own"><Deliveries /></Guard>} />
              <Route path="mesas" element={<Guard perm="tables.manage"><TablesBoard /></Guard>} />
              <Route path="produtos" element={<Guard perm="catalog.manage"><Products /></Guard>} />
              <Route path="combos" element={<Guard perm="catalog.manage"><Combos /></Guard>} />
              <Route path="categorias" element={<Guard perm="catalog.manage"><Categories /></Guard>} />
              <Route path="clientes" element={<Guard perm="customers.view"><Customers /></Guard>} />
              <Route path="financeiro" element={<Guard perm="finance.view"><Finance /></Guard>} />
              <Route path="relatorios" element={<Guard perm="finance.view"><Reports /></Guard>} />
              <Route path="nfc" element={<Guard perm="tables.manage"><NfcManager /></Guard>} />
              <Route path="configuracoes" element={<Guard perm="settings.manage"><Settings /></Guard>} />
              <Route path="integracoes" element={<Guard perm="integrations.manage"><Integrations /></Guard>} />
              <Route path="usuarios" element={<Guard perm="users.manage"><UsersAdmin /></Guard>} />
              <Route path="auditoria" element={<Guard perm="audit.view"><Audit /></Guard>} />
              <Route path="*" element={<Navigate to={home} replace />} />
            </Routes>
          </main>
        </div>
      </div>
    </Ctx.Provider>
  );
}

function Guard({ perm, children }: { perm: string; children: ReactNode }) {
  const { can } = useAdmin();
  if (!can(perm)) return <p className="p-6 font-semibold text-brand-700">Você não tem permissão para acessar esta área.</p>;
  return <>{children}</>;
}

export function PageTitle({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-3xl font-extrabold">{title}</h1>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}
