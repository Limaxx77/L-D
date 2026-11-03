import crypto from 'node:crypto';
import { env } from '../env';

export function randomToken(bytes = 16): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function sha256(v: string): string {
  return crypto.createHash('sha256').update(v).digest('hex');
}

const key = () => Buffer.from(env.ENCRYPTION_KEY, 'hex');

/** AES-256-GCM. Formato: iv.tag.dados (base64url). */
export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString('base64url')).join('.');
}

export function decryptSecret(payload: string): string {
  const [iv, tag, data] = payload.split('.').map((p) => Buffer.from(p, 'base64url'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

export function timingSafeEqualStr(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}
