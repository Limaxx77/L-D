import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Bike, Clock, Search, Store, UtensilsCrossed, Zap } from 'lucide-react';
import { useStore, useToast } from '../lib/context';
import { api } from '../lib/api';
import { maskPhoneInput } from '../lib/format';
import { ComboBuilder, ComboCard } from '../components/menu';
import { HoursTable, OpenBadge, WhatsAppButton } from '../components/brand';
import type { Combo } from '../lib/types';

export default function Home() {
  const { info, menu } = useStore();
  const [combo, setCombo] = useState<Combo | null>(null);
  const featured = (menu?.combos ?? []).filter((c) => c.featured);
  const banner = info?.store.bannerUrl || '/images/hero.svg';

  return (
    <>
      <section className="relative overflow-hidden bg-ink-900">
        <img src={banner} alt="Pastéis da Pastel L&D" className="absolute inset-0 h-full w-full object-cover opacity-70" />
        <div className="absolute inset-0 bg-gradient-to-t from-ink-900 via-ink-900/50 to-transparent" />
        <div className="relative mx-auto flex min-h-[460px] max-w-6xl flex-col justify-end px-4 pb-10 pt-24 sm:min-h-[520px]">
          <img src={info?.store.logoUrl || '/images/logo.webp'} alt="Pastel L&D" className="mb-4 h-28 w-28 rounded-full shadow-2xl ring-4 ring-gold-500/70 sm:h-36 sm:w-36" />
          <div className="mb-3">
            <OpenBadge />
          </div>
          <h1 className="max-w-2xl text-4xl font-extrabold leading-[1.05] text-white drop-shadow sm:text-6xl">
            {info?.store.tagline || 'Pastel quentinho, crocante e cheio de sabor!'}
          </h1>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link to="/cardapio" className="btn-primary px-7 py-3.5 text-lg">
              <Zap size={20} /> Pedir agora
            </Link>
            <Link to="/cardapio" className="btn-gold px-7 py-3.5 text-lg">
              Ver cardápio
            </Link>
          </div>
        </div>
      </section>

      {info && !info.open.open && (
        <div className="bg-brand-600 px-4 py-3 text-center font-semibold text-white">{info.closedMessage}</div>
      )}

      <section className="mx-auto max-w-6xl px-4">
        <div className="-mt-6 grid grid-cols-3 gap-2 sm:gap-4">
          {[
            { icon: <Bike />, t: 'Delivery', d: 'Na sua casa' },
            { icon: <Store />, t: 'Retirada', d: 'Sem fila' },
            { icon: <UtensilsCrossed />, t: 'Na mesa', d: 'NFC ou QR Code' },
          ].map((x) => (
            <div key={x.t} className="card relative flex flex-col items-center gap-1 p-3 text-center sm:p-5">
              <span className="grid h-11 w-11 place-items-center rounded-2xl bg-gold-100 text-brand-600">{x.icon}</span>
              <span className="font-display text-lg font-bold leading-none">{x.t}</span>
              <span className="text-xs text-ink-700 sm:text-sm">{x.d}</span>
            </div>
          ))}
        </div>
      </section>

      {featured.length > 0 && (
        <section className="mx-auto mt-10 max-w-6xl px-4">
          <div className="mb-4 flex items-end justify-between">
            <div>
              <h2 className="text-3xl font-extrabold">Combos em destaque</h2>
              <p className="text-ink-700">Misture os sabores e economize.</p>
            </div>
            <Link to="/cardapio" className="font-bold text-brand-600">
              Ver todos →
            </Link>
          </div>
          <div className="-mx-4 flex snap-x gap-4 overflow-x-auto px-4 pb-2 sm:grid sm:grid-cols-2 sm:overflow-visible lg:grid-cols-4">
            {featured.map((c) => (
              <ComboCard key={c.id} c={c} compact onOpen={() => setCombo(c)} />
            ))}
          </div>
        </section>
      )}

      <section className="mx-auto mt-10 grid max-w-6xl gap-4 px-4 md:grid-cols-2">
        <TrackOrderCard />
        <div className="card p-6">
          <h2 className="flex items-center gap-2 text-2xl font-extrabold">
            <Clock className="text-brand-600" /> Horário de funcionamento
          </h2>
          <div className="mt-4">{info ? info.hours.length ? <HoursTable hours={info.hours} /> : <p className="text-sm text-ink-700">Horários em breve.</p> : null}</div>
          <div className="mt-5">
            <WhatsAppButton text="Olá! Vim pelo site da Pastel L&D." />
          </div>
        </div>
      </section>
      {combo && <ComboBuilder combo={combo} onClose={() => setCombo(null)} />}
    </>
  );
}

function TrackOrderCard() {
  const nav = useNavigate();
  const toast = useToast();
  const [number, setNumber] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  let last: { token: string; number: number } | null = null;
  try {
    last = JSON.parse(localStorage.getItem('ld-last-order') ?? 'null');
  } catch {
    /* ignore */
  }
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api<{ publicToken: string }>('/public/orders/lookup', { body: { number: Number(number.replace('#', '')), phone } });
      nav(`/pedido/${r.publicToken}`);
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="card p-6">
      <h2 className="flex items-center gap-2 text-2xl font-extrabold">
        <Search className="text-brand-600" /> Acompanhe seu pedido
      </h2>
      {last && (
        <Link to={`/pedido/${last.token}`} className="btn-gold mt-4 w-full">
          Ver meu último pedido #{last.number}
        </Link>
      )}
      <form onSubmit={submit} className="mt-4 grid gap-3 sm:grid-cols-[1fr_1.3fr_auto]">
        <input className="input" inputMode="numeric" placeholder="Nº do pedido" value={number} onChange={(e) => setNumber(e.target.value)} required />
        <input className="input" inputMode="tel" placeholder="Seu telefone" value={phone} onChange={(e) => setPhone(maskPhoneInput(e.target.value))} required />
        <button className="btn-dark" disabled={busy}>
          Buscar
        </button>
      </form>
    </div>
  );
}
