import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import { config } from './config';
import { notFound, errorHandler } from './middleware/error';
import authRoutes from './routes/auth';
import assetRoutes from './routes/assets';
import dashboardRoutes from './routes/dashboard';
import auditRoutes from './routes/audit';
import userRoutes from './routes/users';
import exportRoutes from './routes/export';
import vendorRoutes from './routes/vendors';

export function createApp() {
  const app = express();
  app.use(cors({ origin: config.corsOrigin }));
  app.use(express.json({ limit: '10mb' }));
  app.use(morgan('dev'));

  app.get('/api/health', (_req, res) => res.json({ ok: true, company: config.companyName }));
  app.get('/api/meta', (_req, res) => res.json({ company: config.companyName, reportTitle: config.reportTitle }));

  app.use('/api/auth', authRoutes);
  app.use('/api/assets', assetRoutes);
  app.use('/api/dashboard', dashboardRoutes);
  app.use('/api/audit', auditRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/export', exportRoutes);
  app.use('/api/vendors', vendorRoutes);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
