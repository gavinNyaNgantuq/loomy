import { Router, type Request, type Response } from 'express';
import { pingDb } from '../db/pool.js';

const BUILD_VERSION = '0.1.0-f0';

export const healthRouter = Router();

healthRouter.get('/', async (_req: Request, res: Response) => {
  const dbUp = await pingDb();
  // Tidak pernah membocorkan host/user/nama DB/secret.
  res.status(200).json({
    status: dbUp ? 'ok' : 'degraded',
    service: 'loomy-api',
    version: BUILD_VERSION,
    db: dbUp ? 'up' : 'down',
    time: new Date().toISOString(),
  });
});
