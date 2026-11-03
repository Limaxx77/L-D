import { describe, expect, it } from 'vitest';
import { couponDiscount, deliveryFee, priceCart, type Catalog, type CatalogProduct } from '../src/lib/pricing';

function product(id: string, kind: CatalogProduct['kind'], price: number, extra: Partial<CatalogProduct> = {}): CatalogProduct {
  return { id, kind, name: id, priceCents: price, promoPriceCents: null, costCents: null, available: true, active: true, stockQty: null, options: [], ...extra };
}

function catalog(): Catalog {
  const products = [
    product('pizza', 'PASTEL', 800),
    product('frango', 'PASTEL', 800),
    product('carne', 'PASTEL', 800),
    product('refri', 'DRINK', 600, {
      options: [
        { id: 'coca', label: 'Coca-Cola', priceCents: null, available: true },
        { id: 'guarana', label: 'Guaraná', priceCents: null, available: true },
        { id: 'fanta', label: 'Fanta', priceCents: null, available: false },
      ],
    }),
  ];
  const combos = [
    { id: 'individual', name: 'Combo Individual', priceCents: 1300, pastelQty: 1, drinkQty: 1 },
    { id: 'galera', name: 'Combo Galera', priceCents: 6500, pastelQty: 10, drinkQty: 0 },
    { id: 'galera-completo', name: 'Combo Galera Completo', priceCents: 8500, pastelQty: 10, drinkQty: 4 },
    { id: 'super', name: 'Combo Super Família', priceCents: 15500, pastelQty: 20, drinkQty: 6 },
  ];
  return {
    products: new Map(products.map((p) => [p.id, p])),
    combos: new Map(combos.map((c) => [c.id, { ...c, available: true, active: true }])),
  };
}

describe('priceCart', () => {
  it('soma produtos avulsos com sabores misturados', () => {
    const r = priceCart(catalog(), [
      { type: 'product', productId: 'carne', quantity: 2 },
      { type: 'product', productId: 'pizza', quantity: 1 },
      { type: 'product', productId: 'refri', optionId: 'coca', quantity: 2 },
    ]);
    expect(r.itemsTotalCents).toBe(16_00 + 8_00 + 12_00);
    expect(r.savingsCents).toBe(0);
  });

  it('calcula preço fixo do combo e a economia sem aplicar desconto de novo', () => {
    const r = priceCart(catalog(), [
      {
        type: 'combo',
        comboId: 'galera',
        quantity: 1,
        pastels: [
          { productId: 'carne', quantity: 4 },
          { productId: 'frango', quantity: 3 },
          { productId: 'pizza', quantity: 3 },
        ],
        drinks: [],
      },
    ]);
    expect(r.itemsTotalCents).toBe(65_00);
    expect(r.savingsCents).toBe(80_00 - 65_00);
    expect(r.grossCents).toBe(80_00);
    expect(r.lines[0].description).toContain('4x carne');
  });

  it('cenário A: Combo Galera + 2 refrigerantes avulsos', () => {
    const r = priceCart(catalog(), [
      { type: 'combo', comboId: 'galera', quantity: 1, pastels: [{ productId: 'carne', quantity: 10 }], drinks: [] },
      { type: 'product', productId: 'refri', optionId: 'guarana', quantity: 2 },
    ]);
    expect(r.itemsTotalCents).toBe(65_00 + 12_00);
  });

  it('economia de todos os combos frente aos itens avulsos', () => {
    const c = catalog();
    const sel = (n: number) => [{ productId: 'pizza', quantity: n }];
    const drinks = (n: number) => (n ? [{ productId: 'refri', optionId: 'coca', quantity: n }] : []);
    const ind = priceCart(c, [{ type: 'combo', comboId: 'individual', quantity: 1, pastels: sel(1), drinks: drinks(1) }]);
    expect(ind.savingsCents).toBe(14_00 - 13_00);
    const sup = priceCart(c, [{ type: 'combo', comboId: 'super', quantity: 1, pastels: sel(20), drinks: drinks(6) }]);
    expect(sup.savingsCents).toBe(20 * 8_00 + 6 * 6_00 - 155_00);
    const gc = priceCart(c, [{ type: 'combo', comboId: 'galera-completo', quantity: 2, pastels: sel(10), drinks: drinks(4) }]);
    expect(gc.itemsTotalCents).toBe(2 * 85_00);
    expect(gc.stockUsage.get('pizza')).toBe(20);
  });

  it('exige a quantidade exata de pastéis e refrigerantes do combo', () => {
    expect(() =>
      priceCart(catalog(), [{ type: 'combo', comboId: 'galera', quantity: 1, pastels: [{ productId: 'carne', quantity: 9 }], drinks: [] }]),
    ).toThrow(/exatamente 10/);
    expect(() =>
      priceCart(catalog(), [{ type: 'combo', comboId: 'individual', quantity: 1, pastels: [{ productId: 'carne', quantity: 1 }], drinks: [] }]),
    ).toThrow(/refrigerante/);
  });

  it('não aceita bebida no lugar de pastel', () => {
    expect(() =>
      priceCart(catalog(), [{ type: 'combo', comboId: 'galera', quantity: 1, pastels: [{ productId: 'refri', optionId: 'coca', quantity: 10 }], drinks: [] }]),
    ).toThrow(/não pode ser escolhido/);
  });

  it('bloqueia produtos e opções indisponíveis', () => {
    const c = catalog();
    c.products.get('frango')!.available = false;
    expect(() => priceCart(c, [{ type: 'product', productId: 'frango', quantity: 1 }])).toThrow(/indisponível/);
    expect(() => priceCart(c, [{ type: 'product', productId: 'refri', optionId: 'fanta', quantity: 1 }])).toThrow(/indisponível/);
    expect(() => priceCart(c, [{ type: 'product', productId: 'refri', quantity: 1 }])).toThrow(/Escolha uma opção/);
  });

  it('respeita estoque somando avulsos e combos', () => {
    const c = catalog();
    c.products.get('carne')!.stockQty = 5;
    expect(() =>
      priceCart(c, [
        { type: 'product', productId: 'carne', quantity: 2 },
        { type: 'combo', comboId: 'individual', quantity: 4, pastels: [{ productId: 'carne', quantity: 1 }], drinks: [{ productId: 'refri', optionId: 'coca', quantity: 1 }] },
      ]),
    ).toThrow(/Restam apenas 5/);
  });

  it('usa preço promocional e registra a economia', () => {
    const c = catalog();
    c.products.get('pizza')!.promoPriceCents = 700;
    const r = priceCart(c, [{ type: 'product', productId: 'pizza', quantity: 3 }]);
    expect(r.itemsTotalCents).toBe(21_00);
    expect(r.savingsCents).toBe(3_00);
  });

  it('rejeita quantidades inválidas', () => {
    expect(() => priceCart(catalog(), [{ type: 'product', productId: 'pizza', quantity: 0 }])).toThrow();
    expect(() => priceCart(catalog(), [{ type: 'product', productId: 'pizza', quantity: 1.5 }])).toThrow();
    expect(() => priceCart(catalog(), [])).toThrow(/vazio/);
  });
});

