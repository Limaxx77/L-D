import type { NextFunction, Request, Response } from 'express';
import { ZodError, type ZodTypeAny, type z } from 'zod';
import { Prisma } from '@prisma/client';
import { AppError } from '../lib/errors';

export function parse<T extends ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  return schema.parse(data);
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
  }
  if (err instanceof ZodError) {
    const first = err.issues[0];
    return res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: first ? `${first.path.join('.') || 'dados'}: ${first.message}` : 'Dados inválidos.',
        details: err.flatten(),
      },
    });
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002')
      return res.status(409).json({ error: { code: 'DUPLICATE', message: 'Registro já existe com estes dados.' } });
    if (err.code === 'P2025')
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Registro não encontrado.' } });
    if (err.code === 'P2003')
      return res
        .status(409)
        .json({ error: { code: 'IN_USE', message: 'Este registro está vinculado a outros dados e não pode ser removido.' } });
  }
  const e = err as { type?: string; status?: number; code?: string };
  if (e?.type === 'entity.too.large')
    return res.status(413).json({ error: { code: 'TOO_LARGE', message: 'Conteúdo grande demais.' } });
  if (e?.code === 'LIMIT_FILE_SIZE')
    return res.status(413).json({ error: { code: 'IMAGE_TOO_LARGE', message: 'A imagem deve ter no máximo 8 MB.' } });
  if (e?.type === 'entity.parse.failed')
    return res.status(400).json({ error: { code: 'INVALID_JSON', message: 'JSON inválido.' } });

  console.error(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`, err);
  res.status(500).json({ error: { code: 'INTERNAL', message: 'Erro interno. Tente novamente em instantes.' } });
}
