import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../db';
import { badRequest, notFound } from '../../lib/errors';
import { audit } from '../../lib/audit';
import { requirePerm, staffActor } from '../../middleware/auth';
import { getSettings, saveSettings, settingsSchemas, type SettingsKey } from '../../lib/settings';
import { isValidHHMM, toMinutes } from '../../lib/hours';
import { encryptSecret } from '../../lib/crypto';
import { storeImage } from '../../lib/storage';
import { ROLE_INFO, permissionsFor } from '../../lib/permissions';
import {
  EVENT_LABELS,
  EVENT_PARAMS,
  EVENTS,
  applyDefaultTemplates,
  attemptSend,
  loadIntegration,
  sendTest,
  submitDefaultTemplates,
  templatesStatus,
  whatsappConfigSchema,
} from '../../services/whatsapp';
import { DEFAULT_TEMPLATES } from '../../services/whatsappTemplates';
import { env } from '../../env';
import { upload } from './catalog';
import { cents, phone, text } from '../schemas';

export const adminManagementRouter = Router();

// ----------------------------- Clientes -----------------------------

adminManagementRouter.get('/customers', requirePerm('customers.view'), async (req, res) => {
  const q = z.object({ search: z.string().max(60).optional(), page: z.coerce.number().int().min(1).default(1), sort: z.enum(['recent', 'spent', 'orders']).default('recent') }).parse(req.query);
  const where: Prisma.CustomerWhereInput = { anonymizedAt: null };
  if (q.search) {
    const digits = q.search.replace(/\D/g, '');
    where.OR = [{ name: { contains: q.search, mode: 'insensitive' } }, ...(digits ? [{ phone: { contains: digits } }] : [])];
  }
  const [total, customers] = await Promise.all([
    prisma.customer.count({ where }),
    prisma.customer.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * 30, take: 30, select: { id: true, name: true, phone: true, email: true, passwordHash: true, whatsappOptIn: true, createdAt: true } }),
  ]);
  const stats = await prisma.order.groupBy({
    by: ['customerId'],
    where: { customerId: { in: customers.map((c) => c.id) }, status: { not: 'CANCELED' } },
    _sum: { totalCents: true },
    _count: true,
    _max: { createdAt: true },
  });
  const map = new Map(stats.map((s) => [s.customerId, s]));
  let list = customers.map(({ passwordHash, ...c }) => ({
    ...c,
    registered: !!passwordHash,
    totalSpentCents: map.get(c.id)?._sum.totalCents ?? 0,
    ordersCount: map.get(c.id)?._count ?? 0,
    lastOrderAt: map.get(c.id)?._max.createdAt ?? null,
  }));
  if (q.sort === 'spent') list = list.sort((a, b) => b.totalSpentCents - a.totalSpentCents);
  if (q.sort === 'orders') list = list.sort((a, b) => b.ordersCount - a.ordersCount);
  res.json({ total, page: q.page, pageSize: 30, customers: list });
});

adminManagementRouter.get('/customers/:id', requirePerm('customers.view'), async (req, res) => {
  const c = await prisma.customer.findUnique({
    where: { id: String(req.params.id) },
    include: { addresses: true, orders: { orderBy: { createdAt: 'desc' }, take: 100, select: { id: true, number: true, type: true, status: true, totalCents: true, createdAt: true } } },
  });
  if (!c) throw notFound();
  await audit(staffActor(req), 'customer.view', 'customer', c.id); // acesso a dados pessoais é registrado (LGPD)
  const { passwordHash, tokenVersion, ...rest } = c;
  res.json({ ...rest, registered: !!passwordHash });
});

// --------------------------- Configurações ---------------------------

adminManagementRouter.get('/settings', requirePerm('settings.manage'), async (_req, res) => {
  res.json(await getSettings());
});

adminManagementRouter.put('/settings/:key', requirePerm('settings.manage'), async (req, res) => {
  const key = String(req.params.key) as SettingsKey;
  if (!(key in settingsSchemas)) throw notFound();
  const saved = await saveSettings(key, req.body);
  await audit(staffActor(req), 'settings.update', 'settings', key, saved as Prisma.InputJsonValue);
  res.json(saved);
});

adminManagementRouter.post('/settings/store/:kind', requirePerm('settings.manage'), upload.single('image'), async (req, res) => {
  const kind = String(req.params.kind);
  if (kind !== 'logo' && kind !== 'banner') throw notFound();
  if (!req.file) throw badRequest('NO_FILE', 'Selecione uma imagem.');
  const stored = await storeImage(req.file.buffer, 'store');
  const s = await getSettings();
  await saveSettings('store', { ...s.store, [kind === 'logo' ? 'logoUrl' : 'bannerUrl']: stored.url });
  await audit(staffActor(req), `settings.${kind}`, 'settings', 'store', { key: stored.key });
  res.json({ url: stored.url });
});

