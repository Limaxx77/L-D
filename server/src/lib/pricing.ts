import { badRequest } from './errors';
import { formatAmount } from './money';

/**
 * Motor de preços. Todo valor cobrado é recalculado aqui a partir do catálogo vigente;
 * nenhum preço vindo do navegador é considerado.
 */

export type Kind = 'PASTEL' | 'DRINK' | 'OTHER';

export interface CatalogOption {
  id: string;
  label: string;
  priceCents: number | null;
  available: boolean;
}

export interface CatalogProduct {
  id: string;
  kind: Kind;
  name: string;
  priceCents: number;
  promoPriceCents: number | null;
  costCents: number | null;
  available: boolean;
  active: boolean;
  stockQty: number | null;
  options: CatalogOption[];
}

export interface CatalogCombo {
  id: string;
  name: string;
  priceCents: number;
  available: boolean;
  active: boolean;
  pastelQty: number;
  drinkQty: number;
}

export interface Catalog {
  products: Map<string, CatalogProduct>;
  combos: Map<string, CatalogCombo>;
}

export interface SelectionInput {
  productId: string;
  optionId?: string | null;
  quantity: number;
}

export type CartLineInput =
  | { type: 'product'; productId: string; optionId?: string | null; quantity: number; notes?: string | null }
  | {
      type: 'combo';
      comboId: string;
      quantity: number;
      pastels: SelectionInput[];
      drinks: SelectionInput[];
      notes?: string | null;
    };

export interface PricedSelection {
  productId: string;
  optionId: string | null;
  name: string;
  quantity: number;
}

export interface PricedLine {
  kind: 'PRODUCT' | 'COMBO';
  productId: string | null;
  optionId: string | null;
  comboId: string | null;
  name: string;
  description: string | null;
  selections: { pastels: PricedSelection[]; drinks: PricedSelection[] } | null;
  quantity: number;
  unitPriceCents: number;
  unitRegularCents: number;
  unitCostCents: number | null;
  totalCents: number;
  savingsCents: number;
  notes: string | null;
}

export interface PricedCart {
  lines: PricedLine[];
  grossCents: number;
  savingsCents: number;
  itemsTotalCents: number;
  /** Quantidade de cada combo no carrinho (para limite diário). */
  comboUsage: Map<string, number>;
  /** Unidades consumidas por produto (para baixa atômica de estoque). */
  stockUsage: Map<string, number>;
}

export const MAX_LINE_QTY = 50;

export function optionLabel(o: { brand?: string | null; flavor?: string | null; size?: string | null }): string {
  return [o.brand, o.flavor, o.size].filter(Boolean).join(' · ');
}

function productName(p: CatalogProduct, o: CatalogOption | null): string {
  return o && o.label ? `${p.name} (${o.label})` : p.name;
}

function resolveProduct(catalog: Catalog, productId: string, optionId: string | null | undefined, expectedKind?: Kind) {
  const p = catalog.products.get(productId);
  if (!p || !p.active) throw badRequest('PRODUCT_NOT_FOUND', 'Produto não encontrado no cardápio.');
  if (!p.available || (p.stockQty !== null && p.stockQty <= 0))
    throw badRequest('PRODUCT_UNAVAILABLE', `${p.name} está indisponível no momento.`);
  if (expectedKind && p.kind !== expectedKind)
    throw badRequest('INVALID_COMBO_SELECTION', `${p.name} não pode ser escolhido nesta parte do combo.`);
  let option: CatalogOption | null = null;
  if (optionId) {
    option = p.options.find((o) => o.id === optionId) ?? null;
    if (!option) throw badRequest('OPTION_NOT_FOUND', `Opção inválida para ${p.name}.`);
    if (!option.available) throw badRequest('OPTION_UNAVAILABLE', `${productName(p, option)} está indisponível.`);
  } else if (p.options.some((o) => o.available)) {
    throw badRequest('OPTION_REQUIRED', `Escolha uma opção para ${p.name}.`);
  }
  const regular = option?.priceCents ?? p.priceCents;
  const actual = option?.priceCents ?? p.promoPriceCents ?? p.priceCents;
  return { p, option, regular, actual };
}

