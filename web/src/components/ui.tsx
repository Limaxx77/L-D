import { useEffect, useRef, type ReactNode } from 'react';
import { Minus, Plus, X, Loader2 } from 'lucide-react';

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  size = 'md',
  dismissable = true,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  dismissable?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // onClose costuma ser uma função nova a cada render; guardá-la em ref evita que o efeito
  // rode a cada tecla digitada (o que roubava o foco do campo e fechava o teclado do celular).
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const dismissRef = useRef(dismissable);
  dismissRef.current = dismissable;
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && dismissRef.current && closeRef.current();
    window.addEventListener('keydown', onKey);
    // Foca a janela só ao abrir, e só se nenhum campo dentro dela já estiver em foco.
    if (!ref.current?.contains(document.activeElement)) ref.current?.focus({ preventScroll: true });
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);
  if (!open) return null;
  const width = { sm: 'sm:max-w-sm', md: 'sm:max-w-lg', lg: 'sm:max-w-2xl', xl: 'sm:max-w-4xl' }[size];
  return (
    <div className="no-print fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-[2px] sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && dismissable && onClose()}>
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        className={`animate-slide-up flex max-h-[92dvh] w-full flex-col rounded-t-3xl bg-white shadow-2xl outline-none sm:rounded-3xl ${width}`}
      >
        {(title || dismissable) && (
          <div className="flex items-center justify-between gap-3 border-b border-black/5 px-5 py-4">
            <h2 className="text-xl font-bold leading-tight">{title}</h2>
            {dismissable && (
              <button onClick={onClose} className="rounded-full p-2 hover:bg-black/5" aria-label="Fechar">
                <X size={20} />
              </button>
            )}
          </div>
        )}
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="border-t border-black/5 px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">{footer}</div>}
      </div>
    </div>
  );
}

export function QtyStepper({ value, onChange, min = 0, max = 50, size = 'md' }: { value: number; onChange: (v: number) => void; min?: number; max?: number; size?: 'sm' | 'md' }) {
  const s = size === 'sm' ? 'h-8 w-8' : 'h-10 w-10';
  return (
    <div className="inline-flex items-center gap-1 rounded-2xl bg-gold-50 p-1 ring-1 ring-gold-200">
      <button type="button" className={`${s} grid place-items-center rounded-xl bg-white text-brand-600 shadow-sm disabled:opacity-40`} onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min} aria-label="Diminuir">
        <Minus size={16} />
      </button>
      <span className="min-w-8 text-center font-bold tabular-nums">{value}</span>
      <button type="button" className={`${s} grid place-items-center rounded-xl bg-brand-600 text-white shadow-sm disabled:opacity-40`} onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max} aria-label="Aumentar">
        <Plus size={16} />
      </button>
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-ink-700">
      <Loader2 className="animate-spin text-brand-600" /> {label ?? 'Carregando...'}
    </div>
  );
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-12 text-center text-ink-700">
      {icon && <div className="mb-1 text-gold-600">{icon}</div>}
      <p className="font-display text-xl font-bold text-ink-900">{title}</p>
      {children}
    </div>
  );
}

export function Field({ label, children, hint, error }: { label: string; children: ReactNode; hint?: ReactNode; error?: string | null }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-black/50">{hint}</span>}
      {error && <span className="mt-1 block text-xs font-semibold text-brand-700">{error}</span>}
    </label>
  );
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; disabled?: boolean }) {
  return (
    <label className={`inline-flex cursor-pointer select-none items-center gap-3 ${disabled ? 'opacity-50' : ''}`}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative h-7 w-12 shrink-0 rounded-full transition ${checked ? 'bg-green-600' : 'bg-black/20'}`}
      >
        <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition ${checked ? 'left-[22px]' : 'left-0.5'}`} />
      </button>
      {label && <span className="text-sm font-medium">{label}</span>}
    </label>
  );
}

const STATUS_TONE: Record<string, string> = {
  AWAITING_ACCEPT: 'bg-gold-200 text-gold-700',
  ACCEPTED: 'bg-sky-100 text-sky-800',
  PREPARING: 'bg-orange-100 text-orange-800',
  READY: 'bg-emerald-100 text-emerald-800',
  OUT_FOR_DELIVERY: 'bg-indigo-100 text-indigo-800',
  DELIVERED: 'bg-green-100 text-green-800',
  PICKED_UP: 'bg-green-100 text-green-800',
  SERVED: 'bg-green-100 text-green-800',
  CANCELED: 'bg-brand-100 text-brand-700',
};

export function StatusBadge({ status, label }: { status: string; label: string }) {
  return <span className={`chip ${STATUS_TONE[status] ?? 'bg-black/5'}`}>{label}</span>;
}

export function ConfirmButton({ onConfirm, children, className, message }: { onConfirm: () => void; children: ReactNode; className?: string; message: string }) {
  return (
    <button type="button" className={className} onClick={() => window.confirm(message) && onConfirm()}>
      {children}
    </button>
  );
}
