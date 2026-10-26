import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { prisma } from '../src/database/client.js';

const userId = randomUUID();
const rollback = new Error('intentional rollback');
const hash = () => createHash('sha256').update(randomUUID()).digest('hex');
try {
  try {
    await prisma.$transaction(async (tx) => {
      await tx.user.create({ data: {
        id: userId, email: `${userId}@example.invalid`,
        displayName: 'Database check', passwordHash: 'test-only-not-a-login',
      } });
      const campaign = await tx.campaign.create({ data: {
        name: 'Database check', members: { create: { userId, role: 'DM' } },
      }, include: { members: true } });
      assert.equal(campaign.members[0]?.role, 'DM');
      const expiresAt = new Date(Date.now() + 60000);
      await tx.session.create({ data: { userId, tokenHash: hash(), expiresAt } });
      await tx.invite.create({ data: {
        campaignId: campaign.id, createdById: userId, codeHash: hash(), expiresAt,
      } });
      const user = await tx.user.findUniqueOrThrow({
        where: { id: userId }, include: { sessions: true, memberships: true, invites: true },
      });
      assert.equal(user.sessions.length, 1);
      assert.equal(user.memberships.length, 1);
      assert.equal(user.invites.length, 1);
      throw rollback;
    }, { timeout: 15000 });
  } catch (error) {
    if (error !== rollback) throw error;
  }
  assert.equal(await prisma.user.count({ where: { id: userId } }), 0);
  console.log('PASS: create/read five models, relations, transaction rollback; no test records retained.');
} catch {
  console.error('Database check failed. Check connectivity, credentials and migrations.');
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
