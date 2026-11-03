import fs from 'node:fs/promises';
import path from 'node:path';
import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import { env } from '../env';
import { AppError, badRequest } from './errors';
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
    const missing = ['S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'S3_PUBLIC_BASE_URL'].filter(
      (k) => !env[k as keyof typeof env],
    );
    if (missing.length)
      throw new AppError(500, 'STORAGE_CONFIG', `Armazenamento de fotos incompleto no servidor. Falta: ${missing.join(', ')}.`);
    s3 = new S3Client({
      region: env.S3_REGION,
      endpoint: env.S3_ENDPOINT?.trim() || undefined,
      forcePathStyle: !!env.S3_ENDPOINT,
      credentials: { accessKeyId: env.S3_ACCESS_KEY_ID!.trim(), secretAccessKey: env.S3_SECRET_ACCESS_KEY!.trim() },
      // Serviços compatíveis com S3 (Supabase, R2...) nem sempre aceitam os checksums que o SDK envia por padrão.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
  }
  return s3;
}

/** Traduz o erro do S3 em uma dica do que conferir nas variáveis S3_*. */
function storageHint(name = '', status?: number, message = ''): string {
  const n = `${name} ${message}`;
  if (/NoSuchBucket|Bucket not found/i.test(n)) return 'bucket não encontrado — confira S3_BUCKET';
  if (/InvalidAccessKeyId|SignatureDoesNotMatch|AccessDenied|Unauthorized|invalid signature/i.test(n) || status === 403 || status === 401)
    return 'acesso negado — confira S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY e S3_REGION';
  if (/ENOTFOUND|getaddrinfo|ECONNREFUSED|Invalid URL/i.test(n)) return 'endereço inválido — confira S3_ENDPOINT';
  if (/region/i.test(n)) return 'região incorreta — confira S3_REGION';
  return `${name || 'erro'}${status ? ` HTTP ${status}` : ''}`;
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
    try {
      await s3Client().send(
        new PutObjectCommand({
          Bucket: env.S3_BUCKET!.trim(),
          Key: key,
          Body: data,
          ContentType: 'image/webp',
          CacheControl: 'public, max-age=31536000, immutable',
        }),
      );
    } catch (e) {
      if (e instanceof AppError) throw e;
      const err = e as { name?: string; message?: string; $metadata?: { httpStatusCode?: number } };
      console.error('Falha ao enviar imagem ao armazenamento S3:', err.name, err.$metadata?.httpStatusCode, err.message);
      throw new AppError(
        502,
        'STORAGE_UPLOAD_FAILED',
        `Não foi possível salvar a foto no armazenamento (${storageHint(err.name, err.$metadata?.httpStatusCode, err.message)}).`,
      );
    }
    url = `${env.S3_PUBLIC_BASE_URL!.replace(/\/$/, '')}/${key}`;
  } else {
    const file = path.join(uploadDir(), key);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, data);
    // Endereço relativo: o site encaminha /uploads ao servidor (proxy do Vite / rewrite da Vercel).
    url = `/uploads/${key}`;
  }
  return { key, url, mimeType: 'image/webp', sizeBytes: data.length, width: info.width, height: info.height };
}

/** Corrige endereços antigos de fotos locais (gravados com domínio absoluto) para o caminho relativo. */
export function publicImageUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = /^https?:\/\/[^/]*\/uploads\/(.+)$/.exec(url);
  return m ? `/uploads/${m[1]}` : url;
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
