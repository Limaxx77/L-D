import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import sharp from 'sharp';
import bcrypt from 'bcryptjs';
import type { Express } from 'express';
import type { PrismaClient } from '@prisma/client';

/**
 * Testes de integração dos fluxos principais contra PostgreSQL real
 * (migrações aplicadas, API HTTP completa).
 */
let app: Express;
let prisma: PrismaClient;
const H = { 'x-ld-client': 'web' };

const ids: Record<string, string> = {};

async function staffAgent(email: string, password: string) {
  const agent = request.agent(app);
  const r = await agent.post('/api/admin/auth/login').set(H).send({ email, password });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return agent;
}

beforeAll(async () => {
  ({ prisma } = await import('../src/db'));
  const { createApp } = await import('../src/app');
  app = createApp();

  await prisma.role.createMany({
    data: [
      { key: 'ADMIN', name: 'Administrador', description: '' },
      { key: 'ATTENDANT', name: 'Atendente', description: '' },
      { key: 'KITCHEN', name: 'Cozinha', description: '' },
      { key: 'COURIER', name: 'Entregador', description: '' },
    ],
    skipDuplicates: true,
  });
  const hash = await bcrypt.hash('senha-forte-123', 4);
  await prisma.user.createMany({
    data: [
      { email: 'admin@ld.test', name: 'Admin', roleKey: 'ADMIN', passwordHash: hash },
      { email: 'atend@ld.test', name: 'Atendente', roleKey: 'ATTENDANT', passwordHash: hash },
      { email: 'cozinha@ld.test', name: 'Cozinha', roleKey: 'KITCHEN', passwordHash: hash },
      { email: 'moto@ld.test', name: 'Moto', roleKey: 'COURIER', passwordHash: hash },
    ],
  });
  ids.courier = (await prisma.user.findUniqueOrThrow({ where: { email: 'moto@ld.test' } })).id;
  // Loja aberta 24h para os testes
  await prisma.businessHour.createMany({ data: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, opensAt: '00:00', closesAt: '24:00' })) });
});

afterAll(async () => {
  await prisma?.$disconnect();
});

describe('administração do catálogo', () => {
  it('bloqueia acesso sem login e sem permissão', async () => {
    expect((await request(app).get('/api/admin/orders/board')).status).toBe(401);
    const kitchen = await staffAgent('cozinha@ld.test', 'senha-forte-123');
    expect((await kitchen.post('/api/admin/catalog/categories').set(H).send({ name: 'X', slug: 'xx' })).status).toBe(403);
    expect((await kitchen.get('/api/admin/finance/summary')).status).toBe(403);
    expect((await kitchen.get('/api/admin/orders/board')).status).toBe(200);
  });

  it('exige cabeçalho anti-CSRF em alterações', async () => {
    const r = await request(app).post('/api/admin/auth/login').send({ email: 'admin@ld.test', password: 'x' });
    expect(r.status).toBe(403);
  });

  it('cadastra categorias, produtos (com opções de refrigerante) e combos', async () => {
    const admin = await staffAgent('admin@ld.test', 'senha-forte-123');
    const pasteis = await admin.post('/api/admin/catalog/categories').set(H).send({ name: 'Pastéis', slug: 'pasteis', sortOrder: 1 });
    const bebidas = await admin.post('/api/admin/catalog/categories').set(H).send({ name: 'Bebidas', slug: 'bebidas', sortOrder: 2 });
    for (const [key, name] of [['pizza', 'Pastel de Pizza'], ['frango', 'Pastel de Frango'], ['carne', 'Pastel de Carne']]) {
      const r = await admin.post('/api/admin/catalog/products').set(H).send({ categoryId: pasteis.body.id, kind: 'PASTEL', name, priceCents: 800 });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      ids[key] = r.body.id;
    }
    const refri = await admin.post('/api/admin/catalog/products').set(H).send({
      categoryId: bebidas.body.id,
      kind: 'DRINK',
      name: 'Refrigerante',
      priceCents: 600,
      options: [{ brand: 'Coca-Cola' }, { brand: 'Guaraná Antarctica' }],
    });
    expect(refri.status).toBe(201);
    ids.refri = refri.body.id;
    ids.coca = refri.body.options[0].id;
    ids.guarana = refri.body.options[1].id;

    for (const [key, name, p, d, price] of [
      ['individual', 'Combo Individual', 1, 1, 1300],
      ['galera', 'Combo Galera', 10, 0, 6500],
      ['trio', 'Combo Trio', 3, 2, 3400],
    ] as const) {
      const r = await admin.post('/api/admin/catalog/combos').set(H).send({ name, pastelQty: p, drinkQty: d, priceCents: price, featured: true });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      ids[key] = r.body.id;
    }
    const menu = await request(app).get('/api/public/menu');
    expect(menu.body.products).toHaveLength(4);
    const galera = menu.body.combos.find((c: { id: string }) => c.id === ids.galera);
    expect(galera.savingsCents).toBe(80_00 - 65_00);
  });

  it('faz upload real de imagem (validada e convertida para WebP)', async () => {
    const admin = await staffAgent('admin@ld.test', 'senha-forte-123');
    const jpg = await sharp({ create: { width: 1600, height: 1200, channels: 3, background: '#f5b301' } }).jpeg().toBuffer();
    const r = await admin.post(`/api/admin/catalog/products/${ids.pizza}/image`).set(H).attach('image', jpg, { filename: 'foto.jpg', contentType: 'image/jpeg' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.url).toMatch(/^\/uploads\/products\/.+\.webp$/); // relativo: independe do domínio
    const path = r.body.url;
    const img = await request(app).get(path);
    expect(img.status).toBe(200);
    const meta = await sharp(img.body).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.width).toBeLessThanOrEqual(1400);

    const fake = await admin.post(`/api/admin/catalog/products/${ids.pizza}/image`).set(H).attach('image', Buffer.from('não é imagem'), { filename: 'x.jpg', contentType: 'image/jpeg' });
    expect(fake.status).toBe(400);
  });

  it('configura bairro atendido', async () => {
    const admin = await staffAgent('admin@ld.test', 'senha-forte-123');
    const r = await admin.post('/api/admin/delivery-areas').set(H).send({ neighborhood: 'Centro', feeCents: 700 });
    expect(r.status).toBe(201);
    ids.centro = r.body.id;
  });
});

