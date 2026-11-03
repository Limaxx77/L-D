import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { prisma, withTx } from '../../db';
import { badRequest, notFound } from '../../lib/errors';
import { audit } from '../../lib/audit';
import { requirePerm, staffActor } from '../../middleware/auth';
import { MAX_UPLOAD_BYTES, deleteStoredImage, storeImage } from '../../lib/storage';
import { comboInclude, productInclude, serializeCombo, serializeProduct } from '../../services/catalog';
import { cents, text } from '../schemas';
import { realtime } from '../../realtime';

export const adminCatalogRouter = Router();
adminCatalogRouter.use(requirePerm('catalog.manage'));

export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) return cb(badRequest('INVALID_IMAGE', 'Envie um arquivo de imagem.'));
    cb(null, true);
  },
});

const menuChanged = () => realtime.staff('menu:changed', {});

// ---------------------------- Categorias ----------------------------

const categorySchema = z.object({
  name: text(60).min(2),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9-]{2,60}$/, 'Use letras minúsculas, números e hífen'),
  sortOrder: z.number().int().min(0).max(9999).default(0),
  active: z.boolean().default(true),
});

adminCatalogRouter.get('/categories', async (_req, res) => {
  res.json(await prisma.category.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }], include: { _count: { select: { products: { where: { deletedAt: null } } } } } }));
});

adminCatalogRouter.post('/categories', async (req, res) => {
  const c = await prisma.category.create({ data: categorySchema.parse(req.body) });
  await audit(staffActor(req), 'category.create', 'category', c.id, { name: c.name });
  menuChanged();
  res.status(201).json(c);
});

adminCatalogRouter.put('/categories/:id', async (req, res) => {
  const c = await prisma.category.update({ where: { id: String(req.params.id) }, data: categorySchema.parse(req.body) });
  await audit(staffActor(req), 'category.update', 'category', c.id);
  menuChanged();
  res.json(c);
});

adminCatalogRouter.delete('/categories/:id', async (req, res) => {
  const id = String(req.params.id);
  const inUse = await prisma.product.count({ where: { categoryId: id, deletedAt: null } });
  if (inUse) throw badRequest('CATEGORY_IN_USE', 'Mova ou exclua os produtos desta categoria antes.');
  const hasHistory = await prisma.product.count({ where: { categoryId: id } });
  if (hasHistory) await prisma.category.update({ where: { id }, data: { active: false } });
  else await prisma.category.delete({ where: { id } });
  await audit(staffActor(req), 'category.delete', 'category', id);
  menuChanged();
  res.json({ ok: true });
});

// ----------------------------- Produtos -----------------------------

const optionSchema = z.object({
  id: z.string().max(40).optional(),
  brand: text(40).nullish(),
  flavor: text(40).nullish(),
  size: text(30).nullish(),
  priceCents: cents.nullish(),
  available: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(9999).default(0),
});

const productSchema = z
  .object({
    categoryId: z.string().max(40),
    kind: z.enum(['PASTEL', 'DRINK', 'OTHER']),
    name: text(80).min(2),
    description: text(500).default(''),
    priceCents: cents,
    promoPriceCents: cents.nullish(),
    costCents: cents.nullish(),
    available: z.boolean().default(true),
    stockQty: z.number().int().min(0).max(100000).nullish(),
    sortOrder: z.number().int().min(0).max(9999).default(0),
    active: z.boolean().default(true),
    options: z.array(optionSchema).max(50).default([]),
  })
  .refine((p) => p.promoPriceCents == null || p.promoPriceCents < p.priceCents, {
    message: 'O preço promocional deve ser menor que o preço normal',
    path: ['promoPriceCents'],
  });

adminCatalogRouter.get('/products', async (_req, res) => {
  const products = await prisma.product.findMany({
    where: { deletedAt: null },
    include: { ...productInclude, category: { select: { id: true, name: true } } },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  });
  res.json(products.map((p) => ({ ...serializeProduct(p), active: p.active, rawAvailable: p.available, costCents: p.costCents, sortOrder: p.sortOrder, category: p.category })));
});

async function saveOptions(tx: Parameters<Parameters<typeof withTx>[0]>[0], productId: string, options: z.infer<typeof optionSchema>[]) {
  const keep = options.filter((o) => o.id).map((o) => o.id!);
  // Pedidos antigos guardam o nome da opção; a referência é anulada (onDelete: SetNull).
  await tx.productOption.deleteMany({ where: { productId, id: { notIn: keep } } });
  for (const o of options) {
    const data = { brand: o.brand ?? null, flavor: o.flavor ?? null, size: o.size ?? null, priceCents: o.priceCents ?? null, available: o.available, sortOrder: o.sortOrder };
    if (o.id) await tx.productOption.updateMany({ where: { id: o.id, productId }, data });
    else await tx.productOption.create({ data: { ...data, productId } });
  }
}

