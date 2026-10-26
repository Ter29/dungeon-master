import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { io, type Socket } from 'socket.io-client';
import type { Snapshot, ClientEvents, ServerEvents } from '@dnd/shared';
import { prisma } from '../src/database/client.js';

type Client = Socket<ServerEvents, ClientEvents>;
const users: string[] = [];
const campaigns: string[] = [];
const sockets: Client[] = [];
const latest = new Map<Client, Snapshot>();
let child: ReturnType<typeof spawn> | undefined;
const base = 'http://127.0.0.1:3104';
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
async function waitFor(predicate: () => boolean, message: string, timeout = 12000) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeout) throw new Error(message);
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}
async function start() {
  child = spawn(process.execPath, ['--env-file-if-exists=.env', 'dist/index.js'], {
    env: { ...process.env, PORT: '3104', NODE_ENV: 'test', APP_ORIGIN: 'http://localhost:5173' }, stdio: ['ignore', 'pipe', 'ignore'],
  });
  let started = false;
  child.stdout!.once('data', () => { started = true; });
  await waitFor(() => started, 'Server startup timeout');
}
async function identity() {
  const id = randomUUID(); users.push(id);
  const token = randomBytes(32).toString('base64url');
  await prisma.user.create({ data: { id, email: `${id}@example.invalid`, displayName: `Room tester ${users.length}`, passwordHash: 'not-a-login',
    sessions: { create: { tokenHash: hash(token), expiresAt: new Date(Date.now() + 600000) } } } });
  return { id, cookie: `dnd_session=${token}` };
}
function client(campaignId: string, cookie?: string, origin = 'http://localhost:5173') {
  const socket: Client = io(base, { autoConnect: false, auth: { campaignId }, transports: ['websocket'],
    extraHeaders: { Origin: origin, ...(cookie ? { Cookie: cookie } : {}) }, reconnectionDelay: 100, reconnectionDelayMax: 300 });
  sockets.push(socket);
  socket.on('room:snapshot', snapshot => latest.set(socket, snapshot));
  return socket;
}
async function rejected(campaignId: string, cookie?: string, origin?: string) {
  const socket = client(campaignId, cookie, origin);
  let denied = false; socket.on('connect_error', () => { denied = true; }); socket.connect();
  await waitFor(() => denied, 'Expected connection rejection');
  assert.equal(latest.has(socket), false); socket.disconnect();
}
try {
  const dm = await identity();
  const players = [];
  for (let i = 0; i < 6; i++) players.push(await identity());
  const outsider = await identity();
  const campaign = await prisma.campaign.create({ data: { name: 'Room test', members: { create: [
    { userId: dm.id, role: 'DM' }, ...players.map(p => ({ userId: p.id, role: 'PLAYER' as const })),
  ] } } }); campaigns.push(campaign.id);
  const other = await prisma.campaign.create({ data: { name: 'Isolated room', members: { create: { userId: dm.id, role: 'DM' } } } }); campaigns.push(other.id);
  await start();
  await rejected(campaign.id); await rejected(campaign.id, outsider.cookie); await rejected(campaign.id, dm.cookie, 'https://foreign.invalid');
  const master = client(campaign.id, dm.cookie);
  const clients = [master, ...players.map(p => client(campaign.id, p.cookie))];
  clients.forEach(s => s.connect());
  await waitFor(() => clients.every(s => latest.get(s)?.members.filter(m => m.online).length === 7), 'Seven-user presence');
  const isolated = client(other.id, dm.cookie); isolated.connect();
  await waitFor(() => latest.has(isolated), 'Isolated snapshot');
  let reply = await master.timeout(10000).emitWithAck('token:move', { x: 23, y: 71, version: 0 }); assert.equal(reply.ok, true);
  await waitFor(() => clients.every(s => latest.get(s)?.version === 1), 'Token broadcast');
  assert.ok(clients.every(s => latest.get(s)?.state.positions['scene-1'].x === 23));
  assert.equal(latest.get(isolated)?.version, 0);
  reply = await clients[1]!.timeout(10000).emitWithAck('token:move', { x: 99, y: 99, version: 1 }); assert.equal(reply.ok, false);
  reply = await master.timeout(10000).emitWithAck('token:move', { x: -1, y: 10, version: 1 }); assert.equal(reply.ok, false);
  reply = await master.timeout(10000).emitWithAck('token:move', { x: 99, y: 99, version: 0 }); assert.equal(reply.ok, false);
  let pings = 0; clients.forEach(s => s.on('room:ping', () => pings++));
  reply = await clients[1]!.timeout(10000).emitWithAck('player:ping', { x: 33, y: 44 }); assert.equal(reply.ok, true);
  await waitFor(() => pings === 7, 'Ping broadcast');
  assert.equal((await prisma.campaign.findUniqueOrThrow({ where: { id: campaign.id } })).version, 1);
  reply = await master.timeout(10000).emitWithAck('scene:change', { scene: 'scene-2', version: 1 }); assert.equal(reply.ok, true);
  await waitFor(() => clients.every(s => latest.get(s)?.state.activeScene === 'scene-2'), 'Scene broadcast');
  const tab = client(campaign.id, players[0]!.cookie); tab.connect(); await waitFor(() => latest.has(tab), 'Second tab');
  clients[1]!.disconnect();
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.equal(latest.get(master)?.members.find(m => m.userId === players[0]!.id)?.online, true);
  tab.disconnect();
  await waitFor(() => latest.get(master)?.members.find(m => m.userId === players[0]!.id)?.online === false, 'Offline presence');
  const recovering = clients[2]!;
  const beforeId = recovering.id; recovering.io.engine.close();
  await waitFor(() => recovering.connected && recovering.id !== beforeId && latest.get(recovering)?.version === 2, 'Automatic reconnect');
  const logout = await fetch(`${base}/api/auth/logout`, { method: 'POST', headers: { Cookie: players[2]!.cookie, Origin: 'http://localhost:5173', 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(logout.status, 204);
  await waitFor(() => !clients[3]!.connected, 'Logout disconnect');
  sockets.forEach(s => s.disconnect());
  const closed = new Promise<void>(resolve => child!.once('exit', () => resolve())); child!.kill(); await closed;
  await start();
  const restored = client(campaign.id, dm.cookie); restored.connect();
  await waitFor(() => latest.has(restored), 'Restart snapshot');
  assert.equal(latest.get(restored)?.version, 2);
  assert.equal(latest.get(restored)?.state.activeScene, 'scene-2');
  assert.equal(latest.get(restored)?.state.positions['scene-1'].x, 23);
  console.log('PASS: DM + six players, room isolation, authentication/origin, presence/multiple tabs, DM-only writes, version conflict, validation, pings, scene synchronization, automatic reconnect, logout revocation, server restart persistence.');
} catch (error) {
  console.error('FAIL:', error instanceof Error ? error.message : 'Room check failed'); process.exitCode = 1;
} finally {
  sockets.forEach(s => s.disconnect()); child?.kill();
  try { await prisma.campaign.deleteMany({ where: { id: { in: campaigns } } }); await prisma.user.deleteMany({ where: { id: { in: users } } }); console.log('Test data removed.'); }
  finally { await prisma.$disconnect(); }
}
