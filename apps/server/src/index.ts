import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { prisma } from './database/client.js';
import { authRouter } from './auth/router.js';
import type { ErrorRequestHandler } from 'express';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '100kb' }));
app.use('/api/auth', authRouter);

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

const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  const status = error?.type === 'entity.parse.failed' ? 400 : error?.type === 'entity.too.large' ? 413 : 500;
  res.status(status).json({ message: status === 500 ? 'Помилка сервера. Спробуйте пізніше.' : 'Некоректний запит.' });
};
app.use(errorHandler);

const server = createServer(app);
const io = new Server(server);
const port = Number(process.env.PORT ?? 3001);

server.listen(port, () => console.log(`Server: http://localhost:${port}`));

function shutdown() {
  io.close(() => { void prisma.$disconnect(); });
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
