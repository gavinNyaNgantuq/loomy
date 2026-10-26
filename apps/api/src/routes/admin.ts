import { Router, type Request, type Response } from 'express';
import { requireAuth, requireRole } from '../middlewares/auth.js';

/** Endpoint F0 untuk membuktikan RBAC 403. Dihapus/diganti modul nyata pada F1+. */
export const adminRouter = Router();

adminRouter.get('/ping', requireAuth, requireRole('admin'), (_req: Request, res: Response) => {
  res.status(200).json({ ok: true, scope: 'admin' });
});
