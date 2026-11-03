import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { prisma } from '../../db';
import { badRequest, unauthorized } from '../../lib/errors';
import { audit } from '../../lib/audit';
import { permissionsFor, ROLE_INFO } from '../../lib/permissions';
import { STAFF_COOKIE, clearCookie, requireStaff, setStaffCookie, signToken } from '../../middleware/auth';

export const adminAuthRouter = Router();

const loginLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 10, standardHeaders: true, legacyHeaders: false, skipSuccessfulRequests: true, message: { error: { code: 'RATE_LIMIT', message: 'Muitas tentativas de login. Aguarde 15 minutos.' } } });

adminAuthRouter.post('/login', loginLimiter, async (req, res) => {
  const body = z.object({ email: z.string().trim().toLowerCase().email().max(120), password: z.string().max(100) }).parse(req.body);
  const user = await prisma.user.findUnique({ where: { email: body.email } });
  // Compara mesmo sem usuário para não revelar e-mails cadastrados pelo tempo de resposta.
  const ok = await bcrypt.compare(body.password, user?.passwordHash ?? '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvali');
  if (!user || !ok || !user.active) {
    await audit({ kind: 'system', ip: req.ip }, 'auth.loginFailed', 'user', user?.id ?? null, { email: body.email });
    throw unauthorized('E-mail ou senha incorretos.');
  }
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await audit({ kind: 'user', id: user.id, ip: req.ip }, 'auth.login', 'user', user.id);
  setStaffCookie(res, user.id, user.tokenVersion);
  res.json({ id: user.id, name: user.name, email: user.email, role: user.roleKey, permissions: permissionsFor(user.roleKey) });
});

adminAuthRouter.post('/logout', (_req, res) => {
  clearCookie(res, STAFF_COOKIE);
  res.json({ ok: true });
});

adminAuthRouter.get('/me', requireStaff, (req, res) => {
  const s = req.staff!;
  res.json({ ...s, roleName: ROLE_INFO[s.role].name, permissions: permissionsFor(s.role) });
});

/** Token curto para conectar ao canal de tempo real (WebSocket em outro domínio). */
adminAuthRouter.get('/realtime-token', requireStaff, async (req, res) => {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.staff!.id } });
  res.json({ token: signToken(user.id, 'rt', user.tokenVersion, '2m') });
});

adminAuthRouter.post('/change-password', requireStaff, async (req, res) => {
  const body = z.object({ currentPassword: z.string().max(100), newPassword: z.string().min(10, 'Use ao menos 10 caracteres').max(100) }).parse(req.body);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.staff!.id } });
  if (!(await bcrypt.compare(body.currentPassword, user.passwordHash))) throw badRequest('WRONG_PASSWORD', 'Senha atual incorreta.');
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await bcrypt.hash(body.newPassword, 12), tokenVersion: { increment: 1 } },
  });
  await audit({ kind: 'user', id: user.id, ip: req.ip }, 'auth.changePassword', 'user', user.id);
  setStaffCookie(res, updated.id, updated.tokenVersion);
  res.json({ ok: true });
});
