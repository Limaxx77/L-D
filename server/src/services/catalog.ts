import { Prisma } from '@prisma/client';
import { prisma, type Tx } from '../db';
import { comboReferenceSavings, optionLabel, type Catalog, type CatalogProduct } from '../lib/pricing';
import { getSettings } from '../lib/settings';
import { openState, type HourRange } from '../lib/hours';
import { publicImageUrl } from '../lib/storage';

const productInclude = {
  options: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] },
  images: { where: { isPrimary: true }, take: 1, orderBy: { createdAt: 'desc' } },
} satisfies Prisma.ProductInclude;

const comboInclude = {
  items: true,
  images: { where: { isPrimary: true }, take: 1, orderBy: { createdAt: 'desc' } },
} satisfies Prisma.ComboInclude;

type ProductRow = Prisma.ProductGetPayload<{ include: typeof productInclude }>;
type ComboRow = Prisma.ComboGetPayload<{ include: typeof comboInclude }>;

export function comboQty(c: { items: { slot: string; quantity: number }[] }) {
  return {
    pastelQty: c.items.find((i) => i.slot === 'PASTEL')?.quantity ?? 0,
    drinkQty: c.items.find((i) => i.slot === 'DRINK')?.quantity ?? 0,
  };
}

/** Carrega o catálogo vigente. Combos informados são bloqueados (FOR UPDATE) para o limite diário. */
export async function loadCatalog(tx: Tx, lockComboIds: string[] = []): Promise<Catalog> {
  if (lockComboIds.length) {
    await tx.$queryRaw`SELECT id FROM combos WHERE id IN (${Prisma.join(lockComboIds)}) ORDER BY id FOR UPDATE`;
  }
  const [products, combos] = await Promise.all([
    tx.product.findMany({ where: { deletedAt: null }, include: { options: true } }),
    tx.combo.findMany({ where: { deletedAt: null }, include: { items: true } }),
  ]);
  const catalog: Catalog = { products: new Map(), combos: new Map() };
  for (const p of products) {
    catalog.products.set(p.id, {
      id: p.id,
      kind: p.kind,
      name: p.name,
      priceCents: p.priceCents,
      promoPriceCents: p.promoPriceCents,
      costCents: p.costCents,
      available: p.available,
      active: p.active,
      stockQty: p.stockQty,
      options: p.options.map((o) => ({ id: o.id, label: optionLabel(o), priceCents: o.priceCents, available: o.available })),
    } satisfies CatalogProduct);
  }
  for (const c of combos) {
    catalog.combos.set(c.id, {
      id: c.id,
      name: c.name,
      priceCents: c.priceCents,
      available: c.available,
      active: c.active,
      ...comboQty(c),
    });
  }
  return catalog;
}

export function serializeProduct(p: ProductRow) {
  const inStock = p.stockQty === null || p.stockQty > 0;
  return {
    id: p.id,
    kind: p.kind,
    categoryId: p.categoryId,
    name: p.name,
    description: p.description,
    priceCents: p.priceCents,
    promoPriceCents: p.promoPriceCents,
    available: p.available && p.active && inStock,
    stockQty: p.stockQty,
    imageUrl: publicImageUrl(p.images[0]?.url),
    options: p.options.map((o) => ({
      id: o.id,
      label: optionLabel(o),
      brand: o.brand,
      flavor: o.flavor,
      size: o.size,
      priceCents: o.priceCents,
      available: o.available,
    })),
  };
}

export function serializeCombo(c: ComboRow, refPastel: number, refDrink: number, soldToday?: number) {
  const q = comboQty(c);
  const ref = comboReferenceSavings({ priceCents: c.priceCents, ...q }, refPastel, refDrink);
  const remainingToday = c.dailyLimit !== null && soldToday !== undefined ? Math.max(0, c.dailyLimit - soldToday) : null;
  return {
    id: c.id,
    name: c.name,
    description: c.description,
    priceCents: c.priceCents,
    ...q,
    featured: c.featured,
    available: c.available && c.active && remainingToday !== 0,
    dailyLimit: c.dailyLimit,
    remainingToday,
    imageUrl: publicImageUrl(c.images[0]?.url),
    regularCents: ref.regularCents,
    savingsCents: ref.savingsCents,
  };
}

/** Preço de referência (avulso) de pastel e refrigerante para calcular a economia dos combos na vitrine. */
function referencePrices(products: ProductRow[]) {
  const price = (p: ProductRow) => p.promoPriceCents ?? p.priceCents;
  const pastels = products.filter((p) => p.kind === 'PASTEL').map(price);
  const drinks = products.filter((p) => p.kind === 'DRINK').flatMap((p) =>
    p.options.length ? p.options.map((o) => o.priceCents ?? price(p)) : [price(p)],
  );
  return { pastel: pastels.length ? Math.min(...pastels) : 0, drink: drinks.length ? Math.min(...drinks) : 0 };
}

export async function comboSoldToday(tx: Tx, comboIds: string[], since: Date): Promise<Map<string, number>> {
  if (!comboIds.length) return new Map();
  const rows = await tx.orderItem.groupBy({
    by: ['comboId'],
    where: { comboId: { in: comboIds }, canceledAt: null, order: { createdAt: { gte: since }, status: { not: 'CANCELED' } } },
    _sum: { quantity: true },
  });
  return new Map(rows.map((r) => [r.comboId!, r._sum.quantity ?? 0]));
}

export async function publicMenu(since: Date) {
  const [categories, products, combos] = await Promise.all([
    prisma.category.findMany({ where: { active: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
    prisma.product.findMany({
      where: { deletedAt: null, active: true, category: { active: true } },
      include: productInclude,
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    }),
    prisma.combo.findMany({
      where: { deletedAt: null, active: true },
      include: comboInclude,
      orderBy: [{ sortOrder: 'asc' }, { priceCents: 'asc' }],
    }),
  ]);
  const ref = referencePrices(products);
  const limited = combos.filter((c) => c.dailyLimit !== null).map((c) => c.id);
  const sold = await comboSoldToday(prisma, limited, since);
  return {
    categories: categories.map((c) => ({ id: c.id, name: c.name, slug: c.slug })),
    products: products.map(serializeProduct),
    combos: combos.map((c) => serializeCombo(c, ref.pastel, ref.drink, c.dailyLimit !== null ? sold.get(c.id) ?? 0 : undefined)),
  };
}

export async function storeStatus(now = new Date()) {
  const settings = await getSettings();
  const hours = await prisma.businessHour.findMany({ orderBy: [{ weekday: 'asc' }, { opensAt: 'asc' }] });
  const ranges: HourRange[] = hours.map((h) => ({ weekday: h.weekday, opensAt: h.opensAt, closesAt: h.closesAt }));
  const state = openState(now, ranges, settings.store.timezone, settings.hours);
  return { settings, ranges, state };
}

export { productInclude, comboInclude };
