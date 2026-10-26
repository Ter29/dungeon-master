import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { once } from 'node:events';
import { prisma } from '../src/database/client.js';

const emails = [0, 1, 2].map(() => `${randomUUID()}@example.invalid`);
const campaignIds: string[] = [];
const child = spawn(process.execPath, ['--env-file-if-exists=.env', 'dist/index.js'], {
  env: { ...process.env, PORT: '3103', NODE_ENV: 'test', APP_ORIGIN: 'http://localhost:5173' }, stdio: ['ignore', 'pipe', 'ignore'],
});
async function call(path: string, cookie?: string, data?: unknown, origin = 'http://localhost:5173') {
  return fetch(`http://127.0.0.1:3103/api${path}`, { method: data === undefined ? 'GET' : 'POST',
    headers: { ...(cookie ? { Cookie: cookie } : {}), ...(data === undefined ? {} : { 'Content-Type': 'application/json', Origin: origin }) },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
}
async function register(email: string) {
  const response = await call('/auth/register', undefined, { email, displayName: 'Campaign check', password: 'Test-password-123!' });
  assert.equal(response.status, 201);
  return { cookie: response.headers.get('set-cookie')!.split(';')[0]!, id: (await response.json()).user.id as string };
}
try {
  await Promise.race([once(child.stdout!, 'data'), new Promise((_, reject) => {
    const timer = setTimeout(() => reject(new Error('Startup timeout')), 10000); timer.unref();
  })]);
  assert.equal((await call('/health')).status, 200);
  assert.equal((await call('/campaigns')).status, 401);
  const [dm, player, outsider] = await Promise.all(emails.map(register));
  assert.ok(dm && player && outsider);
  assert.equal((await call('/campaigns', dm.cookie, { name: '   ' })).status, 400);
  assert.equal((await call('/campaigns', dm.cookie, { name: 'Rejected' }, 'https://foreign.invalid')).status, 403);
  let response = await call('/campaigns', dm.cookie, { name: ' Campaign check ' });
  assert.equal(response.status, 201);
  const campaign = (await response.json()).campaign;
  campaignIds.push(campaign.id);
  assert.equal(campaign.role, 'DM'); assert.equal(campaign.name, 'Campaign check');
  assert.equal(await prisma.campaignMember.count({ where: { campaignId: campaign.id, userId: dm.id, role: 'DM' } }), 1);
  assert.equal((await (await call('/campaigns', outsider.cookie)).json()).campaigns.length, 0);
  assert.equal((await call(`/campaigns/${campaign.id}`, outsider.cookie)).status, 404);
  assert.equal((await call('/campaigns/invalid', dm.cookie)).status, 400);
  response = await call(`/campaigns/${campaign.id}/invites`, dm.cookie, {});
  assert.equal(response.status, 201);
  const invite = (await response.json()).invite;
  assert.equal(invite.url, `http://localhost:5173/join/${invite.code}`);
  const stored = await prisma.invite.findUniqueOrThrow({ where: { id: invite.id } });
  assert.equal(stored.codeHash, createHash('sha256').update(invite.code).digest('hex'));
  assert.notEqual(stored.codeHash, invite.code);
  const joins = await Promise.all([0, 1].map(() => call(`/invites/${invite.code}/join`, player.cookie, {})));
  assert.ok(joins.every(r => r.status === 200));
  assert.equal((await joins[0]!.json()).campaign.role, 'PLAYER');
  assert.equal(await prisma.campaignMember.count({ where: { campaignId: campaign.id, userId: player.id } }), 1);
  assert.equal((await (await call(`/invites/${invite.code}/join`, dm.cookie, {})).json()).campaign.role, 'DM');
  const listed = (await (await call('/campaigns', player.cookie)).json()).campaigns;
  assert.equal(listed[0].id, campaign.id); assert.equal(listed[0].role, 'PLAYER');
  const details = (await (await call(`/campaigns/${campaign.id}`, player.cookie)).json()).campaign;
  assert.equal(details.members.length, 2); assert.ok(details.members.every((m: Record<string, unknown>) => !('email' in m)));
  assert.equal((await call(`/campaigns/${campaign.id}/invites`, player.cookie, {})).status, 403);
  assert.equal((await call(`/campaigns/${campaign.id}/invites`, player.cookie)).status, 403);
  assert.equal((await call(`/campaigns/${campaign.id}/invites/${invite.id}/revoke`, player.cookie, {})).status, 403);
  const visibleInvites = (await (await call(`/campaigns/${campaign.id}/invites`, dm.cookie)).json()).invites;
  assert.ok(!('codeHash' in visibleInvites[0])); assert.ok(!('code' in visibleInvites[0]));
  assert.equal((await call(`/campaigns/${campaign.id}/invites/${invite.id}/revoke`, dm.cookie, {})).status, 204);
  assert.equal((await call(`/campaigns/${campaign.id}/invites/${invite.id}/revoke`, dm.cookie, {})).status, 204);
  assert.equal((await call(`/invites/${invite.code}/join`, outsider.cookie, {})).status, 404);
  assert.equal((await call(`/campaigns/${campaign.id}`, player.cookie)).status, 200);
  response = await call(`/campaigns/${campaign.id}/invites`, dm.cookie, {});
  const expired = (await response.json()).invite;
  await prisma.invite.update({ where: { id: expired.id }, data: { expiresAt: new Date(0) } });
  assert.equal((await call(`/invites/${expired.code}/join`, outsider.cookie, {})).status, 404);
  assert.equal((await call('/invites/invalid/join', player.cookie, {})).status, 404);
  assert.equal((await call(`/invites/${expired.code}/join`, undefined, {})).status, 401);
  console.log('PASS: atomic creation/DM role, scoped lists, membership privacy, invite hash/link, concurrent idempotent joins, role preservation, DM permissions, revocation, expiration, origin and input validation.');
} catch (error) {
  console.error('FAIL: campaigns check', error instanceof assert.AssertionError ? error.message : 'startup, database or request error');
  process.exitCode = 1;
} finally {
  try {
    await prisma.campaign.deleteMany({ where: { id: { in: campaignIds } } });
    await prisma.user.deleteMany({ where: { email: { in: emails } } });
    console.log('Test campaigns, invites, users and sessions removed.');
  } finally { await prisma.$disconnect(); child.kill(); }
}
