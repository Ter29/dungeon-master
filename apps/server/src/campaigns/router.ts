import { Router, type RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../database/client.js';
import { sessionUser } from '../auth/router.js';
import { appOrigin as origin } from '../config/app.js';

const uuid = z.string().uuid();
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export const campaignRouter = Router();
campaignRouter.use((req, _res, next) => next(/^\/(campaigns|invites)(\/|$)/.test(req.path) ? undefined : 'router'));
campaignRouter.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
campaignRouter.use(async (req, res, next) => {
  const user = await sessionUser(req);
  if (!user) { res.status(401).json({ message: 'Увійдіть до облікового запису.' }); return; }
  res.locals.userId = user.id;
  if (req.method !== 'GET') {
    if (req.headers.origin && req.headers.origin !== origin) { res.status(403).json({ message: 'Недозволене джерело запиту.' }); return; }
    if (!req.is('application/json')) { res.status(415).json({ message: 'Потрібен application/json.' }); return; }
  }
  next();
});
const mutations = rateLimit({ windowMs: 15 * 60000, limit: 60, standardHeaders: 'draft-8', legacyHeaders: false,
  message: { message: 'Забагато запитів. Спробуйте пізніше.' } });
const member: RequestHandler = async (req, res, next) => {
  const parsed = uuid.safeParse(req.params.campaignId);
  if (!parsed.success) { res.status(400).json({ message: 'Некоректний ID кампанії.' }); return; }
  const membership = await prisma.campaignMember.findUnique({ where: { campaignId_userId: { campaignId: parsed.data, userId: res.locals.userId } } });
  if (!membership) { res.status(404).json({ message: 'Кампанію не знайдено.' }); return; }
  res.locals.membership = membership;
  next();
};
const dm: RequestHandler = (_req, res, next) => {
  if (res.locals.membership.role !== 'DM') { res.status(403).json({ message: 'Ця дія доступна лише DM.' }); return; }
  next();
};

campaignRouter.get('/campaigns', async (_req, res) => {
  const memberships = await prisma.campaignMember.findMany({ where: { userId: res.locals.userId },
    include: { campaign: { select: { id: true, name: true } } }, orderBy: { joinedAt: 'desc' } });
  res.json({ campaigns: memberships.map(m => ({ ...m.campaign, role: m.role })) });
});
campaignRouter.post('/campaigns', mutations, async (req, res) => {
  const parsed = z.object({ name: z.string().trim().min(1).max(120) }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ message: 'Назва має містити 1–120 символів.' }); return; }
  const campaign = await prisma.campaign.create({ data: { name: parsed.data.name,
    members: { create: { userId: res.locals.userId, role: 'DM' } } }, select: { id: true, name: true } });
  res.status(201).json({ campaign: { ...campaign, role: 'DM' } });
});
campaignRouter.get('/campaigns/:campaignId', member, async (_req, res) => {
  const campaign = await prisma.campaign.findUniqueOrThrow({ where: { id: res.locals.membership.campaignId }, select: {
    id: true, name: true, members: { select: { userId: true, role: true, user: { select: { displayName: true } } }, orderBy: { joinedAt: 'asc' } },
  } });
  res.json({ campaign: { id: campaign.id, name: campaign.name, role: res.locals.membership.role,
    members: campaign.members.map(m => ({ userId: m.userId, role: m.role, displayName: m.user.displayName })) } });
});
campaignRouter.get('/campaigns/:campaignId/invites', member, dm, async (_req, res) => {
  const invites = await prisma.invite.findMany({ where: { campaignId: res.locals.membership.campaignId },
    select: { id: true, createdAt: true, expiresAt: true, revokedAt: true }, orderBy: { createdAt: 'desc' } });
  res.json({ invites });
});
campaignRouter.post('/campaigns/:campaignId/invites', mutations, member, dm, async (_req, res) => {
  const code = randomBytes(32).toString('base64url');
  const invite = await prisma.invite.create({ data: { campaignId: res.locals.membership.campaignId,
    createdById: res.locals.userId, codeHash: hash(code), expiresAt: new Date(Date.now() + 7 * 86400000) },
    select: { id: true, expiresAt: true } });
  res.status(201).json({ invite: { ...invite, code, url: new URL(`/join/${code}`, origin).href } });
});
campaignRouter.post('/campaigns/:campaignId/invites/:inviteId/revoke', member, dm, async (req, res) => {
  const parsed = uuid.safeParse(req.params.inviteId);
  if (!parsed.success) { res.status(400).json({ message: 'Некоректний ID запрошення.' }); return; }
  const found = await prisma.$transaction(async tx => {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Invite" WHERE id = ${parsed.data}::uuid AND "campaignId" = ${res.locals.membership.campaignId}::uuid FOR UPDATE`;
    if (!rows.length) return false;
    await tx.invite.updateMany({ where: { id: parsed.data, revokedAt: null }, data: { revokedAt: new Date() } });
    return true;
  });
  if (!found) { res.status(404).json({ message: 'Запрошення не знайдено.' }); return; }
  res.status(204).end();
});
campaignRouter.post('/invites/:code/join', mutations, async (req, res) => {
  const parsed = z.string().regex(/^[A-Za-z0-9_-]{43}$/).safeParse(req.params.code);
  if (!parsed.success) { res.status(404).json({ message: 'Запрошення недійсне або прострочене.' }); return; }
  const campaign = await prisma.$transaction(async tx => {
    const codeHash = hash(parsed.data);
    await tx.$queryRaw`SELECT id FROM "Invite" WHERE "codeHash" = ${codeHash} FOR UPDATE`;
    const invite = await tx.invite.findUnique({ where: { codeHash }, include: { campaign: { select: { id: true, name: true } } } });
    if (!invite || invite.revokedAt || invite.expiresAt <= new Date()) return null;
    const membership = await tx.campaignMember.upsert({ where: { campaignId_userId: { campaignId: invite.campaignId, userId: res.locals.userId } },
      create: { campaignId: invite.campaignId, userId: res.locals.userId, role: 'PLAYER' }, update: {} });
    return { ...invite.campaign, role: membership.role };
  }, { timeout: 10000 });
  if (!campaign) { res.status(404).json({ message: 'Запрошення недійсне або прострочене.' }); return; }
  res.json({ campaign });
});
