import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import type { RoleKey } from '@prisma/client';
import { env, isProd } from '../env';
import { prisma } from '../db';
import { forbidden, unauthorized } from '../lib/errors';
import { can, type Permission } from '../lib/permissions';
import type { Actor } from '../lib/audit';

export const STAFF_COOKIE = 'ld_staff';
export const CUSTOMER_COOKIE = 'ld_customer';

export interface StaffPrincipal {
  id: string;
  name: string;
  email: string;
  role: RoleKey;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      staff?: StaffPrincipal;
      customerId?: string;
    }
  }
}

interface TokenPayload {
  sub: string;
  typ: 'staff' | 'customer' | 'rt';
  v: number;
}

const COOKIE_MAX_AGE = 12 * 60 * 60 * 1000; // 12h para equipe
const CUSTOMER_MAX_AGE = 60 * 24 * 60 * 60 * 1000; // 60 dias para clientes

export function signToken(sub: string, typ: TokenPayload['typ'], v: number, expiresIn: string | number) {
  return jwt.sign({ sub, typ, v }, env.JWT_SECRET, { expiresIn } as jwt.SignOptions);
}

export function verifyToken(token: string, typ: TokenPayload['typ']): TokenPayload | null {
  try {
    const p = jwt.verify(token, env.JWT_SECRET) as TokenPayload;
    return p.typ === typ ? p : null;
  } catch {
    return null;
  }
}

function cookieOpts(maxAge: number) {
  return { httpOnly: true, secure: isProd, sameSite: 'lax' as const, maxAge, path: '/' };
}

export function setStaffCookie(res: Response, userId: string, v: number) {
  res.cookie(STAFF_COOKIE, signToken(userId, 'staff', v, '12h'), cookieOpts(COOKIE_MAX_AGE));
}

export function setCustomerCookie(res: Response, customerId: string, v: number) {
  res.cookie(CUSTOMER_COOKIE, signToken(customerId, 'customer', v, '60d'), cookieOpts(CUSTOMER_MAX_AGE));
}

export function clearCookie(res: Response, name: string) {
  res.clearCookie(name, { path: '/' });
}

export async function requireStaff(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.[STAFF_COOKIE];
  const payload = token ? verifyToken(token, 'staff') : null;
  if (!payload) return next(unauthorized());
  const user = await prisma.user.findUnique({ where: { id: payload.sub } });
  if (!user || !user.active || user.tokenVersion !== payload.v) return next(unauthorized('Sessão expirada. Entre novamente.'));
  req.staff = { id: user.id, name: user.name, email: user.email, role: user.roleKey };
  next();
}

export function requirePerm(...perms: Permission[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.staff) return next(unauthorized());
    if (!perms.some((p) => can(req.staff!.role, p))) return next(forbidden());
    next();
  };
}

export async function optionalCustomer(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.[CUSTOMER_COOKIE];
  const payload = token ? verifyToken(token, 'customer') : null;
  if (payload) {
    const c = await prisma.customer.findUnique({ where: { id: payload.sub }, select: { id: true, tokenVersion: true, anonymizedAt: true } });
    if (c && !c.anonymizedAt && c.tokenVersion === payload.v) req.customerId = c.id;
  }
  next();
}

export function requireCustomer(req: Request, _res: Response, next: NextFunction) {
  if (!req.customerId) return next(unauthorized('Entre na sua conta para continuar.'));
  next();
}

export function staffActor(req: Request): Actor {
  return { kind: 'user', id: req.staff!.id, ip: req.ip };
}

/**
 * Proteção CSRF: requisições que alteram dados precisam do cabeçalho X-LD-Client,
 * que navegadores não enviam em requisições entre sites sem passar pelo CORS.
 */
export function csrfGuard(req: Request, _res: Response, next: NextFunction) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.path.startsWith('/webhooks/')) return next();
  if (req.get('x-ld-client') !== 'web') return next(forbidden('Requisição bloqueada (CSRF).'));
  next();
}