function assertQty(q: number, max = MAX_LINE_QTY) {
  if (!Number.isInteger(q) || q < 1 || q > max) throw badRequest('INVALID_QUANTITY', 'Quantidade inválida.');
}

function addUsage(map: Map<string, number>, id: string, qty: number) {
  map.set(id, (map.get(id) ?? 0) + qty);
}

export function priceCart(catalog: Catalog, input: CartLineInput[]): PricedCart {
  if (input.length === 0) throw badRequest('EMPTY_CART', 'Seu carrinho está vazio.');
  if (input.length > 60) throw badRequest('CART_TOO_LARGE', 'Carrinho com itens demais.');
  const lines: PricedLine[] = [];
  const comboUsage = new Map<string, number>();
  const stockUsage = new Map<string, number>();

  for (const line of input) {
    assertQty(line.quantity);
    const notes = line.notes?.trim() ? line.notes.trim().slice(0, 300) : null;

    if (line.type === 'product') {
      const { p, option, regular, actual } = resolveProduct(catalog, line.productId, line.optionId);
      lines.push({
        kind: 'PRODUCT',
        productId: p.id,
        optionId: option?.id ?? null,
        comboId: null,
        name: productName(p, option),
        description: null,
        selections: null,
        quantity: line.quantity,
        unitPriceCents: actual,
        unitRegularCents: regular,
        unitCostCents: p.costCents,
        totalCents: actual * line.quantity,
        savingsCents: (regular - actual) * line.quantity,
        notes,
      });
      addUsage(stockUsage, p.id, line.quantity);
      continue;
    }

    const combo = catalog.combos.get(line.comboId);
    if (!combo || !combo.active) throw badRequest('COMBO_NOT_FOUND', 'Combo não encontrado.');
    if (!combo.available) throw badRequest('COMBO_UNAVAILABLE', `${combo.name} está indisponível no momento.`);
    if (line.quantity > 10) throw badRequest('INVALID_QUANTITY', 'Quantidade de combos inválida.');

    const sum = (s: SelectionInput[]) => s.reduce((acc, x) => acc + x.quantity, 0);
    for (const s of [...line.pastels, ...line.drinks]) assertQty(s.quantity, 100);
    if (sum(line.pastels) !== combo.pastelQty)
      throw badRequest('INVALID_COMBO_SELECTION', `Escolha exatamente ${combo.pastelQty} pastel(éis) para o ${combo.name}.`);
    if (sum(line.drinks) !== combo.drinkQty)
      throw badRequest(
        'INVALID_COMBO_SELECTION',
        `Escolha exatamente ${combo.drinkQty} refrigerante(s) para o ${combo.name}.`,
      );

    let regularUnit = 0;
    let costUnit: number | null = 0;
    const pick = (sel: SelectionInput[], kind: Kind): PricedSelection[] => {
      const merged = new Map<string, PricedSelection>();
      for (const s of sel) {
        const r = resolveProduct(catalog, s.productId, s.optionId, kind);
        regularUnit += r.regular * s.quantity;
        costUnit = costUnit === null || r.p.costCents === null ? null : costUnit + r.p.costCents * s.quantity;
        addUsage(stockUsage, r.p.id, s.quantity * line.quantity);
        const key = `${r.p.id}:${r.option?.id ?? ''}`;
        const prev = merged.get(key);
        if (prev) prev.quantity += s.quantity;
        else
          merged.set(key, {
            productId: r.p.id,
            optionId: r.option?.id ?? null,
            name: productName(r.p, r.option),
            quantity: s.quantity,
          });
      }
      return [...merged.values()];
    };
    const pastels = pick(line.pastels, 'PASTEL');
    const drinks = pick(line.drinks, 'DRINK');
    const savingsUnit = Math.max(0, regularUnit - combo.priceCents);
    const description = [...pastels, ...drinks].map((s) => `${s.quantity}x ${s.name}`).join(', ');

    lines.push({
      kind: 'COMBO',
      productId: null,
      optionId: null,
      comboId: combo.id,
      name: combo.name,
      description,
      selections: { pastels, drinks },
      quantity: line.quantity,
      unitPriceCents: combo.priceCents,
      unitRegularCents: combo.priceCents + savingsUnit,
      unitCostCents: costUnit,
      totalCents: combo.priceCents * line.quantity,
      savingsCents: savingsUnit * line.quantity,
      notes,
    });
    addUsage(comboUsage, combo.id, line.quantity);
  }

  for (const [id, q] of stockUsage) {
    const p = catalog.products.get(id)!;
    if (p.stockQty !== null && p.stockQty < q)
      throw badRequest('OUT_OF_STOCK', `Restam apenas ${p.stockQty} unidade(s) de ${p.name}.`);
  }

  const itemsTotalCents = lines.reduce((s, l) => s + l.totalCents, 0);
  const savingsCents = lines.reduce((s, l) => s + l.savingsCents, 0);
  return { lines, itemsTotalCents, savingsCents, grossCents: itemsTotalCents + savingsCents, comboUsage, stockUsage };
}

