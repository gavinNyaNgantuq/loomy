import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { env } from '../env.js';

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Input tidak valid',
        details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
    });
    return;
  }
  const status = typeof (err as { status?: unknown }).status === 'number' ? (err as { status: number }).status : 500;
  const message = status === 500 ? 'Kesalahan server' : (err as Error).message || 'Kesalahan';
  if (!env.isProd) console.error(err);
  res.status(status).json({ error: { code: status === 500 ? 'INTERNAL_ERROR' : 'REQUEST_ERROR', message } });
}

export function notFound(_req: Request, res: Response): void {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Tidak ditemukan' } });
}