// Bairros atendidos
const areaSchema = z.object({ neighborhood: text(80).min(2), feeCents: cents, minOrderCents: cents.nullish(), active: z.boolean().default(true) });

adminManagementRouter.get('/delivery-areas', requirePerm('settings.manage'), async (_req, res) => {
  res.json(await prisma.deliveryArea.findMany({ orderBy: { neighborhood: 'asc' } }));
});
adminManagementRouter.post('/delivery-areas', requirePerm('settings.manage'), async (req, res) => {
  const a = await prisma.deliveryArea.create({ data: areaSchema.parse(req.body) });
  await audit(staffActor(req), 'deliveryArea.create', 'delivery_area', a.id, { neighborhood: a.neighborhood, feeCents: a.feeCents });
  res.status(201).json(a);
});
adminManagementRouter.put('/delivery-areas/:id', requirePerm('settings.manage'), async (req, res) => {
  const a = await prisma.deliveryArea.update({ where: { id: String(req.params.id) }, data: areaSchema.parse(req.body) });
  await audit(staffActor(req), 'deliveryArea.update', 'delivery_area', a.id, { feeCents: a.feeCents });
  res.json(a);
});
adminManagementRouter.delete('/delivery-areas/:id', requirePerm('settings.manage'), async (req, res) => {
  await prisma.deliveryArea.delete({ where: { id: String(req.params.id) } });
  await audit(staffActor(req), 'deliveryArea.delete', 'delivery_area', String(req.params.id));
  res.json({ ok: true });
});

// Horários (substitui a grade inteira)
adminManagementRouter.get('/business-hours', requirePerm('settings.manage'), async (_req, res) => {
  res.json(await prisma.businessHour.findMany({ orderBy: [{ weekday: 'asc' }, { opensAt: 'asc' }] }));
});
adminManagementRouter.put('/business-hours', requirePerm('settings.manage'), async (req, res) => {
  const ranges = z
    .array(z.object({ weekday: z.number().int().min(0).max(6), opensAt: z.string().refine(isValidHHMM, 'Horário inválido'), closesAt: z.string().refine(isValidHHMM, 'Horário inválido') }))
    .max(50)
    .parse(req.body);
  for (const r of ranges) if (toMinutes(r.opensAt) === toMinutes(r.closesAt)) throw badRequest('INVALID_RANGE', 'Abertura e fechamento não podem ser iguais.');
  await prisma.$transaction([prisma.businessHour.deleteMany({}), prisma.businessHour.createMany({ data: ranges })]);
  await audit(staffActor(req), 'businessHours.update', 'settings', 'hours', ranges);
  res.json(await prisma.businessHour.findMany({ orderBy: [{ weekday: 'asc' }, { opensAt: 'asc' }] }));
});

// Cupons
const couponSchema = z
  .object({
    code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{3,30}$/, 'Use de 3 a 30 letras/números'),
    type: z.enum(['PERCENT', 'FIXED']),
    value: z.number().int().min(1),
    validFrom: z.string().datetime().nullish(),
    validUntil: z.string().datetime().nullish(),
    maxUses: z.number().int().min(1).nullish(),
    minOrderCents: cents.nullish(),
    active: z.boolean().default(true),
  })
  .refine((c) => c.type !== 'PERCENT' || c.value <= 100, { message: 'Percentual máximo é 100', path: ['value'] });

const couponData = (c: z.infer<typeof couponSchema>) => ({
  ...c,
  validFrom: c.validFrom ? new Date(c.validFrom) : null,
  validUntil: c.validUntil ? new Date(c.validUntil) : null,
  maxUses: c.maxUses ?? null,
  minOrderCents: c.minOrderCents ?? null,
});

adminManagementRouter.get('/coupons', requirePerm('settings.manage'), async (_req, res) => {
  res.json(await prisma.coupon.findMany({ orderBy: { createdAt: 'desc' } }));
});
adminManagementRouter.post('/coupons', requirePerm('settings.manage'), async (req, res) => {
  const c = await prisma.coupon.create({ data: couponData(couponSchema.parse(req.body)) });
  await audit(staffActor(req), 'coupon.create', 'coupon', c.id, { code: c.code });
  res.status(201).json(c);
});
adminManagementRouter.put('/coupons/:id', requirePerm('settings.manage'), async (req, res) => {
  const c = await prisma.coupon.update({ where: { id: String(req.params.id) }, data: couponData(couponSchema.parse(req.body)) });
  await audit(staffActor(req), 'coupon.update', 'coupon', c.id);
  res.json(c);
});
adminManagementRouter.delete('/coupons/:id', requirePerm('settings.manage'), async (req, res) => {
  const id = String(req.params.id);
  const used = await prisma.order.count({ where: { couponId: id } });
  if (used) await prisma.coupon.update({ where: { id }, data: { active: false } });
  else await prisma.coupon.delete({ where: { id } });
  await audit(staffActor(req), 'coupon.delete', 'coupon', id);
  res.json({ ok: true });
});

