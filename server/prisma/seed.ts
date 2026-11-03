/**
 * Carga inicial: perfis, administrador, cardápio, combos promocionais e mesas.
 * Idempotente — pode ser executado novamente sem duplicar registros.
 *
 * Uso: ADMIN_EMAIL=... ADMIN_PASSWORD=... npm run seed
 */
import 'dotenv/config';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { PrismaClient, type ProductKind } from '@prisma/client';

const prisma = new PrismaClient();

const ROLES = [
  { key: 'ADMIN', name: 'Administrador', description: 'Acesso completo ao sistema.' },
  { key: 'ATTENDANT', name: 'Atendente', description: 'Gerencia mesas, pedidos e pagamentos autorizados.' },
  { key: 'KITCHEN', name: 'Cozinha', description: 'Visualiza pedidos e altera status de preparação.' },
  { key: 'COURIER', name: 'Entregador', description: 'Visualiza somente as entregas atribuídas.' },
] as const;

// Descrições neutras: os ingredientes devem ser confirmados e editados pelo administrador.
const PRODUCTS: { slug: string; name: string; kind: ProductKind; category: string; priceCents: number; description: string; image: string; sortOrder: number }[] = [
  { slug: 'pastel-pizza', name: 'Pastel de Pizza', kind: 'PASTEL', category: 'pasteis', priceCents: 800, description: 'Pastel sabor pizza, crocante e quentinho.', image: '/images/pastel-pizza.svg', sortOrder: 1 },
  { slug: 'pastel-frango', name: 'Pastel de Frango', kind: 'PASTEL', category: 'pasteis', priceCents: 800, description: 'Pastel sabor frango, crocante e quentinho.', image: '/images/pastel-frango.svg', sortOrder: 2 },
  { slug: 'pastel-carne', name: 'Pastel de Carne', kind: 'PASTEL', category: 'pasteis', priceCents: 800, description: 'Pastel sabor carne, crocante e quentinho.', image: '/images/pastel-carne.svg', sortOrder: 3 },
  { slug: 'refrigerante', name: 'Refrigerante', kind: 'DRINK', category: 'bebidas', priceCents: 600, description: 'Escolha a marca, o sabor e o tamanho disponíveis.', image: '/images/refrigerante.svg', sortOrder: 10 },
];

const COMBOS = [
  { name: 'Combo Individual', pastels: 1, drinks: 1, priceCents: 1300, featured: true },
  { name: 'Combo Dupla', pastels: 2, drinks: 2, priceCents: 2500, featured: true },
  { name: 'Combo Trio', pastels: 3, drinks: 2, priceCents: 3400, featured: false },
  { name: 'Combo Família', pastels: 5, drinks: 2, priceCents: 4800, featured: true },
  { name: 'Combo Galera', pastels: 10, drinks: 0, priceCents: 6500, featured: false },
  { name: 'Combo Galera Completo', pastels: 10, drinks: 4, priceCents: 8500, featured: true },
  { name: 'Combo Festa', pastels: 15, drinks: 5, priceCents: 12000, featured: false },
  { name: 'Combo Super Família', pastels: 20, drinks: 6, priceCents: 15500, featured: false },
];

function describe(p: number, d: number) {
  const parts = [`${p} pastel${p > 1 ? 'éis' : ''} à sua escolha`];
  if (d) parts.push(`${d} refrigerante${d > 1 ? 's' : ''}`);
  return parts.join(' + ') + '. Misture os sabores como quiser!';
}

async function main() {
  for (const r of ROLES) await prisma.role.upsert({ where: { key: r.key }, create: r, update: { name: r.name, description: r.description } });

  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (email && password) {
    if (password.length < 10) throw new Error('ADMIN_PASSWORD deve ter ao menos 10 caracteres');
    const exists = await prisma.user.findUnique({ where: { email } });
    if (!exists) {
      await prisma.user.create({ data: { email, name: 'Administrador', roleKey: 'ADMIN', passwordHash: await bcrypt.hash(password, 12) } });
      console.log(`Administrador criado: ${email}`);
    }
  } else if (!(await prisma.user.count({ where: { roleKey: 'ADMIN' } }))) {
    console.warn('Nenhum administrador criado. Defina ADMIN_EMAIL e ADMIN_PASSWORD e rode o seed novamente.');
  }

  const pasteis = await prisma.category.upsert({ where: { slug: 'pasteis' }, create: { name: 'Pastéis', slug: 'pasteis', sortOrder: 1 }, update: {} });
  const bebidas = await prisma.category.upsert({ where: { slug: 'bebidas' }, create: { name: 'Bebidas', slug: 'bebidas', sortOrder: 2 }, update: {} });
  const cats: Record<string, string> = { pasteis: pasteis.id, bebidas: bebidas.id };

  for (const p of PRODUCTS) {
    const exists = await prisma.product.findFirst({ where: { name: p.name, deletedAt: null } });
    if (exists) continue;
    const created = await prisma.product.create({
      data: { name: p.name, kind: p.kind, categoryId: cats[p.category], priceCents: p.priceCents, description: p.description, sortOrder: p.sortOrder },
    });
    await prisma.productImage.create({
      data: { productId: created.id, storageKey: `seed/${p.slug}`, url: p.image, mimeType: 'image/svg+xml', sizeBytes: 0, width: 800, height: 600 },
    });
  }

  for (const [i, c] of COMBOS.entries()) {
    const exists = await prisma.combo.findFirst({ where: { name: c.name, deletedAt: null } });
    if (exists) continue;
    const created = await prisma.combo.create({
      data: {
        name: c.name,
        description: describe(c.pastels, c.drinks),
        priceCents: c.priceCents,
        featured: c.featured,
        sortOrder: i + 1,
        items: { create: [{ slot: 'PASTEL', quantity: c.pastels }, ...(c.drinks ? [{ slot: 'DRINK' as const, quantity: c.drinks }] : [])] },
      },
    });
    const slug = c.name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-');
    await prisma.productImage.create({
      data: { comboId: created.id, storageKey: `seed/${slug}`, url: `/images/combo.svg`, mimeType: 'image/svg+xml', sizeBytes: 0, width: 800, height: 600 },
    });
  }

  for (let n = 1; n <= 5; n++) {
    const exists = await prisma.table.findUnique({ where: { number: n } });
    if (!exists)
      await prisma.table.create({ data: { number: n, name: `Mesa ${String(n).padStart(2, '0')}`, token: crypto.randomBytes(12).toString('base64url') } });
  }

  await prisma.integration.upsert({ where: { id: 'whatsapp' }, create: { id: 'whatsapp', enabled: false, config: { displayPhone: '5587981076022', templates: {} } }, update: {} });

  console.log('Seed concluído.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
