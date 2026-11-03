import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { LogOut, RotateCcw, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { useCart, useCustomer, useStore, useToast, type Customer } from '../lib/context';
import { brl, dateTime, formatPhone, maskPhoneInput } from '../lib/format';
import type { CartLineInput } from '../lib/types';
import { Field, Spinner, StatusBadge } from '../components/ui';

export default function Account() {
  const { customer, loading } = useCustomer();
  if (loading) return <Spinner />;
  return <div className="mx-auto max-w-3xl px-4 py-6">{customer ? <Profile customer={customer} /> : <AuthForms />}</div>;
}

function AuthForms() {
  const { setCustomer, refresh } = useCustomer();
  const toast = useToast();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [f, setF] = useState({ name: '', phone: '', email: '', password: '', login: '', optIn: true, privacy: false });
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === 'login') await api('/customer/login', { body: { login: f.login, password: f.password } });
      else
        await api<Customer>('/customer/register', {
          body: { name: f.name, phone: f.phone, email: f.email || null, password: f.password, whatsappOptIn: f.optIn, privacyAccepted: f.privacy },
        });
      await refresh();
      toast(mode === 'login' ? 'Bem-vindo(a) de volta!' : 'Conta criada!');
    } catch (err) {
      toast((err as Error).message, 'error');
      setCustomer(null);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="card mx-auto max-w-md p-6">
      <div className="mb-5 grid grid-cols-2 gap-1 rounded-2xl bg-gold-50 p-1">
        {(['login', 'register'] as const).map((m) => (
          <button key={m} type="button" onClick={() => setMode(m)} className={`rounded-xl py-2 font-bold ${mode === m ? 'bg-white shadow' : ''}`}>
            {m === 'login' ? 'Entrar' : 'Criar conta'}
          </button>
        ))}
      </div>
      <form onSubmit={submit} className="space-y-3">
        {mode === 'login' ? (
          <Field label="Telefone ou e-mail">
            <input className="input" required value={f.login} onChange={(e) => setF({ ...f, login: e.target.value })} autoComplete="username" />
          </Field>
        ) : (
          <>
            <Field label="Nome completo">
              <input className="input" required minLength={2} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoComplete="name" />
            </Field>
            <Field label="Telefone / WhatsApp">
              <input className="input" required inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: maskPhoneInput(e.target.value) })} autoComplete="tel" />
            </Field>
            <Field label="E-mail (opcional)">
              <input className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} autoComplete="email" />
            </Field>
          </>
        )}
        <Field label="Senha" hint={mode === 'register' ? 'Mínimo de 8 caracteres' : undefined}>
          <input className="input" type="password" required minLength={mode === 'register' ? 8 : 1} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
        </Field>
        {mode === 'register' && (
          <>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-0.5 h-5 w-5 accent-brand-600" checked={f.optIn} onChange={(e) => setF({ ...f, optIn: e.target.checked })} />
              Aceito receber atualizações dos meus pedidos pelo WhatsApp.
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" required className="mt-0.5 h-5 w-5 accent-brand-600" checked={f.privacy} onChange={(e) => setF({ ...f, privacy: e.target.checked })} />
              <span>
                Li e aceito a <Link to="/privacidade" className="font-semibold underline">política de privacidade</Link>.
              </span>
            </label>
          </>
        )}
        <button className="btn-primary w-full" disabled={busy}>
          {mode === 'login' ? 'Entrar' : 'Criar conta'}
        </button>
        <p className="text-center text-sm text-ink-700">
          Não precisa de conta para pedir. <Link to="/cardapio" className="font-semibold text-brand-600">Pedir como visitante</Link>
        </p>
      </form>
    </div>
  );
}

interface MyOrder {
  number: number;
  publicToken: string;
  status: string;
  statusLabel: string;
  totalCents: number;
  createdAt: string;
  items: { name: string; quantity: number; description: string | null }[];
}