// --------------------------- Integrações ---------------------------

adminManagementRouter.get('/integrations/whatsapp', requirePerm('integrations.manage'), async (_req, res) => {
  const integ = await loadIntegration();
  const stats = await prisma.whatsappNotification.groupBy({ by: ['status'], _count: true, where: { createdAt: { gte: new Date(Date.now() - 30 * 86_400_000) } } });
  res.json({
    enabled: integ.row?.enabled ?? false,
    ready: integ.ready,
    status: integ.row?.status ?? 'NOT_CONFIGURED',
    lastError: integ.row?.lastError ?? null,
    lastCheckedAt: integ.row?.lastCheckedAt ?? null,
    config: integ.config,
    hasToken: !!integ.token,
    tokenSource: integ.tokenSource,
    webhook: {
      url: `${env.PUBLIC_API_URL.replace(/\/$/, '')}/api/webhooks/whatsapp`,
      verifyTokenConfigured: !!env.WHATSAPP_VERIFY_TOKEN,
      appSecretConfigured: !!env.WHATSAPP_APP_SECRET,
    },
    events: EVENTS.map((e) => ({ event: e, label: EVENT_LABELS[e], params: EVENT_PARAMS[e] })),
    stats: stats.map((s) => ({ status: s.status, count: s._count })),
  });
});

adminManagementRouter.put('/integrations/whatsapp', requirePerm('integrations.manage'), async (req, res) => {
  const body = z.object({ enabled: z.boolean(), config: whatsappConfigSchema, accessToken: z.string().max(1000).optional() }).parse(req.body);
  const data: Prisma.IntegrationUpdateInput = { enabled: body.enabled, config: body.config as Prisma.InputJsonValue };
  if (body.accessToken) data.secretEncrypted = encryptSecret(body.accessToken.trim());
  await prisma.integration.upsert({
    where: { id: 'whatsapp' },
    create: { id: 'whatsapp', enabled: body.enabled, config: body.config as Prisma.InputJsonValue, secretEncrypted: body.accessToken ? encryptSecret(body.accessToken.trim()) : null },
    update: data,
  });
  const integ = await loadIntegration();
  await prisma.integration.update({ where: { id: 'whatsapp' }, data: { status: integ.ready ? 'CONFIGURED' : body.enabled ? 'INCOMPLETE' : 'DISABLED' } });
  await audit(staffActor(req), 'integration.whatsapp.update', 'integration', 'whatsapp', { enabled: body.enabled, tokenChanged: !!body.accessToken });
  res.json({ ok: true, ready: integ.ready });
});

adminManagementRouter.delete('/integrations/whatsapp/token', requirePerm('integrations.manage'), async (req, res) => {
  await prisma.integration.update({ where: { id: 'whatsapp' }, data: { secretEncrypted: null, status: 'INCOMPLETE' } });
  await audit(staffActor(req), 'integration.whatsapp.removeToken', 'integration', 'whatsapp');
  res.json({ ok: true });
});

adminManagementRouter.post('/integrations/whatsapp/test', requirePerm('integrations.manage'), async (req, res) => {
  const body = z.object({ to: phone, template: z.string().max(512).default('hello_world'), language: z.string().max(10).default('en_US') }).parse(req.body);
  const r = await sendTest(body.to, body.template, body.language);
  await audit(staffActor(req), 'integration.whatsapp.test', 'integration', 'whatsapp', { ok: r.ok });
  res.json(r);
});

adminManagementRouter.post('/integrations/whatsapp/templates/defaults', requirePerm('integrations.manage'), async (req, res) => {
  const config = await applyDefaultTemplates();
  await audit(staffActor(req), 'integration.whatsapp.defaultTemplates', 'integration', 'whatsapp');
  res.json(config);
});

adminManagementRouter.post('/integrations/whatsapp/templates/submit', requirePerm('integrations.manage'), async (req, res) => {
  const r = await submitDefaultTemplates();
  await audit(staffActor(req), 'integration.whatsapp.submitTemplates', 'integration', 'whatsapp', { ok: r.ok });
  res.json(r);
});

adminManagementRouter.get('/integrations/whatsapp/templates/status', requirePerm('integrations.manage'), async (_req, res) => {
  res.json(await templatesStatus());
});

adminManagementRouter.get('/integrations/whatsapp/templates/definitions', requirePerm('integrations.manage'), (_req, res) => {
  res.json(DEFAULT_TEMPLATES);
});

