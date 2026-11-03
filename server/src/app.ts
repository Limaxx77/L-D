import express, { Router } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { env } from './env';
import { prisma } from './db';
import { csrfGuard, requireStaff } from './middleware/auth';
import { errorHandler } from './middleware/validate';
import { uploadDir } from './lib/storage';
import { notFound } from './lib/errors';
import { publicRouter } from './routes/public';
import { customerRouter } from './routes/customer';
import { tableRouter } from './routes/table';
import { adminAuthRouter } from './routes/admin/auth';
import { adminOrdersRouter } from './routes/admin/orders';
import { adminCatalogRouter } from './routes/admin/catalog';
import { adminTablesRouter } from './routes/admin/tables';
import { adminFinanceRouter } from './routes/admin/finance';
import { adminManagementRouter } from './routes/admin/management';
import { handleWebhook, verifyWebhookSignature } from './services/whatsapp';

export function allowedOrigins() {
  return [env.PUBLIC_APP_URL, ...env.CORS_ORIGINS.split(',')].map((o) => o.trim().replace(/\/$/, '')).filter(Boolean);
}

export function createApp() {
  const app = express();
  app.set('trust proxy', env.TRUST_PROXY);
  app.disable('x-powered-by');

  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' }, // imagens servidas para o frontend em outro domínio
      contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], imgSrc: ["'self'"], frameAncestors: ["'none'"] } },
    }),
  );
  app.use(cors({ origin: allowedOrigins(), credentials: true }));
  app.use(cookieParser());

  // Webhook do WhatsApp precisa do corpo bruto para validar a assinatura.
  app.get('/api/webhooks/whatsapp', (req, res) => {
    const ok = req.query['hub.mode'] === 'subscribe' && env.WHATSAPP_VERIFY_TOKEN && req.query['hub.verify_token'] === env.WHATSAPP_VERIFY_TOKEN;
    if (!ok) return res.sendStatus(403);
    res.type('text/plain').send(String(req.query['hub.challenge'] ?? ''));
  });
  app.post('/api/webhooks/whatsapp', express.raw({ type: 'application/json', limit: '1mb' }), async (req, res) => {
    if (!verifyWebhookSignature(req.body as Buffer, req.get('x-hub-signature-256'))) return res.sendStatus(401);
    res.sendStatus(200); // responde rápido; processa em seguida
    try {
      await handleWebhook(JSON.parse((req.body as Buffer).toString('utf8')));
    } catch (e) {
      console.error('Erro no webhook do WhatsApp', e);
    }
  });

  app.use(express.json({ limit: '200kb' }));
  app.use('/uploads', express.static(uploadDir(), { maxAge: '365d', immutable: true, fallthrough: false }));

  app.get('/api/health', async (_req, res) => {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ ok: true, time: new Date().toISOString() });
  });

  const api = Router();
  api.use(rateLimit({ windowMs: 60_000, limit: 300, standardHeaders: true, legacyHeaders: false }));
  api.use(csrfGuard);
  api.use('/public', publicRouter);
  api.use('/customer', customerRouter);
  api.use('/table', tableRouter);
  api.use('/admin/auth', adminAuthRouter);

  const admin = Router();
  admin.use(requireStaff);
  admin.use('/orders', adminOrdersRouter);
  admin.use('/catalog', adminCatalogRouter);
  admin.use('/finance', adminFinanceRouter);
  admin.use('/', adminTablesRouter);
  admin.use('/', adminManagementRouter);
  api.use('/admin', admin);

  api.use(() => {
    throw notFound('Rota não encontrada.');
  });
  app.use('/api', api);
  app.use(errorHandler);
  return app;
}
