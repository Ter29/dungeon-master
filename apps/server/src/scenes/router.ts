import { Router, type RequestHandler } from 'express';
import multer from 'multer';
import { rateLimit } from 'express-rate-limit';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../database/client.js';
import { sessionUser } from '../auth/router.js';
import { appOrigin } from '../config/app.js';
import { SceneError, activeSnapshot, locationEvents, sceneView, tokenView, playerCanSeeToken } from './state.js';
import {applyFog,FOG_HEX_LENGTH} from '@dnd/shared';
import { MAX_IMAGE_BYTES, cleanupMedia, normalizeImage, readImage, storageAvailable, uploadImage } from './storage.js';
import type { Prisma } from '../generated/prisma/client.js';

export const sceneRouter = Router({ mergeParams: true });
const uuid = z.string().uuid();
const revisionSchema = z.number().int().min(0);
sceneRouter.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
sceneRouter.use(async (req, res, next) => {
  const user = await sessionUser(req);
  if (!user) throw new SceneError(401, 'Увійдіть до облікового запису.');
  const parsed = uuid.safeParse(req.params.campaignId);
  if (!parsed.success) throw new SceneError(400, 'Некоректний ID кампанії.');
  const member = await prisma.campaignMember.findUnique({ where: { campaignId_userId: { campaignId: parsed.data, userId: user.id } } });
  if (!member) throw new SceneError(404, 'Кампанію не знайдено.');
  res.locals.member = member; res.locals.campaignId = parsed.data;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    if (req.headers.origin && req.headers.origin !== appOrigin) throw new SceneError(403, 'Недозволене джерело запиту.');
    if (!req.is('application/json') && !req.is('multipart/form-data')) throw new SceneError(415, 'Потрібен JSON або multipart/form-data.');
  }
  next();
});
const dm: RequestHandler = (_req, res, next) => {
  if (res.locals.member.role !== 'DM') throw new SceneError(403, 'Ця дія доступна лише DM.');
  next();
};
const validScene: RequestHandler = (req, res, next) => {
  const parsed = uuid.safeParse(req.params.sceneId);
  if (!parsed.success) throw new SceneError(400, 'Некоректний ID локації.');
  res.locals.sceneId = parsed.data; next();
};
const limit = rateLimit({ windowMs: 15 * 60000, limit: 60, standardHeaders: 'draft-8', legacyHeaders: false, message: { message: 'Забагато дій. Зачекайте.' } });
const uploadLimit = rateLimit({ windowMs: 15 * 60000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false, message: { message: 'Забагато завантажень. Зачекайте.' } });
const fields = z.object({ name: z.string().trim().min(1).max(120), description: z.string().trim().max(4000).default('') });
function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) throw new SceneError(400, 'Перевірте назву, опис і версію локації.');
  return result.data;
}
async function locked<T>(campaignId: string, task: (tx: Prisma.TransactionClient) => Promise<T>) {
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "Campaign" WHERE id = ${campaignId}::uuid FOR UPDATE`;
    return task(tx);
  }, { timeout: 10000 });
}
async function currentScene(tx: Prisma.TransactionClient, campaignId: string, id: string, revision?: number) {
  const scene = await tx.scene.findFirst({ where: { id, campaignId }, include: { background: true } });
  if (!scene) throw new SceneError(404, 'Локацію не знайдено.');
  if (revision !== undefined && scene.revision !== revision) throw new SceneError(409, 'Локація вже змінилась. Оновіть список і повторіть дію.');
  return scene;
}
async function bumpIfActive(tx: Prisma.TransactionClient, campaignId: string, sceneId: string) {
  await tx.campaign.updateMany({ where: { id: campaignId, activeLocationId: sceneId }, data: { locationVersion: { increment: 1 } } });
}
function notify(campaignId: string) { locationEvents.emit('changed', campaignId); }

sceneRouter.get('/', dm, async (_req, res) => {
  const campaign = await prisma.campaign.findUniqueOrThrow({ where: { id: res.locals.campaignId },
    include: { locations: { include: { background: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } } });
  res.json({ scenes: campaign.locations.map(sceneView), version: campaign.locationVersion, activeLocationId: campaign.activeLocationId, storageAvailable: storageAvailable() });
});
sceneRouter.get('/active', async (_req, res) => { res.json(await activeSnapshot(res.locals.campaignId, res.locals.member.role)); });
sceneRouter.post('/', dm, limit, async (req, res) => {
  const {initialFog,...data} = parse(fields.extend({initialFog:z.enum(['hidden','revealed']).default('hidden')}), req.body);
  const scene = await prisma.scene.create({ data: { ...data, fogMask:initialFog==='hidden'?'0'.repeat(FOG_HEX_LENGTH):'',campaignId: res.locals.campaignId }, include: { background: true } });
  notify(res.locals.campaignId); res.status(201).json({ scene: sceneView(scene) });
});
sceneRouter.post('/activate', dm, limit, async (req, res) => {
  const data = parse(z.object({ sceneId: uuid.nullable(), version: revisionSchema }), req.body);
  await locked(res.locals.campaignId, async tx => {
    const campaign = await tx.campaign.findUniqueOrThrow({ where: { id: res.locals.campaignId } });
    if (campaign.locationVersion !== data.version) throw new SceneError(409, 'Активна локація вже змінилась. Оновіть список.');
    if (data.sceneId) await currentScene(tx, campaign.id, data.sceneId);
    await tx.campaign.update({ where: { id: campaign.id }, data: { activeLocationId: data.sceneId, locationVersion: { increment: 1 } } });
  });
  notify(res.locals.campaignId); res.json(await activeSnapshot(res.locals.campaignId, 'DM'));
});
sceneRouter.get('/:sceneId', dm, validScene, async (_req, res) => {
  res.json({ scene: sceneView(await currentScene(prisma, res.locals.campaignId, res.locals.sceneId)) });
});
sceneRouter.patch('/:sceneId', dm, validScene, limit, async (req, res) => {
  const data = parse(fields.extend({ revision: revisionSchema }), req.body);
  const scene = await locked(res.locals.campaignId, async tx => {
    await currentScene(tx, res.locals.campaignId, res.locals.sceneId, data.revision);
    const updated = await tx.scene.update({ where: { id: res.locals.sceneId }, data: { name: data.name, description: data.description, revision: { increment: 1 } }, include: { background: true } });
    await bumpIfActive(tx, res.locals.campaignId, updated.id); return updated;
  });
  notify(res.locals.campaignId); res.json({ scene: sceneView(scene) });
});
sceneRouter.delete('/:sceneId', dm, validScene, limit, async (req, res) => {
  const data = parse(z.object({ revision: revisionSchema }), req.body);
  const oldId = await locked(res.locals.campaignId, async tx => {
    const scene = await currentScene(tx, res.locals.campaignId, res.locals.sceneId, data.revision);
    await tx.campaign.updateMany({ where: { id: scene.campaignId, activeLocationId: scene.id }, data: { activeLocationId: null, locationVersion: { increment: 1 } } });
    const tokens = await tx.token.findMany({where:{sceneId:scene.id},select:{imageId:true}});
    const ids=[scene.backgroundId,...tokens.map(token=>token.imageId)].filter((id):id is string=>Boolean(id));
    await tx.scene.delete({ where: { id: scene.id } });
    await tx.mediaFile.updateMany({where:{id:{in:ids}},data:{deletedAt:new Date()}});
    return ids;
  });
  notify(res.locals.campaignId); res.status(204).end();
  for(const id of oldId) void cleanupMedia(id).catch(() => {});
});

let uploading = false;
const uploadSlot: RequestHandler = async (_req, res, next) => {
  if (!storageAvailable()) throw new SceneError(503, 'Сховище зображень ще не налаштовано.');
  if (uploading) throw new SceneError(429, 'Інше зображення ще завантажується. Спробуйте за кілька секунд.');
  await currentScene(prisma, res.locals.campaignId, res.locals.sceneId);
  if (uploading) throw new SceneError(429, 'Інше зображення ще завантажується.');
  uploading = true;
  let released = false;
  const release = () => { if (!released) { released = true; uploading = false; } };
  res.once('finish', release); res.once('close', release); next();
};
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_IMAGE_BYTES, files: 1, fields: 1, fieldSize: 32, parts: 2 },
  fileFilter: (_req, file, callback) => {
    if (!['image/png', 'image/jpeg'].includes(file.mimetype)) callback(new SceneError(415, 'Дозволено лише PNG/JPG.'));
    else callback(null, true);
  },
});
sceneRouter.post('/:sceneId/background', dm, validScene, uploadLimit, uploadSlot, upload.single('file'), async (req, res) => {
  if (!req.file) throw new SceneError(400, 'Оберіть PNG/JPG-файл.');
  const revision = parse(z.coerce.number().int().min(0), req.body?.revision);
  await currentScene(prisma, res.locals.campaignId, res.locals.sceneId, revision);
  const image = await normalizeImage(req.file.buffer, req.file.mimetype);
  const file = await prisma.mediaFile.create({ data: { campaignId: res.locals.campaignId,
    storageKey: `dungeon-master/${res.locals.campaignId}/${randomUUID()}`, format: image.format, mimeType: image.mimeType,
    byteSize: image.data.length, width: image.width, height: image.height, deletedAt: new Date() } });
  // A tombstone exists before remote upload, so interrupted uploads remain discoverable for cleanup.
  await uploadImage(file.storageKey, image.data);
  const result = await locked(res.locals.campaignId, async tx => {
    const old = await currentScene(tx, res.locals.campaignId, res.locals.sceneId, revision);
    await tx.mediaFile.update({ where: { id: file.id }, data: { deletedAt: null } });
    const scene = await tx.scene.update({ where: { id: old.id }, data: { backgroundId: file.id, revision: { increment: 1 },...(old.backgroundId?{fogMask:'0'.repeat(FOG_HEX_LENGTH),fogRevision:{increment:1}}:{}) }, include: { background: true } });
    if (old.backgroundId) await tx.mediaFile.update({ where: { id: old.backgroundId }, data: { deletedAt: new Date() } });
    await bumpIfActive(tx, scene.campaignId, scene.id); return { scene, oldId: old.backgroundId };
  });
  notify(res.locals.campaignId); res.json({ scene: sceneView(result.scene) });
  if (result.oldId) void cleanupMedia(result.oldId).catch(() => {});
});
sceneRouter.get('/:sceneId/background/:mediaId', validScene, async (req, res) => {
  const parsed = uuid.safeParse(req.params.mediaId);
  if (!parsed.success) throw new SceneError(404, 'Зображення не знайдено.');
  async function allowed() {
    const scene = await prisma.scene.findFirst({ where: { id: res.locals.sceneId, campaignId: res.locals.campaignId, backgroundId: parsed.data }, include: { background: true, campaign: { select: { activeLocationId: true } } } });
    if (!scene?.background || scene.background.deletedAt || (res.locals.member.role !== 'DM' && scene.campaign.activeLocationId !== scene.id)) throw new SceneError(404, 'Зображення не знайдено.');
    return scene.background;
  }
  const file = await allowed(); const data = await readImage(file.storageKey, file.format);
  await allowed();
  res.set({ 'Content-Type': file.mimeType, 'Content-Length': String(data.length), 'Content-Disposition': 'inline', 'Cache-Control': 'private, no-store' });
  res.end(data);
});

// Interactive table and tokens: pixel coordinates in the original map, never screen coordinates.
const tableLimit = rateLimit({windowMs:15*60000,limit:600,standardHeaders:'draft-8',legacyHeaders:false,message:{message:'Забагато змін столу. Зачекайте.'}});
const tokenFields=z.object({name:z.string().trim().min(1).max(80),kind:z.enum(['PLAYER','NPC','ENEMY']),x:z.number().min(0).max(100000),y:z.number().min(0).max(100000),size:z.number().min(4).max(2000),hidden:z.boolean()});
async function tableAccess(campaignId:string,sceneId:string,role:string) {
  const scene=await currentScene(prisma,campaignId,sceneId);
  if(role!=='DM') {
    const campaign=await prisma.campaign.findUniqueOrThrow({where:{id:campaignId}});
    if(campaign.activeLocationId!==sceneId) throw new SceneError(404,'Локацію не знайдено.');
  }
  return scene;
}
async function findToken(tx:Prisma.TransactionClient,sceneId:string,id:string,revision?:number) {
  if(!uuid.safeParse(id).success) throw new SceneError(404,'Токен не знайдено.');
  const token=await tx.token.findFirst({where:{id,sceneId},include:{image:true}});
  if(!token) throw new SceneError(404,'Токен не знайдено.');
  if(revision!==undefined && token.revision!==revision) throw new SceneError(409,'Токен вже змінився. Оновіть дані.');
  return token;
}
function checkPosition(scene:Awaited<ReturnType<typeof currentScene>>,point:{x:number;y:number}) {
  if(point.x>(scene.background?.width??1000)||point.y>(scene.background?.height??700)) throw new SceneError(400,'Координати за межами карти.');
}
async function bumpTable(tx:Prisma.TransactionClient,campaignId:string,sceneId:string) {
  await tx.scene.update({where:{id:sceneId},data:{tableRevision:{increment:1}}});
  await bumpIfActive(tx,campaignId,sceneId);
}
sceneRouter.patch('/:sceneId/grid',dm,validScene,tableLimit,async(req,res)=>{
  const data=parse(z.object({visible:z.boolean(),size:z.number().min(8).max(1000),offsetX:z.number().min(-10000).max(10000),offsetY:z.number().min(-10000).max(10000),revision:revisionSchema}),req.body);
  const updated=await locked(res.locals.campaignId,async tx=>{
    const scene=await currentScene(tx,res.locals.campaignId,res.locals.sceneId);
    if(scene.tableRevision!==data.revision) throw new SceneError(409,'Налаштування столу змінились. Оновіть дані.');
    const result=await tx.scene.update({where:{id:scene.id},data:{gridVisible:data.visible,gridSize:data.size,gridOffsetX:data.offsetX,gridOffsetY:data.offsetY,tableRevision:{increment:1}},include:{background:true}});
    await bumpIfActive(tx,scene.campaignId,scene.id);return result;
  });notify(res.locals.campaignId);res.json({scene:sceneView(updated)});
});
sceneRouter.get('/:sceneId/tokens',validScene,async(_req,res)=>{
  const scene=await tableAccess(res.locals.campaignId,res.locals.sceneId,res.locals.member.role);
  const tokens=await prisma.token.findMany({where:{sceneId:res.locals.sceneId,...(res.locals.member.role==='DM'?{}:{hidden:false})},include:{image:true},orderBy:[{createdAt:'asc'},{id:'asc'}]});
  res.json({tokens:tokens.filter(token=>res.locals.member.role==='DM'||playerCanSeeToken(scene,token)).map(token=>tokenView(token,res.locals.campaignId))});
});
sceneRouter.get('/:sceneId/tokens/:tokenId',validScene,async(req,res)=>{
  const scene=await tableAccess(res.locals.campaignId,res.locals.sceneId,res.locals.member.role);
  const token=await findToken(prisma,res.locals.sceneId,String(req.params.tokenId));
  if(res.locals.member.role!=='DM'&&!playerCanSeeToken(scene,token)) throw new SceneError(404,'Токен не знайдено.');
  res.json({token:tokenView(token,res.locals.campaignId)});
});
sceneRouter.post('/:sceneId/tokens',dm,validScene,tableLimit,async(req,res)=>{
  const data=parse(tokenFields,req.body);
  const token=await locked(res.locals.campaignId,async tx=>{
    const scene=await currentScene(tx,res.locals.campaignId,res.locals.sceneId);checkPosition(scene,data);
    const token=await tx.token.create({data:{...data,sceneId:scene.id},include:{image:true}});
    await bumpTable(tx,scene.campaignId,scene.id);return token;
  });notify(res.locals.campaignId);res.status(201).json({token:tokenView(token,res.locals.campaignId)});
});
sceneRouter.patch('/:sceneId/tokens/:tokenId',dm,validScene,tableLimit,async(req,res)=>{
  const data=parse(tokenFields.partial().extend({revision:revisionSchema}).strict(),req.body);
  const token=await locked(res.locals.campaignId,async tx=>{
    const scene=await currentScene(tx,res.locals.campaignId,res.locals.sceneId);
    const token=await findToken(tx,scene.id,String(req.params.tokenId),data.revision);
    const {revision,...changes}=data;checkPosition(scene,{x:changes.x??token.x,y:changes.y??token.y});
    const updated=await tx.token.update({where:{id:token.id},data:{...changes,revision:{increment:1}},include:{image:true}});
    await bumpTable(tx,scene.campaignId,scene.id);return updated;
  });notify(res.locals.campaignId);res.json({token:tokenView(token,res.locals.campaignId)});
});
sceneRouter.delete('/:sceneId/tokens/:tokenId',dm,validScene,tableLimit,async(req,res)=>{
  const data=parse(z.object({revision:revisionSchema}),req.body);
  const imageId=await locked(res.locals.campaignId,async tx=>{
    const scene=await currentScene(tx,res.locals.campaignId,res.locals.sceneId);
    const token=await findToken(tx,scene.id,String(req.params.tokenId),data.revision);
    await tx.token.delete({where:{id:token.id}});
    if(token.imageId) await tx.mediaFile.update({where:{id:token.imageId},data:{deletedAt:new Date()}});
    await bumpTable(tx,scene.campaignId,scene.id);return token.imageId;
  });notify(res.locals.campaignId);res.status(204).end();if(imageId)void cleanupMedia(imageId).catch(()=>{});
});
const validToken:RequestHandler=async(req,res,next)=>{await findToken(prisma,res.locals.sceneId,String(req.params.tokenId));next();};
sceneRouter.post('/:sceneId/tokens/:tokenId/image',dm,validScene,validToken,uploadLimit,uploadSlot,upload.single('file'),async(req,res)=>{
  if(!req.file)throw new SceneError(400,'Оберіть PNG/JPG.');
  const revision=parse(z.coerce.number().int().min(0),req.body?.revision);
  await findToken(prisma,res.locals.sceneId,String(req.params.tokenId),revision);
  const image=await normalizeImage(req.file.buffer,req.file.mimetype);
  const file=await prisma.mediaFile.create({data:{campaignId:res.locals.campaignId,storageKey:`dungeon-master/${res.locals.campaignId}/${randomUUID()}`,format:image.format,mimeType:image.mimeType,byteSize:image.data.length,width:image.width,height:image.height,deletedAt:new Date()}});
  await uploadImage(file.storageKey,image.data);
  const result=await locked(res.locals.campaignId,async tx=>{
    const scene=await currentScene(tx,res.locals.campaignId,res.locals.sceneId);
    const old=await findToken(tx,scene.id,String(req.params.tokenId),revision);
    await tx.mediaFile.update({where:{id:file.id},data:{deletedAt:null}});
    const token=await tx.token.update({where:{id:old.id},data:{imageId:file.id,revision:{increment:1}},include:{image:true}});
    if(old.imageId)await tx.mediaFile.update({where:{id:old.imageId},data:{deletedAt:new Date()}});
    await bumpTable(tx,scene.campaignId,scene.id);return {token,oldId:old.imageId};
  });notify(res.locals.campaignId);res.json({token:tokenView(result.token,res.locals.campaignId)});
  if(result.oldId)void cleanupMedia(result.oldId).catch(()=>{});
});
sceneRouter.get('/:sceneId/tokens/:tokenId/image/:mediaId',validScene,async(req,res)=>{
  async function allowed(){
    const scene=await tableAccess(res.locals.campaignId,res.locals.sceneId,res.locals.member.role);
    const token=await findToken(prisma,res.locals.sceneId,String(req.params.tokenId));
    if((res.locals.member.role!=='DM'&&!playerCanSeeToken(scene,token))||token.imageId!==req.params.mediaId||!token.image||token.image.deletedAt)throw new SceneError(404,'Зображення не знайдено.');
    return token.image;
  }
  const file=await allowed();const bytes=await readImage(file.storageKey,file.format);await allowed();
  res.set({'Content-Type':file.mimeType,'Content-Length':String(bytes.length),'Cache-Control':'private, no-store'});res.end(bytes);
});

const fogPoint=z.object({x:z.number().min(0).max(100000),y:z.number().min(0).max(100000)});
const fogMode=z.enum(['reveal','hide']);
const fogOperation=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('all'),mode:fogMode}).strict(),
 z.object({kind:z.literal('rectangle'),mode:fogMode,from:fogPoint,to:fogPoint}).strict(),
 z.object({kind:z.literal('brush'),mode:fogMode,radius:z.number().min(1).max(10000),points:z.array(fogPoint).min(1).max(128)}).strict(),
]);
sceneRouter.get('/:sceneId/fog',validScene,async(_req,res)=>{
 const scene=await tableAccess(res.locals.campaignId,res.locals.sceneId,res.locals.member.role);
 res.json({fog:{revision:scene.fogRevision,bits:scene.fogMask}});
});
sceneRouter.patch('/:sceneId/fog',dm,validScene,tableLimit,async(req,res)=>{
 const data=parse(z.object({revision:revisionSchema,operations:z.array(fogOperation).min(1).max(32)}).strict(),req.body);
 const points=data.operations.reduce((sum,op)=>sum+(op.kind==='brush'?op.points.length:op.kind==='rectangle'?2:0),0);
 if(points>256)throw new SceneError(400,'Пакет містить забагато точок.');
 const fog=await locked(res.locals.campaignId,async tx=>{
  const scene=await currentScene(tx,res.locals.campaignId,res.locals.sceneId);
  if(scene.fogRevision!==data.revision)throw new SceneError(409,'Туман вже змінився. Оновлено до останнього стану; повторіть штрих.');
  const width=scene.background?.width??1000,height=scene.background?.height??700;
  for(const op of data.operations){const pts=op.kind==='brush'?op.points:op.kind==='rectangle'?[op.from,op.to]:[];for(const p of pts)if(p.x>width||p.y>height)throw new SceneError(400,'Координати за межами карти.');}
  const bits=applyFog(scene.fogMask,width,height,data.operations);
  const saved=await tx.scene.update({where:{id:scene.id},data:{fogMask:bits,fogRevision:{increment:1}},select:{fogMask:true,fogRevision:true}});
  await bumpIfActive(tx,scene.campaignId,scene.id);return{bits:saved.fogMask,revision:saved.fogRevision};
 });notify(res.locals.campaignId);res.json({fog});
});