adminManagementRouter.get('/integrations/whatsapp/notifications', requirePerm('integrations.manage'), async (req, res) => {
  const q = z.object({ status: z.enum(['PENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'SKIPPED']).optional(), page: z.coerce.number().int().min(1).default(1) }).parse(req.query);
  const where = { status: q.status };
  const [total, items] = await Promise.all([
    prisma.whatsappNotification.count({ where }),
    prisma.whatsappNotification.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * 50, take: 50, include: { order: { select: { number: true } } } }),
  ]);
  res.json({ total, page: q.page, items });
});

adminManagementRouter.post('/integrations/whatsapp/notifications/:id/retry', requirePerm('integrations.manage'), async (req, res) => {
  const id = String(req.params.id);
  const r = await prisma.whatsappNotification.updateMany({ where: { id, status: 'FAILED' }, data: { attempts: 0, nextAttemptAt: new Date() } });
  if (!r.count) throw badRequest('NOT_RETRIABLE', 'Somente envios com falha podem ser reenviados.');
  await attemptSend(id);
  res.json(await prisma.whatsappNotification.findUnique({ where: { id } }));
});

// ------------------------ Usuários e permissões ------------------------

const userSchema = z.object({
  name: text(80).min(2),
  email: z.string().trim().toLowerCase().email().max(120),
  role: z.enum(['ADMIN', 'ATTENDANT', 'KITCHEN', 'COURIER']),
  active: z.boolean().default(true),
  password: z.string().min(10, 'A senha deve ter ao menos 10 caracteres').max(100).optional(),
});

adminManagementRouter.get('/roles', requirePerm('users.manage'), (_req, res) => {
  res.json(Object.entries(ROLE_INFO).map(([key, info]) => ({ key, ...info, permissions: permissionsFor(key as keyof typeof ROLE_INFO) })));
});

adminManagementRouter.get('/users', requirePerm('orders.manage'), async (req, res) => {
  // Atendentes precisam listar entregadores para atribuir entregas.
  const isAdmin = req.staff!.role === 'ADMIN';
  const users = await prisma.user.findMany({
    where: isAdmin ? {} : { roleKey: 'COURIER', active: true },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, email: isAdmin, roleKey: true, active: true, lastLoginAt: isAdmin, createdAt: isAdmin },
  });
  res.json(users);
});

adminManagementRouter.post('/users', requirePerm('users.manage'), async (req, res) => {
  const body = userSchema.parse(req.body);
  if (!body.password) throw badRequest('PASSWORD_REQUIRED', 'Defina uma senha inicial.');
  const u = await prisma.user.create({
    data: { name: body.name, email: body.email, roleKey: body.role, active: body.active, passwordHash: await bcrypt.hash(body.password, 12) },
  });
  await audit(staffActor(req), 'user.create', 'user', u.id, { email: u.email, role: u.roleKey });
  res.status(201).json({ id: u.id });
});

adminManagementRouter.put('/users/:id', requirePerm('users.manage'), async (req, res) => {
  const id = String(req.params.id);
  const body = userSchema.parse(req.body);
  const before = await prisma.user.findUnique({ where: { id } });
  if (!before) throw notFound();
  if (id === req.staff!.id && (body.role !== 'ADMIN' || !body.active))
    throw badRequest('SELF_LOCKOUT', 'Você não pode remover seu próprio acesso de administrador.');
  if (before.roleKey === 'ADMIN' && (body.role !== 'ADMIN' || !body.active)) {
    const admins = await prisma.user.count({ where: { roleKey: 'ADMIN', active: true } });
    if (admins <= 1) throw badRequest('LAST_ADMIN', 'É necessário manter ao menos um administrador ativo.');
  }
  const changedAccess = before.roleKey !== body.role || before.active !== body.active || !!body.password;
  await prisma.user.update({
    where: { id },
    data: {
      name: body.name,
      email: body.email,
      roleKey: body.role,
      active: body.active,
      ...(body.password ? { passwordHash: await bcrypt.hash(body.password, 12) } : {}),
      ...(changedAccess ? { tokenVersion: { increment: 1 } } : {}), // encerra sessões abertas
    },
  });
  await audit(staffActor(req), 'user.update', 'user', id, { roleBefore: before.roleKey, roleAfter: body.role, active: body.active, passwordReset: !!body.password });
  res.json({ ok: true });
});

adminManagementRouter.get('/audit', requirePerm('audit.view'), async (req, res) => {
  const q = z.object({ entity: z.string().max(40).optional(), action: z.string().max(60).optional(), page: z.coerce.number().int().min(1).default(1) }).parse(req.query);
  const where: Prisma.AuditLogWhereInput = { entity: q.entity, action: q.action ? { startsWith: q.action } : undefined };
  const [total, items] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * 50, take: 50, include: { user: { select: { name: true } } } }),
  ]);
  res.json({ total, page: q.page, items });
});
