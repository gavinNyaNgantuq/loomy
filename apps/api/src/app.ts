import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './env.js';
import { healthRouter } from './routes/health.js';
import { createAuthRouter } from './routes/auth.js';
import { createProductsRouter } from './routes/products.js';
import { createSuppliersRouter } from './routes/suppliers.js';
import { createCustomersRouter } from './routes/customers.js';
import { createMaterialsRouter } from './routes/materials.js';
import { createPurchasesRouter } from './routes/purchases.js';
import { createUsersRouter } from './routes/users.js';
import { adminRouter } from './routes/admin.js';
import { errorHandler, notFound } from './middlewares/error.js';

export function createApp(): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin: env.corsOrigins, credentials: true }));
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  app.use('/api/v1/health', healthRouter);
  app.use('/api/v1/auth', createAuthRouter());
  app.use('/api/v1/products', createProductsRouter());
  app.use('/api/v1/materials', createMaterialsRouter());
  app.use('/api/v1/purchases', createPurchasesRouter());
  app.use('/api/v1/suppliers', createSuppliersRouter());
  app.use('/api/v1/customers', createCustomersRouter());
  app.use('/api/v1/users', createUsersRouter());
  app.use('/api/v1/admin', adminRouter);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