describe('cupons e taxa de entrega', () => {
  const base = { id: 'c', code: 'X', validFrom: null, validUntil: null, maxUses: null, usedCount: 0, minOrderCents: null, active: true };
  it('percentual e fixo, nunca acima do total', () => {
    expect(couponDiscount({ ...base, type: 'PERCENT', value: 10 }, 65_00, new Date())).toBe(6_50);
    expect(couponDiscount({ ...base, type: 'FIXED', value: 100_00 }, 65_00, new Date())).toBe(65_00);
  });
  it('validade, limite e mínimo', () => {
    const now = new Date('2026-11-02T12:00:00Z');
    expect(() => couponDiscount({ ...base, type: 'FIXED', value: 1, validUntil: new Date('2026-11-01') }, 100, now)).toThrow(/expirou/);
    expect(() => couponDiscount({ ...base, type: 'FIXED', value: 1, maxUses: 3, usedCount: 3 }, 100, now)).toThrow(/limite/);
    expect(() => couponDiscount({ ...base, type: 'FIXED', value: 1, minOrderCents: 50_00 }, 49_99, now)).toThrow(/mínimo/);
  });
  const cfg = { enabled: true, minOrderCents: 20_00, freeDeliveryAboveCents: 100_00, allowOutsideArea: false, outsideAreaFeeCents: null };
  it('taxa por bairro, mínimo e frete grátis', () => {
    expect(deliveryFee(cfg, { feeCents: 5_00, minOrderCents: null, active: true }, 50_00)).toBe(5_00);
    expect(deliveryFee(cfg, { feeCents: 5_00, minOrderCents: null, active: true }, 100_00)).toBe(0);
    expect(() => deliveryFee(cfg, { feeCents: 5_00, minOrderCents: null, active: true }, 19_99)).toThrow(/mínimo/);
    expect(() => deliveryFee(cfg, null, 50_00)).toThrow(/não entregamos/);
    expect(deliveryFee({ ...cfg, allowOutsideArea: true, outsideAreaFeeCents: 12_00 }, null, 50_00)).toBe(12_00);
    expect(() => deliveryFee({ ...cfg, enabled: false }, null, 50_00)).toThrow(/desativado/);
  });
});
