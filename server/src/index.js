import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { CLIENT_DIST, CORS_ORIGIN, PORT, UPLOAD_DIR } from './config.js';
import { get } from './db.js';
import { seed } from './seed.js';
import { ensureDefaultPermissions } from './services/permissions.js';
import { startScheduler } from './services/scheduler.js';
import authRoutes from './routes/auth.js';
import catalogRoutes from './routes/catalog.js';
import userRoutes from './routes/users.js';
import labRoutes from './routes/labs.js';
import equipmentRoutes from './routes/equipment.js';
import bookingRoutes from './routes/bookings.js';
import operationsRoutes from './routes/operations.js';
import miscRoutes, { publicRouter } from './routes/misc.js';

ensureDefaultPermissions();
if (get('SELECT COUNT(*) AS n FROM users').n === 0) {
  console.log('[setup] Empty database — loading demo data…');
  seed();
}

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
  next();
});
app.use(cors({ origin: CORS_ORIGIN.split(',').map((s) => s.trim()) }));
app.use(express.json({ limit: '1mb' }));
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '7d', index: false }));

app.get('/api/health', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));
app.use('/api', publicRouter);
app.use('/api/auth', authRoutes);
app.use('/api', catalogRoutes);
app.use('/api/users', userRoutes);
app.use('/api/labs', labRoutes);
app.use('/api/equipment', equipmentRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api', operationsRoutes);
app.use('/api', miscRoutes);
app.use('/api', (_req, res) => res.status(404).json({ error: 'Endpoint not found' }));

// Serve the built web app (single deployable unit in production).
if (fs.existsSync(CLIENT_DIST)) {
  app.use(
    express.static(CLIENT_DIST, {
      index: false,
      maxAge: '1h',
      setHeaders: (res, file) => {
        // The service worker must always be revalidated so app updates roll out.
        if (file.endsWith('sw.js')) res.setHeader('Cache-Control', 'no-cache');
      },
    }),
  );
  app.get('*', (_req, res) => res.sendFile(path.join(CLIENT_DIST, 'index.html')));
}

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  let status = err.status || err.statusCode || 500;
  if (err instanceof multer.MulterError) status = 400;
  if (err.type === 'entity.parse.failed') status = 400;
  if (status >= 500) console.error(err);
  res.status(status).json({
    error: status >= 500 ? 'Something went wrong on the server' : err.message,
    ...(err.details ? { details: err.details } : {}),
  });
});

startScheduler();
app.listen(PORT, () => console.log(`UniLab running on http://localhost:${PORT}`));
