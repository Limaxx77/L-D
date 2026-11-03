import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from './api';
import type { CartLine, Menu, StoreInfo } from './types';

// --------------------------------- Toasts ---------------------------------

type Toast = { id: number; text: string; tone: 'ok' | 'error' | 'info' };
const ToastCtx = createContext<(text: string, tone?: Toast['tone']) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, tone: Toast['tone'] = 'ok') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="no-print pointer-events-none fixed inset-x-0 top-3 z-[100] flex flex-col items-center gap-2 px-4" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`animate-slide-up pointer-events-auto max-w-md rounded-2xl px-4 py-3 text-sm font-semibold shadow-xl ${
              t.tone === 'error' ? 'bg-brand-700 text-white' : t.tone === 'info' ? 'bg-ink-900 text-white' : 'bg-gold-500 text-ink-900'
            }`}
          >
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

// ------------------------------ Loja e cardápio ------------------------------

interface StoreCtxValue {
  info: StoreInfo | null;
  menu: Menu | null;
  error: string | null;
  reload: () => Promise<void>;
}
const StoreCtx = createContext<StoreCtxValue>({ info: null, menu: null, error: null, reload: async () => {} });

export function StoreProvider({ children }: { children: ReactNode }) {
  const [info, setInfo] = useState<StoreInfo | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    try {
      const [i, m] = await Promise.all([api<StoreInfo>('/public/store'), api<Menu>('/public/menu')]);
      setInfo(i);
      setMenu(m);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void reload();
    const t = setInterval(reload, 60_000); // preços/disponibilidade atualizados sem novo deploy
    const onFocus = () => void reload();
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(t);
      window.removeEventListener('focus', onFocus);
    };
  }, [reload]);
  return <StoreCtx.Provider value={{ info, menu, error, reload }}>{children}</StoreCtx.Provider>;
}
export const useStore = () => useContext(StoreCtx);

// --------------------------------- Carrinho ---------------------------------

interface CartCtxValue {
  lines: CartLine[];
  add: (line: Omit<CartLine, 'key'>) => void;
  setQty: (key: string, qty: number) => void;
  setNotes: (key: string, notes: string) => void;
  remove: (key: string) => void;
  clear: () => void;
  count: number;
  estimateCents: number;
}
const CartCtx = createContext<CartCtxValue | null>(null);

function readStorage(key: string): CartLine[] {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export function CartProvider({ storageKey, children }: { storageKey: string; children: ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>(() => readStorage(storageKey));
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(lines));
    } catch {
      /* armazenamento indisponível (modo privado) */
    }
  }, [lines, storageKey]);

  const value = useMemo<CartCtxValue>(
    () => ({
      lines,
      add: (line) => {
        setLines((ls) => {
          // Produtos iguais (mesma opção e observação) somam quantidade
          const input = line.input;
          if (input.type === 'product') {
            const same = ls.find(
              (l) =>
                l.input.type === 'product' &&
                l.input.productId === input.productId &&
                (l.input.optionId ?? null) === (input.optionId ?? null) &&
                (l.input.notes ?? '') === (input.notes ?? ''),
            );
            if (same) return ls.map((l) => (l === same ? { ...l, input: { ...l.input, quantity: Math.min(50, l.input.quantity + input.quantity) } } : l));
          }
          return [...ls, { ...line, key: crypto.randomUUID() }];
        });
      },
      setQty: (key, qty) =>
        setLines((ls) => (qty <= 0 ? ls.filter((l) => l.key !== key) : ls.map((l) => (l.key === key ? { ...l, input: { ...l.input, quantity: qty } } : l)))),
      setNotes: (key, notes) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, input: { ...l.input, notes } } : l))),
      remove: (key) => setLines((ls) => ls.filter((l) => l.key !== key)),
      clear: () => setLines([]),
      count: lines.reduce((s, l) => s + l.input.quantity, 0),
      estimateCents: lines.reduce((s, l) => s + l.unitPriceCents * l.input.quantity, 0),
    }),
    [lines],
  );
  return <CartCtx.Provider value={value}>{children}</CartCtx.Provider>;
}
export function useCart() {
  const c = useContext(CartCtx);
  if (!c) throw new Error('CartProvider ausente');
  return c;
}

// ------------------------------ Conta do cliente ------------------------------

export interface Customer {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  whatsappOptIn: boolean;
  addresses?: { id: string; label: string | null; street: string; number: string; neighborhood: string; complement: string | null; reference: string | null; deliveryAreaId: string | null }[];
}

const CustomerCtx = createContext<{ customer: Customer | null; loading: boolean; refresh: () => Promise<void>; setCustomer: (c: Customer | null) => void }>({
  customer: null,
  loading: true,
  refresh: async () => {},
  setCustomer: () => {},
});

export function CustomerProvider({ children }: { children: ReactNode }) {
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    try {
      setCustomer(await api<Customer | null>('/customer/me'));
    } catch {
      setCustomer(null);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return <CustomerCtx.Provider value={{ customer, loading, refresh, setCustomer }}>{children}</CustomerCtx.Provider>;
}
export const useCustomer = () => useContext(CustomerCtx);
