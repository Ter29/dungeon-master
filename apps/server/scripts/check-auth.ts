import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { once } from 'node:events';
import { prisma } from '../src/database/client.js';

const email = `${randomUUID()}@example.invalid`;
const password = 'Test-password-123!';
const child = spawn(process.execPath, ['--env-file-if-exists=.env', 'dist/index.js'], {
  env: { ...process.env, PORT: '3102', NODE_ENV: 'test', APP_ORIGIN: 'http://localhost:5173' },
  stdio: ['ignore', 'pipe', 'ignore'],
});
const base = 'http://127.0.0.1:3102/api/auth';
async function call(path: string, data?: unknown, cookie?: string, origin = 'http://localhost:5173') {
  return fetch(`${base}/${path}`, {
    method: data === undefined ? 'GET' : 'POST',
    headers: { ...(data === undefined ? {} : { 'Content-Type': 'application/json', Origin: origin }), ...(cookie ? { Cookie: cookie } : {}) },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
}
function cookie(response: Response) {
  const header = response.headers.get('set-cookie');
  assert.ok(header?.includes('HttpOnly'));
  assert.ok(header.includes('SameSite=Lax'));
  return header.split(';')[0]!;
}
try {
  await Promise.race([
    once(child.stdout!, 'data'),
    new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('Startup timeout')), 10000); timer.unref(); }),
  ]);
  assert.equal((await call('me')).status, 401);
  assert.equal((await call('register', { email, displayName: 'Tester', password: 'short' })).status, 400);
  assert.equal((await call('register', { email, displayName: 'Tester', password }, undefined, 'https://foreign.invalid')).status, 403);
  let response = await call('register', { email: ` ${email.toUpperCase()} `, displayName: ' Tester ', password });
  assert.equal(response.status, 201);
  const firstCookie = cookie(response);
  const body = await response.json();
  assert.equal(body.user.email, email);
  assert.equal(body.user.displayName, 'Tester');
  assert.equal(body.user.passwordHash, undefined);
  const user = await prisma.user.findUniqueOrThrow({ where: { email }, include: { sessions: true } });
  assert.ok(user.passwordHash.startsWith('scrypt$'));
  assert.ok(!user.passwordHash.includes(password));
  const token = firstCookie.split('=')[1]!;
  assert.equal(user.sessions[0]?.tokenHash, createHash('sha256').update(token).digest('hex'));
  assert.equal((await call('me', undefined, firstCookie)).status, 200);
  assert.equal((await call('register', { email, displayName: 'Tester', password })).status, 409);
  assert.equal((await call('login', { email, password: 'incorrect-password' })).status, 401);
  assert.equal((await call('login', { email: `${randomUUID()}@example.invalid`, password })).status, 401);
  response = await call('login', { email, password }, firstCookie);
  assert.equal(response.status, 200);
  const secondCookie = cookie(response);
  assert.notEqual(firstCookie, secondCookie);
  assert.equal((await call('me', undefined, firstCookie)).status, 401);
  assert.equal((await call('me', undefined, secondCookie)).status, 200);
  assert.equal((await call('me', undefined, 'dnd_session=malformed')).status, 401);
  assert.equal((await call('logout', {}, secondCookie)).status, 204);
  assert.equal((await call('me', undefined, secondCookie)).status, 401);
  assert.equal(await prisma.session.count({ where: { userId: user.id } }), 0);
  response = await call('login', { email, password });
  const expiredCookie = cookie(response);
  await prisma.session.updateMany({ where: { userId: user.id }, data: { expiresAt: new Date(0) } });
  assert.equal((await call('me', undefined, expiredCookie)).status, 401);
  let limited = false;
  for (let i = 0; i < 35; i++) {
    if ((await call('login', {})).status === 429) { limited = true; break; }
  }
  assert.ok(limited);
  console.log('PASS: registration, normalization, validation, duplicate email, password/session hashes, login, session rotation, restoration, logout/revocation, expired/invalid cookies, origin rejection, rate limiting.');
} catch (error) {
  console.error('FAIL: authentication check', error instanceof assert.AssertionError ? error.message : 'startup, connection or request error');
  process.exitCode = 1;
} finally {
  await prisma.user.deleteMany({ where: { email } });
  await prisma.$disconnect();
  child.kill();
  console.log('Test user and sessions removed.');
}
