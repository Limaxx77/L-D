export function formatBRL(cents: number): string {
  return 'R$ ' + formatAmount(cents);
}

/** Valor sem símbolo: 1234 -> "12,34" (usado nas mensagens "R$ [VALOR]"). */
export function formatAmount(cents: number): string {
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const int = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const dec = (abs % 100).toString().padStart(2, '0');
  return `${neg ? '-' : ''}${int},${dec}`;
}

/**
 * Divide `amount` centavos proporcionalmente aos pesos, de forma exata e determinística
 * (método do maior resto; empates resolvidos pela ordem das entradas).
 */
export function allocateByWeights<K>(amount: number, entries: { key: K; weight: number }[]): Map<K, number> {
  const result = new Map<K, number>();
  const valid = entries.filter((e) => e.weight > 0);
  if (valid.length === 0) return result;
  const totalWeight = valid.reduce((s, e) => s + e.weight, 0);
  let distributed = 0;
  const remainders: { idx: number; rem: number }[] = [];
  valid.forEach((e, idx) => {
    const raw = amount * e.weight;
    const base = Math.floor(raw / totalWeight);
    result.set(e.key, (result.get(e.key) ?? 0) + base);
    distributed += base;
    remainders.push({ idx, rem: raw % totalWeight });
  });
  let left = amount - distributed;
  remainders.sort((a, b) => b.rem - a.rem || a.idx - b.idx);
  for (let i = 0; left > 0; i = (i + 1) % remainders.length, left--) {
    const key = valid[remainders[i].idx].key;
    result.set(key, (result.get(key) ?? 0) + 1);
  }
  return result;
}

export function onlyDigits(v: string): string {
  return v.replace(/\D/g, '');
}

/** Normaliza telefone brasileiro para E.164 sem "+" (ex.: 5565992638816). */
export function normalizePhoneBR(v: string): string | null {
  let d = onlyDigits(v).replace(/^0+/, '');
  if (d.length === 10 || d.length === 11) d = '55' + d;
  if (!/^55\d{10,11}$/.test(d)) return null;
  return d;
}

export function formatPhoneBR(e164: string): string {
  const d = e164.startsWith('55') ? e164.slice(2) : e164;
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return e164;
}
