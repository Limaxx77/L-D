import fs from 'node:fs/promises';
import path from 'node:path';
import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import { env } from '../env';
import { badRequest } from './errors';
import { randomToken } from './crypto';

/**
 * Armazenamento persistente de imagens.
 * - "s3": qualquer serviço compatível com S3 (Cloudflare R2, AWS S3, Supabase Storage, Backblaze B2...). Recomendado em produção.
 * - "local": disco do servidor (use um disco persistente no Render, montado em UPLOAD_DIR).
 */

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const ACCEPTED_FORMATS = new Set(['jpeg', 'png', 'webp', 'avif', 'heif', 'gif']);

export interface StoredImage {
  key: string;
  url: string;
  mimeType: string;
  sizeBytes: number;
  width: number;
  height: number;
}

let s3: S3Client | null = null;
function s3Client() {
  if (!s3) {
    if (!env.S3_BUCKET || !env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY || !env.S3_PUBLIC_BASE_URL)
      throw new Error('STORAGE_DRIVER=s3 exige S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY e S3_PUBLIC_BASE_URL');
    s3 = new S3Client({
      region: env.S3_REGION,
      endpoint: env.S3_ENDPOINT || undefined,
      forcePathStyle: !!env.S3_ENDPOINT,
      credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY },
    });
  }
  return s3;
}

export const uploadDir = () => path.resolve(env.UPLOAD_DIR);

/** Valida o arquivo pelo conteúdo real (não pela extensão), normaliza e grava em WebP. */
export async function storeImage(buffer: Buffer, folder: 'products' | 'combos' | 'store'): Promise<StoredImage> {
  if (buffer.length === 0) throw badRequest('INVALID_IMAGE', 'Arquivo vazio.');
  if (buffer.length > MAX_UPLOAD_BYTES) throw badRequest('IMAGE_TOO_LARGE', 'A imagem deve ter no máximo 8 MB.');
  let meta: sharp.Metadata;
  try {
    meta = await sharp(buffer, { limitInputPixels: 40_000_000 }).metadata();
  } catch {
    throw badRequest('INVALID_IMAGE', 'Arquivo de imagem inválido ou corrompido.');
  }
  if (!meta.format || !ACCEPTED_FORMATS.has(meta.format))
    throw badRequest('INVALID_IMAGE', 'Formato não suportado. Envie JPG, PNG, WebP ou AVIF.');

  const { data, info } = await sharp(buffer, { limitInputPixels: 40_000_000 })
    .rotate() // respeita a orientação da câmera e remove metadados (EXIF/GPS)
    .resize(1400, 1400, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer({ resolveWithObject: true });

  const key = `${folder}/${new Date().toISOString().slice(0, 10)}-${randomToken(12)}.webp`;
  let url: string;
  if (env.STORAGE_DRIVER === 's3') {
    await s3Client().send(
      new PutObjectCommand({
        Bucket: env.S3_BUCKET,
        Key: key,
        Body: data,
        ContentType: 'image/webp',
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    );
    url = `${env.S3_PUBLIC_BASE_URL!.replace(/\/$/, '')}/${key}`;
  } else {
    const file = path.join(uploadDir(), key);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, data);
    url = `${env.PUBLIC_API_URL.replace(/\/$/, '')}/uploads/${key}`;
  }
  return { key, url, mimeType: 'image/webp', sizeBytes: data.length, width: info.width, height: info.height };
}

export async function deleteStoredImage(key: string) {
  if (!/^[a-z]+\/[\w-]+\.webp$/.test(key)) return;
  try {
    if (env.STORAGE_DRIVER === 's3') {
      await s3Client().send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
    } else {
      await fs.unlink(path.join(uploadDir(), key));
    }
  } catch (e) {
    console.warn('Falha ao remover imagem', key, (e as Error).message);
  }
}