/** Economia de referência de um combo frente aos itens avulsos (exibida na vitrine). */
export function comboReferenceSavings(
  combo: { priceCents: number; pastelQty: number; drinkQty: number },
  pastelPrice: number,
  drinkPrice: number,
) {
  const regular = combo.pastelQty * pastelPrice + combo.drinkQty * drinkPrice;
  return { regularCents: regular, savingsCents: Math.max(0, regular - combo.priceCents) };
}

export interface CouponRule {
  id: string;
  code: string;
  type: 'PERCENT' | 'FIXED';
  value: number;
  validFrom: Date | null;
  validUntil: Date | null;
  maxUses: number | null;
  usedCount: number;
  minOrderCents: number | null;
  active: boolean;
}

export function couponDiscount(c: CouponRule, itemsTotalCents: number, now: Date): number {
  if (!c.active) throw badRequest('COUPON_INVALID', 'Cupom inválido ou desativado.');
  if (c.validFrom && now < c.validFrom) throw badRequest('COUPON_NOT_STARTED', 'Este cupom ainda não está válido.');
  if (c.validUntil && now > c.validUntil) throw badRequest('COUPON_EXPIRED', 'Este cupom expirou.');
  if (c.maxUses !== null && c.usedCount >= c.maxUses)
    throw badRequest('COUPON_EXHAUSTED', 'Este cupom atingiu o limite de usos.');
  if (c.minOrderCents !== null && itemsTotalCents < c.minOrderCents)
    throw badRequest('COUPON_MIN_ORDER', `Este cupom exige pedido mínimo de R$ ${formatAmount(c.minOrderCents)}.`);
  const raw = c.type === 'PERCENT' ? Math.round((itemsTotalCents * Math.min(100, c.value)) / 100) : c.value;
  return Math.max(0, Math.min(raw, itemsTotalCents));
}

export interface DeliveryConfig {
  enabled: boolean;
  minOrderCents: number | null;
  freeDeliveryAboveCents: number | null;
  allowOutsideArea: boolean;
  outsideAreaFeeCents: number | null;
}

export function deliveryFee(
  cfg: DeliveryConfig,
  area: { feeCents: number; minOrderCents: number | null; active: boolean } | null,
  itemsAfterDiscount: number,
): number {
  if (!cfg.enabled) throw badRequest('DELIVERY_DISABLED', 'O delivery está desativado no momento.');
  let fee: number;
  let min = cfg.minOrderCents;
  if (area && area.active) {
    fee = area.feeCents;
    if (area.minOrderCents !== null) min = Math.max(min ?? 0, area.minOrderCents);
  } else {
    if (!cfg.allowOutsideArea || cfg.outsideAreaFeeCents === null)
      throw badRequest('OUTSIDE_DELIVERY_AREA', 'Infelizmente ainda não entregamos neste bairro.');
    fee = cfg.outsideAreaFeeCents;
  }
  if (min !== null && itemsAfterDiscount < min)
    throw badRequest('MIN_ORDER', `O pedido mínimo para entrega é de R$ ${formatAmount(min)}.`);
  if (cfg.freeDeliveryAboveCents !== null && itemsAfterDiscount >= cfg.freeDeliveryAboveCents) return 0;
  return fee;
}