adminCatalogRouter.post('/products', async (req, res) => {
  const { options, ...data } = productSchema.parse(req.body);
  const p = await withTx(async (tx) => {
    const created = await tx.product.create({ data: { ...data, promoPriceCents: data.promoPriceCents ?? null, costCents: data.costCents ?? null, stockQty: data.stockQty ?? null } });
    await saveOptions(tx, created.id, options);
    await audit(staffActor(req), 'product.create', 'product', created.id, { name: created.name, priceCents: created.priceCents }, tx);
    return created;
  });
  menuChanged();
  res.status(201).json(serializeProduct(await prisma.product.findUniqueOrThrow({ where: { id: p.id }, include: productInclude })));
});

adminCatalogRouter.put('/products/:id', async (req, res) => {
  const id = String(req.params.id);
  const { options, ...data } = productSchema.parse(req.body);
  const before = await prisma.product.findFirst({ where: { id, deletedAt: null } });
  if (!before) throw notFound();
  await withTx(async (tx) => {
    await tx.product.update({ where: { id }, data: { ...data, promoPriceCents: data.promoPriceCents ?? null, costCents: data.costCents ?? null, stockQty: data.stockQty ?? null } });
    await saveOptions(tx, id, options);
    await audit(staffActor(req), 'product.update', 'product', id, {
      priceBefore: before.priceCents,
      priceAfter: data.priceCents,
      promoBefore: before.promoPriceCents,
      promoAfter: data.promoPriceCents ?? null,
    }, tx);
  });
  menuChanged();
  res.json(serializeProduct(await prisma.product.findUniqueOrThrow({ where: { id }, include: productInclude })));
});

/** Disponibilidade rápida (liga/desliga sem abrir o formulário). */
adminCatalogRouter.patch('/products/:id/availability', async (req, res) => {
  const { available } = z.object({ available: z.boolean() }).parse(req.body);
  const p = await prisma.product.update({ where: { id: String(req.params.id) }, data: { available } });
  await audit(staffActor(req), 'product.availability', 'product', p.id, { available });
  menuChanged();
  res.json({ ok: true });
});

/** Exclusão lógica: o histórico de pedidos continua referenciando o produto. */
adminCatalogRouter.delete('/products/:id', async (req, res) => {
  const p = await prisma.product.update({ where: { id: String(req.params.id) }, data: { deletedAt: new Date(), active: false } });
  await audit(staffActor(req), 'product.delete', 'product', p.id, { name: p.name });
  menuChanged();
  res.json({ ok: true });
});

adminCatalogRouter.post('/products/:id/image', upload.single('image'), async (req, res) => {
  const id = String(req.params.id);
  if (!req.file) throw badRequest('NO_FILE', 'Selecione uma imagem.');
  const product = await prisma.product.findFirst({ where: { id, deletedAt: null } });
  if (!product) throw notFound();
  const stored = await storeImage(req.file.buffer, 'products');
  const old = await prisma.productImage.findMany({ where: { productId: id } });
  await prisma.$transaction([
    prisma.productImage.deleteMany({ where: { productId: id } }),
    prisma.productImage.create({ data: { productId: id, storageKey: stored.key, url: stored.url, mimeType: stored.mimeType, sizeBytes: stored.sizeBytes, width: stored.width, height: stored.height } }),
  ]);
  for (const o of old) await deleteStoredImage(o.storageKey);
  await audit(staffActor(req), 'product.image', 'product', id, { key: stored.key });
  menuChanged();
  res.json({ url: stored.url });
});

adminCatalogRouter.delete('/products/:id/image', async (req, res) => {
  const id = String(req.params.id);
  const old = await prisma.productImage.findMany({ where: { productId: id } });
  await prisma.productImage.deleteMany({ where: { productId: id } });
  for (const o of old) await deleteStoredImage(o.storageKey);
  await audit(staffActor(req), 'product.imageDelete', 'product', id);
  menuChanged();
  res.json({ ok: true });
});

// ------------------------------ Combos ------------------------------

const comboSchema = z.object({
  name: text(80).min(2),
  description: text(500).default(''),
  priceCents: cents,
  pastelQty: z.number().int().min(0).max(100),
  drinkQty: z.number().int().min(0).max(100),
  dailyLimit: z.number().int().min(0).max(10000).nullish(),
  available: z.boolean().default(true),
  active: z.boolean().default(true),
  featured: z.boolean().default(false),
  sortOrder: z.number().int().min(0).max(9999).default(0),
}).refine((c) => c.pastelQty + c.drinkQty > 0, { message: 'O combo precisa ter ao menos um item', path: ['pastelQty'] });

