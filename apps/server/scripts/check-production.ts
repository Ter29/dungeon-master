import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { io } from 'socket.io-client';
import { prisma } from '../src/database/client.js';

const origin = 'https://deployment-check.onrender.com';
const base = 'http://127.0.0.1:3105';
const email = `${randomUUID()}@example.invalid`;
let campaignId: string | undefined;
const child = spawn(process.execPath, ['--env-file-if-exists=.env', 'dist/index.js'], { env: {
  ...process.env, NODE_ENV: 'production', APP_ORIGIN: '', RENDER_EXTERNAL_URL: origin, RENDER: 'true', PORT: '3105',
}, stdio: ['ignore', 'pipe', 'ignore'] });
let socket: ReturnType<typeof io> | undefined;
try {
  await Promise.race([once(child.stdout!, 'data'), new Promise((_, reject) => {
    const timer = setTimeout(() => reject(new Error('Startup timeout')), 15000); timer.unref();
  })]);
  for (const path of ['/', '/register', '/campaigns/123', '/join/test']) {
    const res = await fetch(base + path, { headers: { Accept: 'text/html' } });
    assert.equal(res.status, 200); assert.ok((await res.text()).includes('<div id="root">'));
  }
  const html = await (await fetch(base)).text();
  const asset = html.match(/src="([^\"]+\.js)"/)?.[1]; assert.ok(asset);
  assert.equal((await fetch(base + asset)).status, 200);
  assert.equal((await fetch(`${base}/api/unknown`)).status, 404);
  assert.equal((await fetch(`${base}/.env`)).status, 404);
  assert.equal((await fetch(`${base}/assets/missing.js`)).status, 404);
  assert.equal((await fetch(`${base}/api/ready`)).status, 200);
  async function post(path: string, body: unknown, cookie?: string, source = origin) {
    return fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: source,
      ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });
  }
  const registration = await post('/api/auth/register', { email, displayName: 'Production check', password: 'Test-password-123!' });
  assert.equal(registration.status, 201);
  const header = registration.headers.get('set-cookie')!;
  assert.ok(header.startsWith('__Host-dnd_session=')); assert.ok(header.includes('Secure')); assert.ok(header.includes('HttpOnly'));
  const cookie = header.split(';')[0]!;
  const created = await post('/api/campaigns', { name: 'Production check' }, cookie);
  assert.equal(created.status, 201); campaignId = (await created.json()).campaign.id;
  const invite = await post(`/api/campaigns/${campaignId}/invites`, {}, cookie);
  assert.equal(invite.status, 201); assert.ok((await invite.json()).invite.url.startsWith(origin + '/join/'));
  assert.equal((await post('/api/campaigns', { name: 'Rejected' }, cookie, 'https://foreign.invalid')).status, 403);
  socket = io(base, { autoConnect: false, transports: ['websocket'], auth: { campaignId }, extraHeaders: { Cookie: cookie, Origin: origin } });
  const connected = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Socket timeout')), 12000);
    socket!.once('room:snapshot', () => { clearTimeout(timer); resolve(); });
    socket!.once('connect_error', () => { clearTimeout(timer); reject(new Error('Socket rejected')); });
  });
  socket.connect(); await connected;
  console.log('PASS: production static assets/deep links, API 404/readiness, Render origin fallback, Secure cookie, public invite URL and authenticated WebSocket. Local proxy simulation; public TLS still requires live deployment.');
} catch (error) { console.error('FAIL:', error instanceof Error ? error.message : 'Production check'); process.exitCode = 1; }
finally {
  socket?.disconnect(); child.kill();
  try {
    if (campaignId) await prisma.campaign.deleteMany({ where: { id: campaignId } });
    await prisma.user.deleteMany({ where: { email } }); console.log('Test data removed.');
  } finally { await prisma.$disconnect(); }
}
