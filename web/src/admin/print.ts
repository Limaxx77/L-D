import { brl, dateTime, formatPhone, PAYMENT_LABELS, TYPE_LABELS } from '../lib/format';

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Abre a janela de impressão em formato de cupom (impressora térmica 58/80 mm). */
export function printThermal(title: string, bodyHtml: string) {
  const w = window.open('', '_blank', 'width=420,height=700');
  if (!w) return alert('Permita pop-ups para imprimir.');
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
  @page { margin: 3mm; size: 80mm auto; }
  body { font-family: ui-monospace, 'Courier New', monospace; font-size: 12px; width: 72mm; margin: 0 auto; color: #000; }
  h1 { font-size: 16px; text-align: center; margin: 4px 0; }
  .c { text-align: center; } .b { font-weight: bold; } .big { font-size: 15px; }
  hr { border: 0; border-top: 1px dashed #000; margin: 6px 0; }
  .row { display: flex; justify-content: space-between; gap: 6px; }
  .muted { font-size: 11px; }
</style></head><body>${bodyHtml}<script>window.onload=()=>{window.print();setTimeout(()=>window.close(),300)}</script></body></html>`);
  w.document.close();
}

export interface PrintableOrder {
  number: number;
  type: string;
  createdAt: string;
  customerName: string;
  customerPhone: string | null;
  addressStreet: string | null;
  addressNumber: string | null;
  addressDistrict: string | null;
  addressComplement: string | null;
  addressReference: string | null;
  items: { name: string; description: string | null; quantity: number; totalCents: number; notes: string | null; canceledAt: string | null }[];
  grossCents: number;
  comboSavingsCents: number;
  discountCents: number;
  deliveryFeeCents: number;
  totalCents: number;
  paymentMethod: string;
  paymentStatus: string;
  changeForCents: number | null;
  notes: string | null;
  estimatedMinutes: number | null;
  table?: { name: string } | null;
}

export function printOrder(o: PrintableOrder, storeName = 'Pastel L&D') {
  const items = o.items
    .filter((i) => !i.canceledAt)
    .map(
      (i) => `<div class="row b"><span>${i.quantity}x ${esc(i.name)}</span><span>${brl(i.totalCents)}</span></div>
      ${i.description ? `<div class="muted">${esc(i.description)}</div>` : ''}
      ${i.notes ? `<div class="muted">OBS: ${esc(i.notes)}</div>` : ''}`,
    )
    .join('');
  printThermal(
    `Pedido ${o.number}`,
    `<h1>${esc(storeName)}</h1>
    <div class="c big b">PEDIDO #${o.number}</div>
    <div class="c">${esc(TYPE_LABELS[o.type])}${o.table ? ' — ' + esc(o.table.name) : ''} · ${esc(dateTime(o.createdAt))}</div>
    <hr/>
    <div class="b">${esc(o.customerName)}</div>
    ${o.customerPhone ? `<div>${esc(formatPhone(o.customerPhone))}</div>` : ''}
    ${o.type === 'DELIVERY' ? `<div>${esc(o.addressStreet)}, ${esc(o.addressNumber)} — ${esc(o.addressDistrict)}</div>${o.addressComplement ? `<div>${esc(o.addressComplement)}</div>` : ''}${o.addressReference ? `<div class="muted">Ref.: ${esc(o.addressReference)}</div>` : ''}` : ''}
    <hr/>${items}<hr/>
    <div class="row"><span>Subtotal</span><span>${brl(o.grossCents)}</span></div>
    ${o.comboSavingsCents ? `<div class="row"><span>Desc. combos</span><span>-${brl(o.comboSavingsCents)}</span></div>` : ''}
    ${o.discountCents ? `<div class="row"><span>Cupom</span><span>-${brl(o.discountCents)}</span></div>` : ''}
    ${o.type === 'DELIVERY' ? `<div class="row"><span>Entrega</span><span>${brl(o.deliveryFeeCents)}</span></div>` : ''}
    <div class="row big b"><span>TOTAL</span><span>${brl(o.totalCents)}</span></div>
    <div>Pagamento: ${esc(PAYMENT_LABELS[o.paymentMethod])} ${o.paymentStatus === 'PAID' ? '(PAGO)' : '(A RECEBER)'}</div>
    ${o.changeForCents ? `<div class="b">Troco para ${brl(o.changeForCents)} (levar ${brl(o.changeForCents - o.totalCents)})</div>` : ''}
    ${o.notes ? `<hr/><div>OBS: ${esc(o.notes)}</div>` : ''}
    ${o.estimatedMinutes ? `<div class="muted">Prazo: ${o.estimatedMinutes} min</div>` : ''}
    <hr/><div class="c muted">Obrigado pela preferência!</div>`,
  );
}
