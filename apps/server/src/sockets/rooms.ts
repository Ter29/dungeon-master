import {directorEvents,directorSnapshot} from '../director/state.js';
import {combatEvents,combatSnapshots} from '../combat/state.js';
import {cartographyEvents} from '../cartography/state.js';
import type { Server as HttpServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { Server, type Socket } from 'socket.io';
import { z } from 'zod';
import type { ClientEvents, ServerEvents, RoomState, Reply } from '@dnd/shared';
import { prisma } from '../database/client.js';
import { sessionHash } from '../auth/router.js';
import { sessionEvents } from '../auth/events.js';
import { appOrigin as origin } from '../config/app.js';
import { activeSnapshot, locationEvents } from '../scenes/state.js';

type Data = { campaignId: string; userId: string; tokenHash: string; expiresAt: Date };
type RoomSocket = Socket<ClientEvents, ServerEvents, Record<string, never>, Data>;
const point = z.object({ x: z.number().min(0).max(100), y: z.number().min(0).max(100) });
const scene = z.enum(['scene-1', 'scene-2']);
const stateSchema = z.object({ activeScene: scene, positions: z.object({ 'scene-1': point, 'scene-2': point }) });
const version = z.number().int().min(0);
const roomName = (id: string) => `campaign:${id}`;

export function createRooms(server: HttpServer) {
  const io = new Server<ClientEvents, ServerEvents, Record<string, never>, Data>(server, {
    maxHttpBufferSize: 16384,
    allowRequest: (req, done) => done(null, !req.headers.origin || req.headers.origin === origin),
  });
  // One queue per active campaign orders snapshots, joins and writes on this server.
  const queues = new Map<string, Promise<unknown>>();
  function enqueue<T>(id: string, task: () => Promise<T>): Promise<T> {
    const pending = (queues.get(id) ?? Promise.resolve()).catch(() => {}).then(task);
    queues.set(id, pending);
    void pending.finally(() => { if (queues.get(id) === pending) queues.delete(id); }).catch(() => {});
    return pending;
  }
  async function snapshot(id: string) {
    const campaign = await prisma.campaign.findUniqueOrThrow({ where: { id }, include: {
      members: { include: { user: { select: { displayName: true } } }, orderBy: { joinedAt: 'asc' } },
    } });
    const online = new Set([...io.sockets.sockets.values()].filter(s => s.rooms.has(roomName(id))).map(s => s.data.userId));
    io.to(roomName(id)).emit('room:snapshot', {
      version: campaign.version, state: stateSchema.parse(campaign.roomState),
      members: campaign.members.map(m => ({ userId: m.userId, displayName: m.user.displayName, role: m.role, online: online.has(m.userId) })),
    });
  }
  async function authorize(socket: RoomSocket) {
    const session = await prisma.session.findUnique({ where: { tokenHash: socket.data.tokenHash } });
    if (!session || session.expiresAt <= new Date()) { socket.disconnect(true); throw new Error('Сесія завершена. Увійдіть знову.'); }
    const member = await prisma.campaignMember.findUnique({ where: { campaignId_userId: { campaignId: socket.data.campaignId, userId: socket.data.userId } }, include: { user: { select: { displayName: true } } } });
    if (!member) { socket.disconnect(true); throw new Error('Доступ до кампанії відсутній.'); }
    return member;
  }
  async function publishLocation(id: string, invalidate = false) {
    const playerState = await activeSnapshot(id, 'PLAYER');
    const dmState = await activeSnapshot(id, 'DM');
    for (const socket of io.sockets.sockets.values()) {
      if (!socket.rooms.has(roomName(id))) continue;
      try {
        const member = await authorize(socket);
        socket.emit('location:snapshot', member.role === 'DM' ? dmState : playerState);
        if (invalidate && member.role === 'DM') socket.emit('locations:changed');
      } catch { socket.disconnect(true); }
    }
  }
  async function publishCombat(id:string){
    const views=await combatSnapshots(id);
    for(const socket of io.sockets.sockets.values()){
      if(!socket.rooms.has(roomName(id)))continue;
      try{const member=await authorize(socket);socket.emit('combat:snapshot',views[member.role]);}catch{socket.disconnect(true);}
    }
  }
  async function publishDirector(id:string,library=false){
    const state=await directorSnapshot(id);
    for(const socket of io.sockets.sockets.values()){
      if(!socket.rooms.has(roomName(id)))continue;
      try{const member=await authorize(socket);socket.emit('director:snapshot',state);if(library&&member.role==='DM')socket.emit('director:library-changed');}catch{socket.disconnect(true);}
    }
  }
  const onDirectorChanged=(id:string,library=false)=>{void enqueue(id,()=>publishDirector(id,library)).catch(()=>{io.to(roomName(id)).emit('room:error','Не вдалося оновити подачу. Перепідключіться.');});};
  async function publishAudio(id:string,library=false){const state=await audioSnapshot(id);for(const socket of io.sockets.sockets.values()){if(!socket.rooms.has(roomName(id)))continue;try{const member=await authorize(socket);socket.emit('audio:snapshot',state);if(library&&member.role==='DM')socket.emit('audio:library-changed');}catch{socket.disconnect(true);}}}
  // Initial/sync state belongs to the requester. Do not rebroadcast every subsystem
  // to all existing sockets on every join (quadratic authorization/database work).
  async function syncParticipant(socket:RoomSocket){
    const member=await authorize(socket),id=socket.data.campaignId;
    const [location,combat,director,audio]=await Promise.all([activeSnapshot(id,member.role),combatSnapshots(id),directorSnapshot(id),audioSnapshot(id)]);
    const current=await authorize(socket);if(current.role!==member.role){socket.disconnect(true);return;}
    socket.emit('location:snapshot',location);socket.emit('combat:snapshot',combat[current.role]);socket.emit('director:snapshot',director);socket.emit('audio:snapshot',audio);
  }
  const onAudioChanged=(id:string,library=false)=>{void enqueue(id,()=>publishAudio(id,library)).catch(()=>io.to(roomName(id)).emit('room:error','Не вдалося оновити звук.'));};
  const onAudioCue=(id:string,cue:AudioCueView)=>{void enqueue(id,async()=>{if(Date.now()>cue.at+3000)return;for(const socket of io.sockets.sockets.values()){if(!socket.rooms.has(roomName(id)))continue;try{await authorize(socket);socket.emit('audio:cue',cue);}catch{socket.disconnect(true);}}}).catch(()=>{});};
  audioEvents.on('changed',onAudioChanged);audioEvents.on('cue',onAudioCue);
  io.engine.once('close',()=>{audioEvents.off('changed',onAudioChanged);audioEvents.off('cue',onAudioCue);});
  directorEvents.on('changed',onDirectorChanged);
  io.engine.once('close',()=>directorEvents.off('changed',onDirectorChanged));
  const onCombatChanged=(id:string)=>{void enqueue(id,()=>publishCombat(id)).catch(()=>{io.to(roomName(id)).emit('room:error','Не вдалося оновити бій. Перепідключіться.');});};
  combatEvents.on('changed',onCombatChanged);
  io.engine.once('close',()=>combatEvents.off('changed',onCombatChanged));
  const onLocationsChanged = (id: string) => {
    void enqueue(id, async () => {await publishLocation(id, true);await publishCombat(id);}).catch(() => {
      io.to(roomName(id)).emit('room:error', 'Не вдалося оновити локацію. Перепідключіться.');
    });
  };
  const onCartographyChanged=(id:string)=>{void enqueue(id,async()=>{for(const socket of io.sockets.sockets.values()){if(!socket.rooms.has(roomName(id)))continue;try{await authorize(socket);socket.emit('cartography:changed');}catch{socket.disconnect(true);}}}).catch(()=>{});};
  cartographyEvents.on('changed',onCartographyChanged);
  io.engine.once('close',()=>cartographyEvents.off('changed',onCartographyChanged));
  locationEvents.on('changed', onLocationsChanged);
  io.engine.once('close', () => locationEvents.off('changed', onLocationsChanged));
  io.use(async (socket, next) => {
    try {
      const campaignId = z.string().uuid().parse(socket.handshake.auth.campaignId);
      const tokenHash = sessionHash(socket.request);
      const session = tokenHash ? await prisma.session.findUnique({ where: { tokenHash } }) : null;
      if (!session || session.expiresAt <= new Date()) { next(new Error('Увійдіть до облікового запису.')); return; }
      socket.data = { campaignId, tokenHash: tokenHash!, userId: session.userId, expiresAt: session.expiresAt };
      await authorize(socket);
      next();
    } catch { next(new Error('Не вдалося підключитися. Перевірте вхід і доступ до кампанії.')); }
  });
  io.on('connection', socket => {
    const id = socket.data.campaignId;
    let budget = 0;
    let windowStart = Date.now();
    const onRevoke = (hash: string) => { if (hash === socket.data.tokenHash) socket.disconnect(true); };
    sessionEvents.on('revoke', onRevoke);
    const expiry = setTimeout(() => socket.disconnect(true), Math.min(2147483647, Math.max(1, socket.data.expiresAt.getTime() - Date.now())));
    void enqueue(id, async () => {
      if (!socket.connected) return;
      await authorize(socket);
      await socket.join(roomName(id));
      await snapshot(id);
      await syncParticipant(socket);
    }).catch(() => { socket.emit('room:error', 'Не вдалося завантажити кімнату.'); socket.disconnect(true); });
    function command(ack: unknown, task: () => Promise<void>) {
      if (typeof ack !== 'function') return;
      const reply = ack as (reply: Reply) => void;
      if (Date.now() - windowStart > 10000) { budget = 0; windowStart = Date.now(); }
      if (++budget > 50) { reply({ ok: false, message: 'Забагато дій. Зачекайте.' }); return; }
      void enqueue(id, async () => {
        if (!socket.connected) return;
        try { await task(); reply({ ok: true }); }
        catch (error) { reply({ ok: false, message: error instanceof PublicError ? error.message : 'Не вдалося виконати дію. Перевірте з’єднання.' }); }
      });
    }
    async function update(expected: number, change: (state: RoomState) => RoomState) {
      const membership = await authorize(socket);
      if (membership.role !== 'DM') throw new PublicError('Змінювати сцену й токен може лише DM.');
      const campaign = await prisma.campaign.findUniqueOrThrow({ where: { id } });
      const state = change(stateSchema.parse(campaign.roomState));
      const result = await prisma.campaign.updateMany({ where: { id, version: expected }, data: { roomState: state, version: { increment: 1 } } });
      await snapshot(id);
      if (!result.count) throw new PublicError('Стан уже змінився. Оновлено до останньої версії; повторіть дію.');
    }
    socket.on('room:sync', ack => command(ack, async () => { await authorize(socket); await snapshot(id); await syncParticipant(socket); }));
    socket.on('location:ping', (data, ack) => command(ack, async () => {
      const parsed = z.object({sceneId:z.string().uuid(),x:z.number().min(0).max(100000),y:z.number().min(0).max(100000)}).safeParse(data);
      if(!parsed.success) throw new PublicError('Некоректний пінг.');
      const member=await authorize(socket); const state=await activeSnapshot(id);
      if(state.scene?.id!==parsed.data.sceneId || parsed.data.x>state.scene.width || parsed.data.y>state.scene.height) throw new PublicError('Локація змінилася.');
      io.to(roomName(id)).emit('location:ping',{...parsed.data,id:randomUUID(),userId:member.userId,displayName:member.user.displayName});
    }));
    socket.on('token:move', (data, ack) => command(ack, async () => {
      const parsed = point.extend({ version }).safeParse(data);
      if (!parsed.success) throw new PublicError('Некоректні координати.');
      await update(parsed.data.version, state => ({ ...state, positions: { ...state.positions, [state.activeScene]: { x: parsed.data.x, y: parsed.data.y } } }));
    }));
    socket.on('scene:change', (data, ack) => command(ack, async () => {
      const parsed = z.object({ scene, version }).safeParse(data);
      if (!parsed.success) throw new PublicError('Некоректна сцена.');
      await update(parsed.data.version, state => ({ ...state, activeScene: parsed.data.scene }));
    }));
    socket.on('player:ping', (data, ack) => command(ack, async () => {
      const parsed = point.safeParse(data);
      if (!parsed.success) throw new PublicError('Некоректні координати.');
      const member = await authorize(socket);
      io.to(roomName(id)).emit('room:ping', { ...parsed.data, userId: member.userId, displayName: member.user.displayName, id: randomUUID() });
    }));
    socket.on('disconnect', () => {
      clearTimeout(expiry); sessionEvents.off('revoke', onRevoke);
      void enqueue(id, () => snapshot(id)).catch(() => {});
    });
  });
  return io;
}
class PublicError extends Error {}
import {audioEvents,audioSnapshot} from '../audio/state.js';
import type {AudioCueView} from '@dnd/shared';
