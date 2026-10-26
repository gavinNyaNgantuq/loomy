import type { NextFunction, Request, Response } from 'express';
import { verifyAccessToken } from '../utils/jwt.js';
import { isRole, type Role } from '../types.js';

declare global {
  namespace Express {
    interface Request {
      user?: { id: number; role: Role };
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization ?? '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Token tidak ada' } });
    return;
  }
  try {
    const claims = verifyAccessToken(token);
    const id = Number(claims.sub);
    if (!Number.isInteger(id) || !isRole(claims.role)) throw new Error('klaim invalid');
    req.user = { id, role: claims.role };
    next();
  } catch {
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Token tidak valid' } });
  }
}

export function requireRole(...allowed: Role[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Belum login' } });
      return;
    }
    if (!allowed.includes(req.user.role)) {
      res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Akses ditolak untuk peran ini' } });
      return;
    }
    next();
  };
}
