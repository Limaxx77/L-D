export interface MessageVars {
  NOME: string;
  NÚMERO: string | number;
  RESUMO?: string;
  VALOR?: string;
  TEMPO?: string | number;
  MOTIVO?: string;
  STATUS?: string;
  LINK?: string;
  WHATSAPP?: string;
}

/** Substitui marcadores como [NOME], [NÚMERO], [VALOR] (aceita também [NUMERO]). */
export function renderMessage(template: string, vars: MessageVars): string {
  const map: Record<string, string> = {};
  for (const [k, v] of Object.entries(vars)) if (v !== undefined && v !== null) map[k] = String(v);
  map['NUMERO'] = map['NÚMERO'];
  return template.replace(/\[([A-ZÚÇÃÉ]+)\]/g, (whole, key: string) => (key in map ? map[key] : whole));
}

export function whatsappLink(phone: string, text?: string): string {
  return `https://wa.me/${phone}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
}

export function itemsSummary(items: { quantity: number; name: string; canceledAt?: Date | null }[]): string {
  return items
    .filter((i) => !i.canceledAt)
    .map((i) => `${i.quantity}x ${i.name}`)
    .join(', ');
}

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}
