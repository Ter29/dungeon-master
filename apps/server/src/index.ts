import {cartographyRouter} from './cartography/router.js';
import express from 'express';
import { createServer } from 'node:http';
import { createRooms } from './sockets/rooms.js';
import { prisma } from './database/client.js';
import { authRouter } from './auth/router.js';
import { campaignRouter } from './campaigns/router.js';
import type { ErrorRequestHandler } from 'express';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { extname } from 'node:path';
import { production } from './config/app.js';
import { sceneRouter } from './scenes/router.js';
import { SceneError } from './scenes/state.js';
import { MulterError } from 'multer';

const app = express();
app.disable('x-powered-by');
// Render terminates TLS and forwards the client address through its proxy.
if (process.env.RENDER === 'true') app.set('trust proxy', 1);
app.use((_req, res, next) => {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY' });
  next();
});
app.use(express.json({ limit: '100kb' }));
app.use('/api/auth', authRouter);
app.use('/api/campaigns/:campaignId/cartography',cartographyRouter);
app.use('/api/campaigns/:campaignId/locations', sceneRouter);
app.use('/api', campaignRouter);

// Liveness only: this endpoint does not check database connectivity.
app.get('/api/health', (_request, response) => {
  response.json({ status: 'ok' });
});

// Readiness: the application must be able to read its migrated database.
app.get('/api/ready', async (_request, response) => {
  try {
    await prisma.campaign.count();
    response.json({ status: 'ok', database: 'connected' });
  } catch {
    response.status(503).json({ status: 'unavailable' });
  }
});

app.use('/api', (_req, res) => { res.status(404).json({ message: 'Маршрут не знайдено.' }); });

if (production) {
  const clientDirectory = fileURLToPath(new URL('../../client/dist/', import.meta.url));
  const indexFile = fileURLToPath(new URL('../../client/dist/index.html', import.meta.url));
  if (!existsSync(indexFile)) throw new Error('Client build missing; run npm run build from the repository root');
  app.use(express.static(clientDirectory, { index: false, dotfiles: 'deny' }));
  app.get('/{*path}', (req, res) => {
    if (req.path.startsWith('/socket.io') || req.path.split('/').some(part => part.startsWith('.')) || extname(req.path) || !req.accepts('html')) {
      res.status(404).end(); return;
    }
    res.set('Cache-Control', 'no-store');
    res.sendFile(indexFile);
  });
}

const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof SceneError) { res.status(error.status).json({ message: error.message }); return; }
  if (error instanceof MulterError) { res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ message: error.code === 'LIMIT_FILE_SIZE' ? 'Максимальний розмір — 8 МіБ.' : 'Некоректний файл або поля завантаження.' }); return; }
  const status = error?.type === 'entity.parse.failed' ? 400 : error?.type === 'entity.too.large' ? 413 : 500;
  res.status(status).json({ message: status === 500 ? 'Помилка сервера. Спробуйте пізніше.' : 'Некоректний запит.' });
};
app.use(errorHandler);

const server = createServer(app);
const io = createRooms(server);
const port = Number(process.env.PORT ?? 3001);

server.listen(port, '0.0.0.0', () => console.log(`Server listening on port ${port}`));

function shutdown() {
  io.close(() => { void prisma.$disconnect(); });
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
