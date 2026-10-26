import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { io, type Socket } from 'socket.io-client';
import type { Snapshot, ClientEvents, ServerEvents } from '@dnd/shared';
import { prisma } from '../src/database/client.js';

const target = new URL(process.argv[2] ?? 'https://dungeon-master-tvra.onrender.com');
assert.equal(target.protocol, 'https:');
const origin = target.origin;
const emails: string[] = [];
const sockets: Socket<ServerEvents, ClientEvents>[] = [];
const latest = new Map<Socket<ServerEvents, ClientEvents>, Snapshot>();
let campaignId: string | undefined;
async function request(path: string, cookie?: string, data?: unknown) {
  return fetch(origin + path, { signal: AbortSignal.timeout(45000),
    ...(data === undefined ? {} : { method: 'POST', body: JSON.stringify(data) }),
    headers: { ...(cookie ? { Cookie: cookie } : {}), ...(data === undefined ? {} : { 'Content-Type': 'application/json', Origin: origin }) },
  });
}
async function waitFor(predicate: () => boolean, label: string) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > 20000) throw new Error(label);
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}
function connect(cookie: string) {
  const socket: Socket<ServerEvents, ClientEvents> = io(origin, { auth: { campaignId }, transports: ['websocket'],
    extraHeaders: { Cookie: cookie, Origin: origin }, reconnectionDelay: 200, reconnectionDelayMax: 1000 });
  socket.on('room:snapshot', snapshot => latest.set(socket, snapshot));
  sockets.push(socket); return socket;
}
try {
  assert.equal((await request('/api/ready')).status, 200);
  const html = await (await request('/campaigns')).text();
  assert.ok(html.includes('<div id="root">'));
  const clients = [];
  for (let i = 0; i < 4; i++) {
    const email = `${randomUUID()}@example.invalid`; emails.push(email);
    const response = await request('/api/auth/register', undefined, { email, displayName: `Live check ${i + 1}`, password: 'Live-test-password-123!' });
    assert.equal(response.status, 201);
    const header = response.headers.get('set-cookie')!;
    assert.ok(header.startsWith('__Host-dnd_session=')); assert.ok(header.includes('Secure')); assert.ok(header.includes('HttpOnly'));
    clients.push(header.split(';')[0]!);
  }
  let response = await request('/api/campaigns', clients[0], { name: 'Temporary public multiplayer check' });
  assert.equal(response.status, 201); campaignId = (await response.json()).campaign.id;
  response = await request(`/api/campaigns/${campaignId}/invites`, clients[0], {});
  assert.equal(response.status, 201); const invite = (await response.json()).invite;
  assert.ok(invite.url.startsWith(origin + '/join/'));
  for (const cookie of clients.slice(1)) assert.equal((await request(`/api/invites/${invite.code}/join`, cookie, {})).status, 200);
  const connected = clients.map(connect);
  await waitFor(() => connected.every(s => latest.get(s)?.members.filter(m => m.online).length === 4), 'Four-client presence');
  assert.equal((await connected[0]!.timeout(15000).emitWithAck('token:move', { x: 28, y: 64, version: 0 })).ok, true);
  await waitFor(() => connected.every(s => latest.get(s)?.version === 1 && latest.get(s)?.state.positions['scene-1'].x === 28), 'Live token broadcast');
  assert.equal((await connected[1]!.timeout(15000).emitWithAck('token:move', { x: 99, y: 99, version: 1 })).ok, false);
  let pingReceived = false; connected[0]!.once('room:ping', () => { pingReceived = true; });
  assert.equal((await connected[1]!.timeout(15000).emitWithAck('player:ping', { x: 35, y: 55 })).ok, true);
  await waitFor(() => pingReceived, 'Live player ping');
  assert.equal((await connected[0]!.timeout(15000).emitWithAck('scene:change', { scene: 'scene-2', version: 1 })).ok, true);
  await waitFor(() => connected.every(s => latest.get(s)?.state.activeScene === 'scene-2'), 'Live scene broadcast');
  const reconnecting = connected[2]!; const oldId = reconnecting.id; reconnecting.io.engine.close();
  await waitFor(() => reconnecting.connected && reconnecting.id !== oldId && latest.get(reconnecting)?.version === 2, 'Public reconnect');
  connected[3]!.disconnect();
  const refreshed = connect(clients[3]!);
  await waitFor(() => latest.get(refreshed)?.version === 2, 'Public refresh snapshot');
  assert.equal(latest.get(refreshed)?.state.positions['scene-1'].x, 28);
  console.log('PASS: public HTTPS certificate, React deep link, Secure session cookies, DM + 3 registered players, invite/join, WSS presence, token/scene synchronization, player permissions/ping, automatic reconnect and reload persistence.');
} catch (error) { console.error('FAIL:', error instanceof Error ? error.message : 'Public check failed'); process.exitCode = 1; }
finally {
  sockets.forEach(socket => socket.disconnect());
  try {
    if (campaignId) await prisma.campaign.deleteMany({ where: { id: campaignId } });
    await prisma.user.deleteMany({ where: { email: { in: emails } } });
    console.log('Temporary public-check records removed.');
  } finally { await prisma.$disconnect(); }
}
