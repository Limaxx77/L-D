/**
 * Horário de funcionamento, calculado no fuso da loja (padrão America/Cuiaba).
 * Um intervalo com fechamento menor ou igual à abertura atravessa a meia-noite.
 */

export interface HourRange {
  weekday: number; // 0 = domingo
  opensAt: string; // HH:MM
  closesAt: string; // HH:MM ("24:00" permitido)
}

export interface OpenState {
  open: boolean;
  reason: 'OPEN' | 'CLOSED' | 'PAUSED';
  pausedUntil?: string | null;
}

export const WEEKDAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

export function toMinutes(hhmm: string): number {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) throw new Error(`Horário inválido: ${hhmm}`);
  const v = Number(m[1]) * 60 + Number(m[2]);
  if (v > 24 * 60 || Number(m[2]) > 59) throw new Error(`Horário inválido: ${hhmm}`);
  return v;
}

export function isValidHHMM(v: string): boolean {
  try {
    toMinutes(v);
    return true;
  } catch {
    return false;
  }
}

/** Dia da semana e minuto do dia no fuso informado. */
export function localClock(date: Date, timeZone: string): { weekday: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  return { weekday, minute: Number(get('hour')) * 60 + Number(get('minute')) };
}

export function isWithinHours(date: Date, ranges: HourRange[], timeZone: string): boolean {
  const { weekday, minute } = localClock(date, timeZone);
  const prev = (weekday + 6) % 7;
  for (const r of ranges) {
    const o = toMinutes(r.opensAt);
    const c = toMinutes(r.closesAt);
    if (c > o) {
      if (r.weekday === weekday && minute >= o && minute < c) return true;
    } else {
      // atravessa a meia-noite
      if (r.weekday === weekday && minute >= o) return true;
      if (r.weekday === prev && minute < c) return true;
    }
  }
  return false;
}

export function openState(
  date: Date,
  ranges: HourRange[],
  timeZone: string,
  pause: { paused: boolean; pausedUntil: string | null },
): OpenState {
  if (pause.paused && (!pause.pausedUntil || new Date(pause.pausedUntil) > date)) {
    return { open: false, reason: 'PAUSED', pausedUntil: pause.pausedUntil };
  }
  return isWithinHours(date, ranges, timeZone) ? { open: true, reason: 'OPEN' } : { open: false, reason: 'CLOSED' };
}

/** Início (UTC) do dia local que contém `date`, para filtros "hoje". */
export function startOfLocalDay(date: Date, timeZone: string): Date {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  const offsetMs = asUtc - Math.floor(date.getTime() / 1000) * 1000;
  const localMidnightUtc = Date.UTC(get('year'), get('month') - 1, get('day'));
  return new Date(localMidnightUtc - offsetMs);
}

/** "AAAA-MM-DD" do dia local. */
export function localDateKey(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}
