export function brl(cents: number | null | undefined): string {
  return ((cents ?? 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/** "12,50" -> 1250 */
export function parseBRL(v: string): number | null {
  const clean = v.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.');
  if (!clean) return null;
  const n = Math.round(parseFloat(clean) * 100);
  return Number.isFinite(n) ? n : null;
}

export function centsToInput(cents: number | null | undefined): string {
  return cents == null ? '' : (cents / 100).toFixed(2).replace('.', ',');
}

export function formatPhone(v: string | null | undefined): string {
  if (!v) return '';
  const d = v.replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return v;
}

export function maskPhoneInput(v: string): string {
  const d = v.replace(/\D/g, '').slice(0, 11);
  if (d.length <= 2) return d.length ? `(${d}` : '';
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

export function dateTime(v: string | Date | null | undefined): string {
  if (!v) return '';
  return new Date(v).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

export function time(v: string | Date | null | undefined): string {
  if (!v) return '';
  return new Date(v).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

export function minutesSince(v: string | Date): number {
  return Math.max(0, Math.floor((Date.now() - new Date(v).getTime()) / 60000));
}

export function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

export const PAYMENT_LABELS: Record<string, string> = {
  PIX: 'PIX',
  CASH: 'Dinheiro',
  DEBIT: 'Cartão de débito',
  CREDIT: 'Cartão de crédito',
  IN_PERSON: 'Pagamento presencial',
};

export const TYPE_LABELS: Record<string, string> = { DELIVERY: 'Delivery', PICKUP: 'Retirada', TABLE: 'Mesa' };

export const WEEKDAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

export function todayISO(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