function Profile({ customer }: { customer: Customer }) {
  const { refresh, setCustomer } = useCustomer();
  const { menu } = useStore();
  const cart = useCart();
  const toast = useToast();
  const nav = useNavigate();
  const [orders, setOrders] = useState<MyOrder[] | null>(null);
  const [form, setForm] = useState({ name: customer.name, email: customer.email ?? '', whatsappOptIn: customer.whatsappOptIn, currentPassword: '', newPassword: '' });

  useEffect(() => {
    api<MyOrder[]>('/customer/orders').then(setOrders).catch(() => setOrders([]));
  }, []);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api('/customer/me', {
        method: 'PUT',
        body: { name: form.name, email: form.email || null, whatsappOptIn: form.whatsappOptIn, ...(form.newPassword ? { newPassword: form.newPassword, currentPassword: form.currentPassword } : {}) },
      });
      await refresh();
      setForm((f) => ({ ...f, currentPassword: '', newPassword: '' }));
      toast('Dados atualizados.');
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  const reorder = async (token: string) => {
    try {
      const lines = await api<{ line: CartLineInput; ok: boolean; reason?: string; name: string }[]>(`/customer/orders/${token}/reorder`, { body: {} });
      let added = 0;
      for (const l of lines) {
        if (!l.ok) {
          toast(`${l.name}: ${l.reason}`, 'error');
          continue;
        }
        const unit =
          l.line.type === 'combo'
            ? menu?.combos.find((c) => c.id === (l.line as { comboId: string }).comboId)?.priceCents ?? 0
            : (() => {
                const p = menu?.products.find((x) => x.id === (l.line as { productId: string }).productId);
                const o = p?.options.find((x) => x.id === (l.line as { optionId?: string | null }).optionId);
                return o?.priceCents ?? p?.promoPriceCents ?? p?.priceCents ?? 0;
              })();
        cart.add({ input: l.line, name: l.name, unitPriceCents: unit });
        added++;
      }
      if (added) {
        toast('Itens adicionados com preços atuais.');
        nav('/carrinho');
      }
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  const removeAddress = async (id: string) => {
    await api(`/customer/addresses/${id}`, { method: 'DELETE' });
    await refresh();
  };

  const deleteAccount = async () => {
    if (!window.confirm('Excluir sua conta? Seus dados pessoais serão anonimizados e esta ação não pode ser desfeita.')) return;
    await api('/customer/me', { method: 'DELETE' });
    setCustomer(null);
    toast('Conta excluída.');
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-extrabold">Olá, {customer.name.split(' ')[0]}!</h1>
          <p className="text-ink-700">{formatPhone(customer.phone)}</p>
        </div>
        <button
          className="btn-ghost btn-sm"
          onClick={async () => {
            await api('/customer/logout', { body: {} });
            setCustomer(null);
          }}
        >
          <LogOut size={16} /> Sair
        </button>
      </div>

      <section className="card p-5">
        <h2 className="mb-3 text-2xl font-extrabold">Meus pedidos</h2>
        {!orders ? (
          <Spinner />
        ) : !orders.length ? (
          <p className="text-ink-700">Você ainda não fez pedidos com esta conta.</p>
        ) : (
          <ul className="divide-y divide-black/5">
            {orders.map((o) => (
              <li key={o.publicToken} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <Link to={`/pedido/${o.publicToken}`} className="min-w-0 flex-1">
                  <p className="font-bold">
                    #{o.number} · {brl(o.totalCents)} <StatusBadge status={o.status} label={o.statusLabel} />
                  </p>
                  <p className="truncate text-sm text-ink-700">{o.items.map((i) => `${i.quantity}x ${i.name}`).join(', ')}</p>
                  <p className="text-xs text-black/50">{dateTime(o.createdAt)}</p>
                </Link>
                <button className="btn-gold btn-sm" onClick={() => reorder(o.publicToken)}>
                  <RotateCcw size={16} /> Repetir
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {customer.addresses && customer.addresses.length > 0 && (
        <section className="card p-5">
          <h2 className="mb-3 text-2xl font-extrabold">Endereços</h2>
          <ul className="space-y-2">
            {customer.addresses.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 rounded-2xl bg-gold-50 px-4 py-3 text-sm">
                <span>
                  {a.street}, {a.number} — {a.neighborhood}
                  {a.complement ? ` (${a.complement})` : ''}
                </span>
                <button className="text-brand-700" onClick={() => removeAddress(a.id)} aria-label="Remover endereço">
                  <Trash2 size={18} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <form onSubmit={save} className="card space-y-3 p-5">
        <h2 className="text-2xl font-extrabold">Meus dados</h2>
        <Field label="Nome">
          <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        </Field>
        <Field label="E-mail">
          <input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="h-5 w-5 accent-brand-600" checked={form.whatsappOptIn} onChange={(e) => setForm({ ...form, whatsappOptIn: e.target.checked })} /> Receber atualizações pelo WhatsApp
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Senha atual">
            <input className="input" type="password" value={form.currentPassword} onChange={(e) => setForm({ ...form, currentPassword: e.target.value })} autoComplete="current-password" />
          </Field>
          <Field label="Nova senha">
            <input className="input" type="password" minLength={8} value={form.newPassword} onChange={(e) => setForm({ ...form, newPassword: e.target.value })} autoComplete="new-password" />
          </Field>
        </div>
        <div className="flex flex-wrap justify-between gap-3">
          <button className="btn-primary">Salvar</button>
          <button type="button" className="btn-danger btn-sm" onClick={deleteAccount}>
            Excluir minha conta
          </button>
        </div>
      </form>
    </div>
  );
}
