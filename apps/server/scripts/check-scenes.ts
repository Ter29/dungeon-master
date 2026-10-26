import assert from 'node:assert/strict';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { io, type Socket } from 'socket.io-client';
import sharp from 'sharp';
import type { ClientEvents, ServerEvents, LocationSnapshot, LocationView } from '@dnd/shared';
import { prisma } from '../src/database/client.js';
import { cleanupMedia, destroyImage } from '../src/scenes/storage.js';

const liveUrl = process.argv[2];
const base = liveUrl ? new URL(liveUrl).origin : 'http://127.0.0.1:3106';
const origin = liveUrl ? base : 'http://localhost:5173';
const campaignIds: string[] = []; const userIds: string[] = [];
const sockets: Socket<ServerEvents, ClientEvents>[] = [];
const latest = new Map<Socket<ServerEvents, ClientEvents>, LocationSnapshot>();
let child: ReturnType<typeof spawn> | undefined;
async function waitFor(predicate: () => boolean, label: string) {
  const start = Date.now();
  while (!predicate()) { if (Date.now() - start > 20000) throw new Error(label); await new Promise(resolve => setTimeout(resolve, 30)); }
}
async function start() {
  if (liveUrl) return;
  child = spawn(process.execPath, ['--env-file-if-exists=.env', 'dist/index.js'], { env: { ...process.env, NODE_ENV: 'test', APP_ORIGIN: origin, PORT: '3106' }, stdio: ['ignore', 'pipe', 'ignore'] });
  let ready = false; child.stdout!.once('data', () => { ready = true; }); await waitFor(() => ready, 'Server startup');
}
async function identity() {
  const id = randomUUID(); userIds.push(id); const token = randomBytes(32).toString('base64url');
  await prisma.user.create({ data: { id, email: `${id}@example.invalid`, displayName: 'Scene check', passwordHash: 'test-only',
    sessions: { create: { tokenHash: createHash('sha256').update(token).digest('hex'), expiresAt: new Date(Date.now() + 600000) } } } });
  return { id, cookie: `${liveUrl ? '__Host-dnd_session' : 'dnd_session'}=${token}` };
}
async function call(path: string, cookie?: string, data?: unknown, method = data === undefined ? 'GET' : 'POST', source = origin) {
  return fetch(base + path, { method, signal: AbortSignal.timeout(45000), headers: {
    ...(cookie ? { Cookie: cookie } : {}), ...(data === undefined || data instanceof FormData ? {} : { 'Content-Type': 'application/json' }), Origin: source,
  }, ...(data === undefined ? {} : { body: data instanceof FormData ? data : JSON.stringify(data) }) });
}
function connect(id: string, cookie: string) {
  const socket: Socket<ServerEvents, ClientEvents> = io(base, { auth: { campaignId: id }, transports: ['websocket'], extraHeaders: { Cookie: cookie, Origin: origin } });
  socket.on('location:snapshot', data => latest.set(socket, data)); sockets.push(socket); return socket;
}
async function imageUpload(path: string, cookie: string, bytes: Buffer, mime: string, revision: number) {
  const data = new FormData(); data.set('revision', String(revision)); data.set('file', new Blob([new Uint8Array(bytes)], { type: mime }), mime === 'image/png' ? 'map.png' : 'map.jpg');
  return call(path, cookie, data);
}
try {
  const dm = await identity(), player = await identity(), outsider = await identity();
  const campaign = await prisma.campaign.create({ data: { name: 'Scene check', members: { create: [{ userId: dm.id, role: 'DM' }, { userId: player.id, role: 'PLAYER' }] } } }); campaignIds.push(campaign.id);
  const other = await prisma.campaign.create({ data: { name: 'Other scene check', members: { create: { userId: dm.id, role: 'DM' } } } }); campaignIds.push(other.id);
  await start();
  const path = `/api/campaigns/${campaign.id}/locations`;
  assert.equal((await call(path)).status, 401);
  assert.equal((await call(path, player.cookie)).status, 403);
  assert.equal((await call(path, outsider.cookie)).status, 404);
  assert.equal((await call(path, dm.cookie, { name: ' ' })).status, 400);
  assert.equal((await call(path, dm.cookie, { name: 'Rejected' }, 'POST', 'https://foreign.invalid')).status, 403);
  assert.equal((await (await call(`${path}/active`, player.cookie)).json()).scene, null);
  const master = connect(campaign.id, dm.cookie), viewer = connect(campaign.id, player.cookie);
  const isolated = connect(other.id, dm.cookie);
  await waitFor(() => sockets.every(socket => latest.has(socket)), 'Blank snapshots');
  assert.equal(latest.get(viewer)?.scene, null);
  let preparedLeaked = false; viewer.on('locations:changed', () => { preparedLeaked = true; });
  let response = await call(path, dm.cookie, { name: ' Dungeon ', description: 'Secret until active' });
  assert.equal(response.status, 201); let scene: LocationView = (await response.json()).scene;
  assert.equal(scene.name, 'Dungeon');
  assert.equal((await call(`${path}/${scene.id}`, player.cookie)).status, 403);
  assert.equal((await call(path, player.cookie, { name: 'Forbidden' })).status, 403);
  assert.equal((await call(`${path}/activate`, player.cookie, { sceneId: scene.id, version: 0 })).status, 403);
  const png = await sharp({ create: { width: 64, height: 48, channels: 3, background: '#9d7143' } }).png().toBuffer();
  assert.equal((await imageUpload(`${path}/${scene.id}/background`, player.cookie, png, 'image/png', 0)).status, 403);
  assert.equal((await imageUpload(`${path}/${scene.id}/background`, dm.cookie, Buffer.from('not PNG'), 'image/png', 0)).status, 415);
  assert.equal((await imageUpload(`${path}/${scene.id}/background`, dm.cookie, png, 'image/jpeg', 0)).status, 415);
  const oversized = Buffer.alloc(8 * 1024 * 1024 + 1);
  assert.equal((await imageUpload(`${path}/${scene.id}/background`, dm.cookie, oversized, 'image/png', 0)).status, 413);
  const huge = await sharp({ create: { width: 4500, height: 4500, channels: 3, background: '#000' } }).png().toBuffer();
  assert.equal((await imageUpload(`${path}/${scene.id}/background`, dm.cookie, huge, 'image/png', 0)).status, 415);
  response = await imageUpload(`${path}/${scene.id}/background`, dm.cookie, png, 'image/png', 0);
  assert.equal(response.status, 200); scene = (await response.json()).scene;
  assert.ok(scene.background); const firstUrl = scene.background.url;
  assert.equal((await call(firstUrl, player.cookie)).status, 404);
  const downloaded = await call(firstUrl, dm.cookie); assert.equal(downloaded.status, 200); assert.ok(downloaded.headers.get('cache-control')?.includes('no-store'));
  assert.equal((await sharp(Buffer.from(await downloaded.arrayBuffer())).metadata()).width, 64);
  assert.equal(latest.get(viewer)?.scene, null); assert.equal(preparedLeaked, false);
  response = await call(`${path}/activate`, dm.cookie, { sceneId: scene.id, version: 0 }); assert.equal(response.status, 200);
  await waitFor(() => latest.get(viewer)?.scene?.id === scene.id, 'Active scene broadcast');
  assert.equal(latest.get(isolated)?.scene, null);
  const serialized = JSON.stringify(latest.get(viewer)); assert.ok(!serialized.includes('storageKey') && !serialized.includes('cloudinary'));
  assert.equal((await call(firstUrl, player.cookie)).status, 200);
  assert.equal((await call(firstUrl, outsider.cookie)).status, 404);
  assert.equal((await call(`${path}/activate`, dm.cookie, { sceneId: scene.id, version: 0 })).status, 409);
  response = await call(`${path}/${scene.id}`, dm.cookie, { name: 'Updated dungeon', description: 'Public active description', revision: scene.revision }, 'PATCH');
  assert.equal(response.status, 200); scene = (await response.json()).scene;
  await waitFor(() => latest.get(viewer)?.scene?.name === 'Updated dungeon', 'Edited active scene broadcast');
  assert.equal((await call(`${path}/${scene.id}`, dm.cookie, { name: 'Stale', description: '', revision: 0 }, 'PATCH')).status, 409);
  const jpg = await sharp(png).jpeg().toBuffer();
  response = await imageUpload(`${path}/${scene.id}/background`, dm.cookie, jpg, 'image/jpeg', scene.revision); assert.equal(response.status, 200); scene = (await response.json()).scene;
  await waitFor(() => latest.get(viewer)?.scene?.background?.id === scene.background?.id, 'Background replacement broadcast');
  assert.equal((await call(firstUrl, dm.cookie)).status, 404);
  const refreshed = connect(campaign.id, player.cookie); await waitFor(() => latest.get(refreshed)?.scene?.id === scene.id, 'Reload snapshot');
  const oldSocketId = viewer.id; viewer.io.engine.close(); await waitFor(() => viewer.connected && viewer.id !== oldSocketId, 'Reconnect');
  assert.equal(latest.get(viewer)?.scene?.id, scene.id);
  if (!liveUrl) {
    sockets.forEach(socket => socket.disconnect());
    const stopped = new Promise(resolve => child!.once('exit', resolve)); child!.kill(); await stopped; await start();
    const restarted = connect(campaign.id, player.cookie); await waitFor(() => latest.get(restarted)?.scene?.id === scene.id, 'Restart persistence');
    assert.equal((await call(scene.background!.url, player.cookie)).status, 200);
  }
  response = await call(`${path}/activate`, dm.cookie, { sceneId: null, version: (await (await call(`${path}/active`, dm.cookie)).json()).version }); assert.equal(response.status, 200);
  assert.equal((await call(scene.background!.url, player.cookie)).status, 404);
  const otherScene = await prisma.scene.create({ data: { campaignId: other.id, name: 'Other campaign' } });
  response = await call(`${path}/activate`, dm.cookie, { sceneId: otherScene.id, version: (await (await call(`${path}/active`, dm.cookie)).json()).version }); assert.equal(response.status, 404);
  response = await call(`${path}/activate`, dm.cookie, { sceneId: scene.id, version: (await (await call(`${path}/active`, dm.cookie)).json()).version }); assert.equal(response.status, 200);
  assert.equal((await call(`${path}/${scene.id}`, player.cookie, { revision: scene.revision }, 'DELETE')).status, 403);
  assert.equal((await call(`${path}/${scene.id}`, dm.cookie, { revision: scene.revision }, 'DELETE')).status, 204);
  assert.equal((await (await call(`${path}/active`, player.cookie)).json()).scene, null);
  assert.equal((await call(`${path}/${scene.id}`, dm.cookie)).status, 404);
  const savedLegacy = await prisma.campaign.findUniqueOrThrow({ where: { id: campaign.id } }); assert.equal(savedLegacy.version, 0);
  assert.ok(savedLegacy.roomState);
  console.log(`PASS: ${liveUrl ? 'public HTTPS/WSS' : 'local + real Cloudinary/Neon'} scene CRUD, roles, private drafts/media, PNG/JPG validation/limits/replacement, version conflicts, blank/active table, campaign isolation, broadcasts, reconnect/reload${liveUrl ? '' : '/server restart'}, legacy state preservation.`);
} catch (error) { console.error('FAIL: scene check', error instanceof assert.AssertionError ? error.message : error instanceof Error ? error.message : 'unknown'); process.exitCode = 1; }
finally {
  sockets.forEach(socket => socket.disconnect()); child?.kill();
  try {
    const files = await prisma.mediaFile.findMany({ where: { campaignId: { in: campaignIds } } });
    for (const file of files) { try { await destroyImage(file.storageKey); } catch { console.error('Test image cleanup deferred'); process.exitCode = 1; } }
    await prisma.campaign.updateMany({ where: { id: { in: campaignIds } }, data: { activeLocationId: null } });
    await prisma.campaign.deleteMany({ where: { id: { in: campaignIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    console.log('Test users/campaigns/images removed.');
  } finally { await prisma.$disconnect(); }
}