describe('Cenário A — delivery', () => {
  const order = () => ({
    type: 'DELIVERY',
    items: [
      { type: 'combo', comboId: ids.galera, quantity: 1, pastels: [{ productId: ids.carne, quantity: 4 }, { productId: ids.frango, quantity: 3 }, { productId: ids.pizza, quantity: 3 }], drinks: [] },
      { type: 'product', productId: ids.refri, optionId: ids.coca, quantity: 2 },
    ],
    customer: { name: 'Maria Souza', phone: '(65) 98888-7777' },
    whatsappOptIn: true,
    address: { street: 'Rua A', number: '100', neighborhood: 'Centro', deliveryAreaId: ids.centro },
    paymentMethod: 'CASH',
    changeForCents: 100_00,
    privacyAccepted: true,
  });

  it('cotação calculada no servidor', async () => {
    const r = await request(app).post('/api/public/cart/quote').set(H).send({ type: 'DELIVERY', items: order().items, deliveryAreaId: ids.centro });
    expect(r.body.itemsTotalCents).toBe(77_00);
    expect(r.body.deliveryFeeCents).toBe(0); // entrega grátis a partir de R$ 35,00
    expect(r.body.totalCents).toBe(77_00);
    expect(r.body.savingsCents).toBe(15_00);
  });

  it('cobra R$ 7,00 de entrega abaixo de R$ 35,00', async () => {
    const small = [{ type: 'product', productId: ids.carne, quantity: 2 }];
    const r = await request(app).post('/api/public/cart/quote').set(H).send({ type: 'DELIVERY', items: small, deliveryAreaId: ids.centro });
    expect(r.body.itemsTotalCents).toBe(16_00);
    expect(r.body.deliveryFeeCents).toBe(7_00);
    expect(r.body.totalCents).toBe(23_00);
    const limit = [{ type: 'product', productId: ids.carne, quantity: 5 }];
    const r2 = await request(app).post('/api/public/cart/quote').set(H).send({ type: 'DELIVERY', items: limit, deliveryAreaId: ids.centro });
    expect(r2.body.itemsTotalCents).toBe(40_00);
    expect(r2.body.deliveryFeeCents).toBe(0);
  });

  it('ignora preços enviados pelo navegador', async () => {
    const body = order();
    (body.items[1] as Record<string, unknown>).unitPriceCents = 1;
    (body as Record<string, unknown>).totalCents = 1;
    const r = await request(app).post('/api/public/orders').set(H).set('Idempotency-Key', 'price-tamper-0001').send(body);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.totalCents).toBe(77_00);
    ids.tamperToken = r.body.publicToken;
  });

  it('não duplica pedido com a mesma chave de idempotência (requisições simultâneas)', async () => {
    const [a, b, c] = await Promise.all(
      [1, 2, 3].map(() => request(app).post('/api/public/orders').set(H).set('Idempotency-Key', 'same-key-12345').send(order())),
    );
    expect([a.status, b.status, c.status].every((s) => s === 201)).toBe(true);
    expect(new Set([a.body.number, b.body.number, c.body.number]).size).toBe(1);
    expect(await prisma.order.count({ where: { idempotencyKey: 'same-key-12345' } })).toBe(1);
    ids.orderToken = a.body.publicToken;
    ids.orderNumber = String(a.body.number);
    expect(a.body.status).toBe('AWAITING_ACCEPT');
  });

  it('aceite com prazo, sem processar duas vezes', async () => {
    const admin = await staffAgent('admin@ld.test', 'senha-forte-123');
    const atend = await staffAgent('atend@ld.test', 'senha-forte-123');
    const o = await prisma.order.findUniqueOrThrow({ where: { publicToken: ids.orderToken } });
    ids.orderId = o.id;
    const [r1, r2] = await Promise.all([
      admin.post(`/api/admin/orders/${o.id}/accept`).set(H).send({ minutes: 35 }),
      atend.post(`/api/admin/orders/${o.id}/accept`).set(H).send({ minutes: 20 }),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([200, 409]);
    const tracked = await request(app).get(`/api/public/orders/track/${ids.orderToken}`);
    expect(tracked.body.status).toBe('ACCEPTED');
    expect(tracked.body.acceptedAt).toBeTruthy();
    // Notificação: sem integração configurada, fica como SKIPPED (não finge envio)
    const notes = await prisma.whatsappNotification.findMany({ where: { orderId: o.id } });
    expect(notes.length).toBeGreaterThanOrEqual(1);
    expect(notes.every((n) => n.status === 'SKIPPED')).toBe(true);
    const accepted = notes.find((n) => n.event === 'ORDER_ACCEPTED');
    expect(accepted?.body).toContain('Tempo estimado: ');
  });

  it('cozinha prepara, entregador entrega, venda entra no financeiro', async () => {
    const kitchen = await staffAgent('cozinha@ld.test', 'senha-forte-123');
    const courier = await staffAgent('moto@ld.test', 'senha-forte-123');
    const atend = await staffAgent('atend@ld.test', 'senha-forte-123');
    expect((await kitchen.post(`/api/admin/orders/${ids.orderId}/status`).set(H).send({ status: 'PREPARING' })).status).toBe(200);
    expect((await kitchen.post(`/api/admin/orders/${ids.orderId}/status`).set(H).send({ status: 'READY' })).status).toBe(200);
    expect((await kitchen.post(`/api/admin/orders/${ids.orderId}/status`).set(H).send({ status: 'OUT_FOR_DELIVERY' })).status).toBe(403);
    // Entregador não vê pedido não atribuído
    expect((await courier.get(`/api/admin/orders/${ids.orderId}`)).status).toBe(403);
    expect((await atend.post(`/api/admin/orders/${ids.orderId}/courier`).set(H).send({ courierId: ids.courier })).status).toBe(200);
    expect((await courier.get('/api/admin/orders/deliveries/mine')).body).toHaveLength(1);
    expect((await courier.post(`/api/admin/orders/${ids.orderId}/status`).set(H).send({ status: 'OUT_FOR_DELIVERY' })).status).toBe(200);
    expect((await courier.post(`/api/admin/orders/${ids.orderId}/status`).set(H).send({ status: 'DELIVERED' })).status).toBe(200);
    expect((await atend.post(`/api/admin/orders/${ids.orderId}/payments`).set(H).send({ method: 'CASH', amountCents: 77_00 })).status).toBe(200);

    const admin = await staffAgent('admin@ld.test', 'senha-forte-123');
    const fin = await admin.get('/api/admin/finance/summary');
    expect(fin.status).toBe(200);
    expect(fin.body.revenueCents).toBeGreaterThanOrEqual(77_00);
    expect(fin.body.receivedCents).toBe(77_00);
    const csv = await admin.get('/api/admin/finance/export.csv');
    expect(csv.text).toContain(`${ids.orderNumber};`);
    const pdf = await admin.get('/api/admin/finance/export.pdf').buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect((pdf.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
  });

  it('localiza pedido por número + telefone', async () => {
    const r = await request(app).post('/api/public/orders/lookup').set(H).send({ number: Number(ids.orderNumber), phone: '65988887777' });
    expect(r.body.publicToken).toBe(ids.orderToken);
  });
});

describe('Cenário C — recusa com motivo', () => {
  it('cancela, registra motivo e sinaliza estorno se pago', async () => {
    const o = await prisma.order.findUniqueOrThrow({ where: { publicToken: ids.tamperToken } });
    const admin = await staffAgent('admin@ld.test', 'senha-forte-123');
    expect((await admin.post(`/api/admin/orders/${o.id}/refuse`).set(H).send({ reason: '' })).status).toBe(400);
    // pagamento PIX antecipado confirmado antes da recusa
    await admin.post(`/api/admin/orders/${o.id}/payments`).set(H).send({ method: 'PIX', amountCents: 77_00 });
    const r = await admin.post(`/api/admin/orders/${o.id}/refuse`).set(H).send({ reason: 'Produto indisponível' });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('CANCELED');
    expect(r.body.cancelReason).toBe('Produto indisponível');
    expect(r.body.paymentStatus).toBe('REFUND_PENDING');
    let n = null;
    for (let i = 0; i < 50 && !n; i++) {
      n = await prisma.whatsappNotification.findFirst({ where: { orderId: o.id, event: 'ORDER_CANCELED' } });
      if (!n) await new Promise((r) => setTimeout(r, 50));
    }
    expect(n?.body).toContain('Motivo: Produto indisponível.');
    const log = await prisma.auditLog.findFirst({ where: { entityId: o.id, action: 'order.cancel' } });
    expect(log?.userId).toBeTruthy();
  });
});

describe('limite diário de combos e estoque sob concorrência', () => {
  it('não vende além do limite com pedidos simultâneos', async () => {
    await prisma.combo.update({ where: { id: ids.individual }, data: { dailyLimit: 2 } });
    const body = () => ({
      type: 'PICKUP',
      items: [{ type: 'combo', comboId: ids.individual, quantity: 1, pastels: [{ productId: ids.pizza, quantity: 1 }], drinks: [{ productId: ids.refri, optionId: ids.guarana, quantity: 1 }] }],
      customer: { name: 'Cliente', phone: '65977776666' },
      paymentMethod: 'PIX',
      privacyAccepted: true,
    });
    const rs = await Promise.all([1, 2, 3, 4].map(() => request(app).post('/api/public/orders').set(H).send(body())));
    expect(rs.filter((r) => r.status === 201)).toHaveLength(2);
    expect(rs.filter((r) => r.status === 400)).toHaveLength(2);
    await prisma.combo.update({ where: { id: ids.individual }, data: { dailyLimit: null } });
  });

  it('baixa de estoque atômica', async () => {
    await prisma.product.update({ where: { id: ids.frango }, data: { stockQty: 3 } });
    const body = () => ({ type: 'PICKUP', items: [{ type: 'product', productId: ids.frango, quantity: 2 }], customer: { name: 'Carlos', phone: '65966665555' }, paymentMethod: 'PIX', privacyAccepted: true });
    const rs = await Promise.all([1, 2].map(() => request(app).post('/api/public/orders').set(H).send(body())));
    expect(rs.filter((r) => r.status === 201)).toHaveLength(1);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: ids.frango } })).stockQty).toBe(1);
    await prisma.product.update({ where: { id: ids.frango }, data: { stockQty: null } });
  });
});

