import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { ShoppingBag, User, AtSign, Globe, MapPin } from 'lucide-react';
import { useCart, useStore } from '../lib/context';
import { brl, formatPhone } from '../lib/format';
import { Logo, OpenBadge, WhatsAppButton, OFFICIAL_WHATSAPP } from './brand';

export function PublicLayout() {
  const cart = useCart();
  const { info } = useStore();
  const { pathname } = useLocation();
  const showCartBar = cart.count > 0 && !['/carrinho'].includes(pathname) && !pathname.startsWith('/pedido');

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 border-b border-black/5 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-[60px] max-w-6xl items-center justify-between gap-3 px-4">
          <Link to="/" aria-label="Início">
            <Logo size={38} />
          </Link>
          <nav className="flex items-center gap-1 sm:gap-2">
            <span className="hidden sm:block">
              <OpenBadge />
            </span>
            <NavLink to="/cardapio" className="hidden rounded-xl px-3 py-2 font-semibold hover:bg-gold-50 sm:block">
              Cardápio
            </NavLink>
            <NavLink to="/conta" className="rounded-xl p-2 hover:bg-gold-50" aria-label="Minha conta">
              <User />
            </NavLink>
            <NavLink to="/carrinho" className="relative rounded-xl p-2 hover:bg-gold-50" aria-label="Carrinho">
              <ShoppingBag />
              {cart.count > 0 && <span className="absolute -right-0.5 -top-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-brand-600 px-1 text-xs font-bold text-white">{cart.count}</span>}
            </NavLink>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        <Outlet />
      </main>

      <footer className="mt-12 bg-ink-900 pb-28 pt-10 text-white/80">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 sm:grid-cols-3">
          <div>
            <Logo light />
            <p className="mt-3 text-sm">{info?.store.tagline}</p>
          </div>
          <div className="space-y-2 text-sm">
            <p className="font-bold text-white">Contato</p>
            <p>WhatsApp: {formatPhone(info?.store.whatsapp || OFFICIAL_WHATSAPP)}</p>
            {info?.store.address && (
              <p className="flex gap-1">
                <MapPin size={16} /> {info.store.address}
              </p>
            )}
            <div className="flex gap-3 pt-1">
              {info?.store.instagram && (
                <a href={info.store.instagram} target="_blank" rel="noopener noreferrer" aria-label="Instagram">
                  <AtSign />
                </a>
              )}
              {info?.store.facebook && (
                <a href={info.store.facebook} target="_blank" rel="noopener noreferrer" aria-label="Facebook">
                  <Globe />
                </a>
              )}
            </div>
          </div>
          <div className="space-y-2 text-sm">
            <WhatsAppButton />
            <p>
              <Link to="/privacidade" className="underline">
                Política de privacidade
              </Link>
            </p>
          </div>
        </div>
      </footer>

      {showCartBar && (
        <div className="no-print fixed inset-x-0 bottom-0 z-40 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <Link to="/carrinho" className="animate-slide-up mx-auto flex max-w-xl items-center justify-between rounded-2xl bg-brand-600 px-5 py-4 font-bold text-white shadow-2xl shadow-brand-700/40">
            <span className="flex items-center gap-2">
              <ShoppingBag size={20} /> Ver carrinho ({cart.count})
            </span>
            <span>{brl(cart.estimateCents)}</span>
          </Link>
        </div>
      )}
    </div>
  );
}
