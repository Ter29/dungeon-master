import { Router, type Request, type Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../database/client.js';
import { hashPassword, verifyPassword } from './password.js';

const production = process.env.NODE_ENV === 'production';
const origin = process.env.APP_ORIGIN ?? 'http://localhost:5173';
if (production && !process.env.APP_ORIGIN) throw new Error('APP_ORIGIN is required in production');
const cookieName = production ? '__Host-dnd_session' : 'dnd_session';
const cookieOptions = { httpOnly: true, secure: production, sameSite: 'lax' as const, path: '/' };
const lifetime = 7 * 24 * 60 * 60 * 1000;
const userSelect = { id: true, email: true, displayName: true } as const;
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
function sessionHash(req: Request) {
  const value = req.headers.cookie?.split(';').map(p => p.trim()).find(p => p.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
  return value && /^[A-Za-z0-9_-]{43}$/.test(value) ? digest(value) : undefined;
}
const email = z.string().trim().toLowerCase().email().max(254);
const password = z.string().min(12).max(128);
const loginSchema = z.object({ email, password });
const registerSchema = loginSchema.extend({ displayName: z.string().trim().min(1).max(80) });
// Equal-cost verification when the email does not exist.
const dummyHash = await hashPassword(randomBytes(32).toString('hex'));

export const authRouter = Router();
authRouter.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
authRouter.use((req, res, next) => {
  if (req.method !== 'GET' && (req.headers.origin && req.headers.origin !== origin)) {
    res.status(403).json({ message: 'Недозволене джерело запиту.' }); return;
  }
  if (req.method !== 'GET' && !req.is('application/json')) {
    res.status(415).json({ message: 'Потрібен application/json.' }); return;
  }
  next();
});
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false,
  message: { message: 'Забагато спроб. Спробуйте пізніше.' } });

async function issueSession(req: Request, res: Response, userId: string) {
  const token = randomBytes(32).toString('base64url');
  const previousHash = sessionHash(req);
  await prisma.$transaction(async tx => {
    if (previousHash) await tx.session.deleteMany({ where: { tokenHash: previousHash } });
    await tx.session.create({ data: { userId, tokenHash: digest(token), expiresAt: new Date(Date.now() + lifetime) } });
    await tx.session.deleteMany({ where: { userId, expiresAt: { lte: new Date() } } });
  });
  res.cookie(cookieName, token, { ...cookieOptions, maxAge: lifetime });
}

authRouter.post('/register', limiter, async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ message: 'Перевірте email, ім’я та пароль (12–128 символів).' }); return; }
  const { email, displayName, password } = parsed.data;
  let user;
  try {
    user = await prisma.user.create({ data: { email, displayName, passwordHash: await hashPassword(password) }, select: userSelect });
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') {
      res.status(409).json({ message: 'Цей email уже зареєстрований.' }); return;
    }
    throw error;
  }
  await issueSession(req, res, user.id);
  res.status(201).json({ user });
});

authRouter.post('/login', limiter, async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ message: 'Перевірте email і пароль.' }); return; }
  const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  const valid = await verifyPassword(parsed.data.password, user?.passwordHash ?? dummyHash);
  if (!user || !valid) { res.status(401).json({ message: 'Неправильний email або пароль.' }); return; }
  await issueSession(req, res, user.id);
  res.json({ user: { id: user.id, email: user.email, displayName: user.displayName } });
});

authRouter.get('/me', async (req, res) => {
  const tokenHash = sessionHash(req);
  const session = tokenHash ? await prisma.session.findUnique({ where: { tokenHash }, include: { user: { select: userSelect } } }) : null;
  if (!session || session.expiresAt <= new Date()) {
    res.clearCookie(cookieName, cookieOptions);
    res.status(401).json({ message: 'Увійдіть до облікового запису.' }); return;
  }
  res.json({ user: session.user });
});

authRouter.post('/logout', async (req, res) => {
  const tokenHash = sessionHash(req);
  if (tokenHash) await prisma.session.deleteMany({ where: { tokenHash } });
  res.clearCookie(cookieName, cookieOptions);
  res.status(204).end();
});