describe('Cenário B — mesa com várias pessoas e divisão de conta', () => {
  const P: Record<string, string> = {};
  let tableToken = '';
  let sessionId = '';

  it('cria mesa, gera link e QR Code', async () => {
    const admin = await staffAgent('admin@ld.test', 'senha-forte-123');
    const t = await admin.post('/api/admin/tables').set(H).send({ name: 'Mesa 03', number: 3 });
    expect(t.status).toBe(201);
    tableToken = t.body.url.split('/mesa/')[1];
    expect(tableToken.length).toBeGreaterThanOrEqual(16);
    ids.table = t.body.id;
    const png = await admin.get(`/api/admin/tables/${t.body.id}/qr.png`);
    expect(png.headers['content-type']).toBe('image/png');
    const svg = await admin.get(`/api/admin/tables/${t.body.id}/qr.svg`);
    expect(String(svg.body ?? svg.text)).toContain('<svg');
    expect((await request(app).get('/api/table/t/mesa-falsa-123')).status).toBe(404);
  });

  it('várias pessoas entram, uma adiciona outra', async () => {
    for (const name of ['Leonardo', 'Daniel', 'Pedro']) {
      const r = await request(app).post(`/api/table/t/${tableToken}/join`).set(H).send({ name });
      expect(r.status).toBe(201);
      P[name] = r.body.deviceToken;
      P[name + 'Id'] = r.body.participantId;
      sessionId = r.body.sessionId;
    }
    const lucas = await request(app).post('/api/table/session/people').set(H).set('x-participant-token', P.Pedro).send({ name: 'Lucas' });
    expect(lucas.status).toBe(201);
    P.LucasId = lucas.body.id;
    const s = await request(app).get('/api/table/session').set('x-participant-token', P.Leonardo);
    expect(s.body.participants).toHaveLength(4);
  });

  it('pedidos simultâneos de cada pessoa', async () => {
    const order = (token: string, items: unknown[], allocations: unknown[]) =>
      request(app).post('/api/table/session/orders').set(H).set('x-participant-token', token).send({ items, allocations });
    const rs = await Promise.all([
      order(P.Leonardo, [{ type: 'product', productId: ids.carne, quantity: 2 }], [{ participants: [{ participantId: P.LeonardoId }] }]),
      order(P.Daniel, [{ type: 'product', productId: ids.pizza, quantity: 1 }], [{ participants: [{ participantId: P.DanielId }] }]),
      order(
        P.Pedro,
        [
          { type: 'product', productId: ids.frango, quantity: 1 },
          { type: 'product', productId: ids.refri, optionId: ids.coca, quantity: 1 },
          { type: 'product', productId: ids.refri, optionId: ids.guarana, quantity: 2 },
        ],
        [{ participants: [{ participantId: P.PedroId }] }, { participants: [{ participantId: P.PedroId }] }, { participants: [{ participantId: P.LucasId }] }],
      ),
    ]);
    for (const r of rs) expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(new Set(rs.map((r) => r.body.number)).size).toBe(3);
  });

  it('participante não lança consumo para outra pessoa com aparelho próprio', async () => {
    const r = await request(app)
      .post('/api/table/session/orders')
      .set(H)
      .set('x-participant-token', P.Daniel)
      .send({ items: [{ type: 'product', productId: ids.carne, quantity: 5 }], allocations: [{ participants: [{ participantId: P.LeonardoId }] }] });
    expect(r.status).toBe(403);
  });

  it('total R$ 50,00 e as três divisões', async () => {
    const s = await request(app).get('/api/table/session').set('x-participant-token', P.Leonardo);
    expect(s.body.bill.totalCents).toBe(50_00);
    const due = (b: { shares: { participantId: string; dueCents: number }[] }) => Object.fromEntries(b.shares.map((x) => [x.participantId, x.dueCents]));
    expect(due(s.body.bill)).toEqual({ [P.LeonardoId]: 16_00, [P.DanielId]: 8_00, [P.PedroId]: 14_00, [P.LucasId]: 12_00 });

    const eq = await request(app).post('/api/table/session/split-preview').set(H).set('x-participant-token', P.Daniel).send({ mode: 'EQUAL' });
    expect(Object.values(due(eq.body))).toEqual([12_50, 12_50, 12_50, 12_50]);

    const refriItem = s.body.orders.flatMap((o: { items: { id: string; name: string }[] }) => o.items).find((i: { name: string }) => i.name.includes('Coca'));
    const custom = await request(app)
      .post('/api/table/session/split-preview')
      .set(H)
      .set('x-participant-token', P.Daniel)
      .send({ mode: 'CUSTOM', config: { items: { [refriItem.id]: { [P.LeonardoId]: 1, [P.DanielId]: 1 } } } });
    expect(due(custom.body)[P.LeonardoId]).toBe(19_00);
    expect(due(custom.body)[P.DanielId]).toBe(11_00);
    expect(due(custom.body)[P.PedroId]).toBe(8_00);
  });

  it('pagamentos parciais, bloqueio de fechamento com saldo e encerramento', async () => {
    const atend = await staffAgent('atend@ld.test', 'senha-forte-123');
    const kitchen = await staffAgent('cozinha@ld.test', 'senha-forte-123');
    expect((await request(app).post('/api/table/session/request-close').set(H).set('x-participant-token', P.Leonardo).send({ mode: 'CONSUMPTION' })).status).toBe(200);

    const session = await atend.get(`/api/admin/sessions/${sessionId}`);
    for (const o of session.body.orders) {
      await atend.post(`/api/admin/orders/${o.id}/accept`).set(H).send({ minutes: null });
      await kitchen.post(`/api/admin/orders/${o.id}/status`).set(H).send({ status: 'PREPARING' });
      await kitchen.post(`/api/admin/orders/${o.id}/status`).set(H).send({ status: 'READY' });
      await atend.post(`/api/admin/orders/${o.id}/status`).set(H).send({ status: 'SERVED' });
    }
    const pay = (participantId: string, amountCents: number, method = 'PIX') =>
      atend.post(`/api/admin/sessions/${sessionId}/payments`).set(H).send({ method, amountCents, allocations: [{ participantId, amountCents }] });

    expect((await pay(P.LeonardoId, 16_00)).status).toBe(201);
    expect((await pay(P.DanielId, 8_00, 'CASH')).status).toBe(201);
    const partial = await atend.get(`/api/admin/sessions/${sessionId}`);
    expect(partial.body.bill.paidCents).toBe(24_00);
    expect(partial.body.bill.remainingCents).toBe(26_00);

    const blocked = await atend.post(`/api/admin/sessions/${sessionId}/close`).set(H).send({});
    expect(blocked.status).toBe(400);
    const forcedByAttendant = await atend.post(`/api/admin/sessions/${sessionId}/close`).set(H).send({ force: true, reason: 'Cliente saiu sem pagar' });
    expect(forcedByAttendant.status).toBe(403);
    expect((await pay(P.PedroId, 30_00)).status).toBe(400); // acima do saldo

    expect((await pay(P.PedroId, 14_00, 'DEBIT')).status).toBe(201);
    expect((await pay(P.LucasId, 12_00, 'CREDIT')).status).toBe(201);
    const close = await atend.post(`/api/admin/sessions/${sessionId}/close`).set(H).send({});
    expect(close.status, JSON.stringify(close.body)).toBe(200);

    const board = await atend.get('/api/admin/tables');
    const t = board.body.find((x: { id: string }) => x.id === ids.table);
    expect(['LIVRE', 'FINALIZADA']).toContain(t.status);
    // Tokens antigos não acessam mais a comanda encerrada
    expect((await request(app).get('/api/table/session').set('x-participant-token', P.Leonardo)).status).toBe(403);
    // Nova abertura cria nova sessão, sem misturar pedidos
    const again = await request(app).post(`/api/table/t/${tableToken}/join`).set(H).send({ name: 'Novo cliente' });
    expect(again.body.sessionId).not.toBe(sessionId);
    const fresh = await request(app).get('/api/table/session').set('x-participant-token', again.body.deviceToken);
    expect(fresh.body.orders).toHaveLength(0);
  });

  it('regenerar link invalida o anterior', async () => {
    const admin = await staffAgent('admin@ld.test', 'senha-forte-123');
    const r = await admin.post(`/api/admin/tables/${ids.table}/regenerate`).set(H).send({});
    expect(r.body.url).not.toContain(tableToken);
    expect((await request(app).get(`/api/table/t/${tableToken}`)).status).toBe(404);
  });
});

