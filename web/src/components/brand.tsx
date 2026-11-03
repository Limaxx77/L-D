import { MessageCircle } from 'lucide-react';
import { useStore } from '../lib/context';
import { WEEKDAYS } from '../lib/format';
import type { HourRange } from '../lib/types';

// Número de teste. O oficial da loja (5565992638816) será ativado depois em Configurações → Loja.
export const OFFICIAL_WHATSAPP = '5587981076022';

/** Logo Pastel L&D. Pode ser substituída em Configurações → Loja (logoUrl). */
export function Logo({ size = 44, withText = true, light = false }: { size?: number; withText?: boolean; light?: boolean }) {
  const { info } = useStore();
  const src = info?.store.logoUrl || '/images/logo.webp';
  return (
    <span className="inline-flex items-center gap-2">
      <img src={src} alt="Pastel L&D" width={size} height={size} style={{ width: size, height: size }} className="shrink-0 rounded-full object-cover shadow-md" />
      {withText && (
        <span className={`font-display text-2xl font-extrabold leading-none tracking-tight ${light ? 'text-white' : 'text-ink-900'}`}>
          Pastel <span className="text-brand-600">L&amp;D</span>
        </span>
      )}
    </span>
  );
}

export function whatsappHref(phone: string, text?: string) {
  return `https://wa.me/${phone}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
}

export function WhatsAppButton({ text, className = 'btn bg-[#25D366] text-white hover:bg-[#1ebe5b]', label = 'Falar no WhatsApp' }: { text?: string; className?: string; label?: string }) {
  const { info } = useStore();
  const phone = info?.store.whatsapp || OFFICIAL_WHATSAPP;
  return (
    <a href={whatsappHref(phone, text)} target="_blank" rel="noopener noreferrer" className={className}>
      <MessageCircle size={20} /> {label}
    </a>
  );
}

export function HoursTable({ hours }: { hours: HourRange[] }) {
  return (
    <ul className="space-y-1 text-sm">
      {WEEKDAYS.map((d, i) => {
        const r = hours.filter((h) => h.weekday === i);
        return (
          <li key={d} className="flex justify-between gap-4">
            <span className="font-medium">{d}</span>
            <span className={r.length ? '' : 'text-black/40'}>{r.length ? r.map((x) => `${x.opensAt}–${x.closesAt}`).join(' · ') : 'Fechado'}</span>
          </li>
        );
      })}
    </ul>
  );
}

export function OpenBadge() {
  const { info } = useStore();
  if (!info) return null;
  const open = info.open.open;
  return (
    <span className={`chip ${open ? 'bg-green-100 text-green-800' : 'bg-brand-100 text-brand-700'}`}>
      <span className={`h-2 w-2 rounded-full ${open ? 'bg-green-600' : 'bg-brand-600'}`} />
      {open ? 'Aberto agora' : info.open.reason === 'PAUSED' ? 'Pausado' : 'Fechado'}
    </span>
  );
}