adminCatalogRouter.get('/combos', async (_req, res) => {
  const [combos, products] = await Promise.all([
    prisma.combo.findMany({ where: { deletedAt: null }, include: comboInclude, orderBy: [{ sortOrder: 'asc' }, { priceCents: 'asc' }] }),
    prisma.product.findMany({ where: { deletedAt: null, active: true }, include: { options: true } }),
  ]);
  const price = (p: (typeof products)[number]) => p.promoPriceCents ?? p.priceCents;
  const pastel = Math.min(...products.filter((p) => p.kind === 'PASTEL').map(price), Infinity);
  const drink = Math.min(...products.filter((p) => p.kind === 'DRINK').map(price), Infinity);
  res.json(combos.map((c) => ({ ...serializeCombo(c, Number.isFinite(pastel) ? pastel : 0, Number.isFinite(drink) ? drink : 0), rawAvailable: c.available, active: c.active, sortOrder: c.sortOrder })));
});

async function writeComboItems(tx: Parameters<Parameters<typeof withTx>[0]>[0], comboId: string, pastelQty: number, drinkQty: number) {
  await tx.comboItem.deleteMany({ where: { comboId } });
  const items = [
    ...(pastelQty ? [{ comboId, slot: 'PASTEL' as const, quantity: pastelQty }] : []),
    ...(drinkQty ? [{ comboId, slot: 'DRINK' as const, quantity: drinkQty }] : []),
  ];
  if (items.length) await tx.comboItem.createMany({ data: items });
}

adminCatalogRouter.post('/combos', async (req, res) => {
  const { pastelQty, drinkQty, ...data } = comboSchema.parse(req.body);
  const c = await withTx(async (tx) => {
    const created = await tx.combo.create({ data: { ...data, dailyLimit: data.dailyLimit ?? null } });
    await writeComboItems(tx, created.id, pastelQty, drinkQty);
    await audit(staffActor(req), 'combo.create', 'combo', created.id, { name: created.name, priceCents: created.priceCents }, tx);
    return created;
  });
  menuChanged();
  res.status(201).json(c);
});

adminCatalogRouter.put('/combos/:id', async (req, res) => {
  const id = String(req.params.id);
  const { pastelQty, drinkQty, ...data } = comboSchema.parse(req.body);
  const before = await prisma.combo.findFirst({ where: { id, deletedAt: null } });
  if (!before) throw notFound();
  await withTx(async (tx) => {
    await tx.combo.update({ where: { id }, data: { ...data, dailyLimit: data.dailyLimit ?? null } });
    await writeComboItems(tx, id, pastelQty, drinkQty);
    await audit(staffActor(req), 'combo.update', 'combo', id, { priceBefore: before.priceCents, priceAfter: data.priceCents }, tx);
  });
  menuChanged();
  res.json({ ok: true });
});

adminCatalogRouter.delete('/combos/:id', async (req, res) => {
  const c = await prisma.combo.update({ where: { id: String(req.params.id) }, data: { deletedAt: new Date(), active: false } });
  await audit(staffActor(req), 'combo.delete', 'combo', c.id, { name: c.name });
  menuChanged();
  res.json({ ok: true });
});

adminCatalogRouter.post('/combos/:id/image', upload.single('image'), async (req, res) => {
  const id = String(req.params.id);
  if (!req.file) throw badRequest('NO_FILE', 'Selecione uma imagem.');
  const combo = await prisma.combo.findFirst({ where: { id, deletedAt: null } });
  if (!combo) throw notFound();
  const stored = await storeImage(req.file.buffer, 'combos');
  const old = await prisma.productImage.findMany({ where: { comboId: id } });
  await prisma.$transaction([
    prisma.productImage.deleteMany({ where: { comboId: id } }),
    prisma.productImage.create({ data: { comboId: id, storageKey: stored.key, url: stored.url, mimeType: stored.mimeType, sizeBytes: stored.sizeBytes, width: stored.width, height: stored.height } }),
  ]);
  for (const o of old) await deleteStoredImage(o.storageKey);
  await audit(staffActor(req), 'combo.image', 'combo', id, { key: stored.key });
  menuChanged();
  res.json({ url: stored.url });
});

adminCatalogRouter.delete('/combos/:id/image', async (req, res) => {
  const id = String(req.params.id);
  const old = await prisma.productImage.findMany({ where: { comboId: id } });
  await prisma.productImage.deleteMany({ where: { comboId: id } });
  for (const o of old) await deleteStoredImage(o.storageKey);
  menuChanged();
  res.json({ ok: true });
});