describe('cliente cadastrado', () => {
  it('cadastro, login, favoritos e repetir pedido', async () => {
    const agent = request.agent(app);
    const reg = await agent.post('/api/customer/register').set(H).send({ name: 'Joana Lima', phone: '65955554444', password: 'senha-cliente', privacyAccepted: true });
    expect(reg.status, JSON.stringify(reg.body)).toBe(201);
    expect((await agent.put(`/api/customer/favorites/${ids.carne}`).set(H).send({})).status).toBe(200);
    expect((await agent.get('/api/customer/favorites')).body).toEqual([ids.carne]);
    const o = await agent.post('/api/public/orders').set(H).send({
      type: 'PICKUP',
      items: [{ type: 'product', productId: ids.carne, quantity: 2 }],
      customer: { name: 'Joana Lima', phone: '65955554444' },
      paymentMethod: 'PIX',
      privacyAccepted: true,
    });
    expect(o.status).toBe(201);
    const list = await agent.get('/api/customer/orders');
    expect(list.body).toHaveLength(1);
    await prisma.product.update({ where: { id: ids.carne }, data: { priceCents: 900 } });
    const re = await agent.post(`/api/customer/orders/${o.body.publicToken}/reorder`).set(H).send({});
    expect(re.body[0].ok).toBe(true);
    // preço histórico preservado
    const hist = await request(app).get(`/api/public/orders/track/${o.body.publicToken}`);
    expect(hist.body.totalCents).toBe(16_00);
    await prisma.product.update({ where: { id: ids.carne }, data: { priceCents: 800 } });
  });
});
