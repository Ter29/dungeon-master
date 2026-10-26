import {Router,type RequestHandler} from 'express';
import {randomUUID} from 'node:crypto';
import multer from 'multer';
import {rateLimit} from 'express-rate-limit';
import {z} from 'zod';
import {prisma} from '../database/client.js';
import type {Prisma} from '../generated/prisma/client.js';
import {sessionUser} from '../auth/router.js';
import {appOrigin} from '../config/app.js';
import {SceneError} from '../scenes/state.js';
import {imageUploadSlot as uploadSlot,MAX_IMAGE_BYTES,storageAvailable,normalizeImage,uploadImage,readImage,cleanupMedia} from '../scenes/storage.js';
import {cartographyEvents,mapSummary,elementView,fragmentView,permittedElement} from './state.js';

export const cartographyRouter=Router({mergeParams:true});
const uuid=z.string().uuid(),revision=z.number().int().min(0);
const fragmentInclude={image:true} as const;
const elementInclude={fragment:{include:fragmentInclude}} as const;
const mapInclude={background:true} as const;
function parse<T>(schema:z.ZodType<T>,body:unknown):T{const result=schema.safeParse(body);if(!result.success)throw new SceneError(400,'Перевірте поля, координати й версію карти або елемента.');return result.data;}
cartographyRouter.use(async(req,res,next)=>{
 res.set('Cache-Control','no-store');const user=await sessionUser(req);if(!user)throw new SceneError(401,'Увійдіть до облікового запису.');
 const campaignId=parse(uuid,req.params.campaignId),member=await prisma.campaignMember.findUnique({where:{campaignId_userId:{campaignId,userId:user.id}}});
 if(!member)throw new SceneError(404,'Кампанію не знайдено.');
 res.locals.member=member;res.locals.campaignId=campaignId;
 if(!['GET','HEAD'].includes(req.method)){if(req.headers.origin&&req.headers.origin!==appOrigin)throw new SceneError(403,'Недозволене джерело запиту.');if(!req.is('application/json')&&!req.is('multipart/form-data'))throw new SceneError(415,'Потрібен JSON або multipart/form-data.');}next();
});
const dm:RequestHandler=(_req,res,next)=>{if(res.locals.member.role!=='DM')throw new SceneError(403,'Ця дія доступна лише DM.');next();};
const limit=rateLimit({windowMs:15*60000,limit:900,standardHeaders:'draft-8',legacyHeaders:false,message:{message:'Забагато змін карт. Зачекайте.'}});
const uploadLimit=rateLimit({windowMs:15*60000,limit:20,standardHeaders:'draft-8',legacyHeaders:false,message:{message:'Забагато завантажень. Зачекайте.'}});
const title=z.string().trim().min(1).max(120),description=z.string().trim().max(4000),number=z.number().min(0).max(10000);
const point=z.object({x:number,y:number}).strict();
const elementFields=z.object({text:z.string().max(1000),color:z.string().regex(/^#[0-9a-fA-F]{6}$/),x:number,y:number,points:z.array(point).max(128),scale:z.number().min(.05).max(10),rotation:z.number().min(-360).max(360),locked:z.boolean()});
const elementCreate=elementFields.partial().extend({kind:z.enum(['NOTE','MARKER','LINE','ROUTE','CONTOUR','FRAGMENT']),fragmentId:uuid.optional()}).strict();
const elementPatch=elementFields.partial().extend({revision}).strict();
async function locked<T>(id:string,task:(tx:Prisma.TransactionClient)=>Promise<T>){return prisma.$transaction(async tx=>{await tx.$queryRaw`SELECT id FROM "Campaign" WHERE id=${id}::uuid FOR UPDATE`;return task(tx);},{timeout:10000});}
async function mapAccess(tx:Prisma.TransactionClient,campaignId:string,id:unknown,role:string,expected?:number){
 if(!uuid.safeParse(id).success)throw new SceneError(404,'Карту не знайдено.');const map=await tx.sharedMap.findFirst({where:{id:String(id),campaignId},include:mapInclude});
 if(!map||(role!=='DM'&&!map.available))throw new SceneError(404,'Карту не знайдено.');if(expected!==undefined&&map.revision!==expected)throw new SceneError(409,'Карта вже змінилася. Оновіть дані.');return map;
}
async function fragmentAccess(tx:Prisma.TransactionClient,campaignId:string,id:unknown,role:string,expected?:number){
 if(!uuid.safeParse(id).success)throw new SceneError(404,'Фрагмент не знайдено.');const f=await tx.mapFragment.findFirst({where:{id:String(id),campaignId},include:fragmentInclude});
 if(!f||(role!=='DM'&&(!f.issued||!f.image||f.image.deletedAt)))throw new SceneError(404,'Фрагмент не знайдено.');if(expected!==undefined&&f.revision!==expected)throw new SceneError(409,'Фрагмент вже змінився. Оновіть дані.');return f;
}
function notify(id:string){cartographyEvents.emit('changed',id);}
async function bumpFragmentMaps(tx:Prisma.TransactionClient,id:string){await tx.sharedMap.updateMany({where:{elements:{some:{fragmentId:id}}},data:{dataVersion:{increment:1}}});}
function checkElement(e:{kind:string;x:number;y:number;points:{x:number;y:number}[];fragmentId:string|null},map:{width:number;height:number}){
 if(e.x>map.width||e.y>map.height||e.points.some(p=>p.x+e.x>map.width||p.y+e.y>map.height))throw new SceneError(400,'Елемент виходить за межі координат карти.');
 if(['LINE','ROUTE','CONTOUR'].includes(e.kind)){if(e.points.length<(e.kind==='CONTOUR'?3:2))throw new SceneError(400,'Замало точок контуру або маршруту.');}else if(e.points.length)throw new SceneError(400,'Точки дозволені лише для ліній, маршрутів та контурів.');
 if((e.kind==='FRAGMENT')!==Boolean(e.fragmentId))throw new SceneError(400,'Фрагмент має посилатися на виданий матеріал.');
}
cartographyRouter.get('/',async(_req,res)=>{
 const role=res.locals.member.role,id=res.locals.campaignId;
 const [maps,fragments]=await prisma.$transaction([prisma.sharedMap.findMany({where:{campaignId:id,...(role==='DM'?{}:{available:true})},include:mapInclude,orderBy:[{createdAt:'asc'},{id:'asc'}]}),prisma.mapFragment.findMany({where:{campaignId:id,...(role==='DM'?{}:{issued:true,image:{is:{deletedAt:null}}})},include:fragmentInclude,orderBy:[{createdAt:'asc'},{id:'asc'}]})]);
 res.json({maps:maps.map(mapSummary),fragments:fragments.map(fragmentView),storageAvailable:storageAvailable()});
});
cartographyRouter.post('/maps',dm,limit,async(req,res)=>{
 const data=parse(z.object({name:title,description:description.default(''),width:z.number().int().min(100).max(10000).default(2000),height:z.number().int().min(100).max(10000).default(1200),available:z.boolean().default(false)}).strict(),req.body);
 const m=await locked(res.locals.campaignId,async tx=>{if(await tx.sharedMap.count({where:{campaignId:res.locals.campaignId}})>=50)throw new SceneError(400,'Ліміт: 50 карт на кампанію.');return tx.sharedMap.create({data:{...data,campaignId:res.locals.campaignId},include:mapInclude});});notify(m.campaignId);res.status(201).json({map:{...mapSummary(m),elements:[]}});
});
cartographyRouter.get('/maps/:mapId',async(req,res)=>{
 // Repeatable read keeps the visibility decision, map version and elements consistent.
 const result=await prisma.$transaction(async tx=>{const m=await mapAccess(tx,res.locals.campaignId,req.params.mapId,res.locals.member.role);const elements=await tx.mapElement.findMany({where:{mapId:m.id},include:elementInclude,orderBy:[{createdAt:'asc'},{id:'asc'}]});return{...mapSummary(m),elements:elements.filter(e=>permittedElement(e,res.locals.member.role)).map(elementView)};},{isolationLevel:'RepeatableRead'});res.json({map:result});
});
cartographyRouter.patch('/maps/:mapId',dm,limit,async(req,res)=>{
 const data=parse(z.object({name:title.optional(),description:description.optional(),available:z.boolean().optional(),revision}).strict(),req.body);
 const m=await locked(res.locals.campaignId,async tx=>{const old=await mapAccess(tx,res.locals.campaignId,req.params.mapId,'DM',data.revision);const {revision:_,...fields}=data;return tx.sharedMap.update({where:{id:old.id},data:{...fields,revision:{increment:1},dataVersion:{increment:1}},include:mapInclude});});notify(m.campaignId);res.json({map:mapSummary(m)});
});
cartographyRouter.delete('/maps/:mapId',dm,limit,async(req,res)=>{
 const data=parse(z.object({revision}).strict(),req.body);const media=await locked(res.locals.campaignId,async tx=>{const m=await mapAccess(tx,res.locals.campaignId,req.params.mapId,'DM',data.revision);await tx.sharedMap.delete({where:{id:m.id}});if(m.backgroundId)await tx.mediaFile.update({where:{id:m.backgroundId},data:{deletedAt:new Date()}});return m.backgroundId;});notify(res.locals.campaignId);res.status(204).end();if(media)void cleanupMedia(media).catch(()=>{});
});
cartographyRouter.post('/maps/:mapId/elements',limit,async(req,res)=>{
 const data=parse(elementCreate,req.body);if(res.locals.member.role!=='DM'&&data.locked!==undefined)throw new SceneError(403,'Блокуванням керує DM.');
 const element=await locked(res.locals.campaignId,async tx=>{const m=await mapAccess(tx,res.locals.campaignId,req.params.mapId,res.locals.member.role);if(await tx.mapElement.count({where:{mapId:m.id}})>=500)throw new SceneError(400,'Ліміт: 500 елементів на карту.');
 if(data.fragmentId)await fragmentAccess(tx,m.campaignId,data.fragmentId,res.locals.member.role);
 const fields={kind:data.kind,text:data.text??'',color:data.color??'#242424',x:data.x??0,y:data.y??0,points:data.points??[],scale:data.scale??1,rotation:data.rotation??0,locked:data.locked??false,fragmentId:data.fragmentId??null};checkElement(fields,m);
 const e=await tx.mapElement.create({data:{...fields,mapId:m.id},include:elementInclude});await tx.sharedMap.update({where:{id:m.id},data:{dataVersion:{increment:1}}});return e;});notify(res.locals.campaignId);res.status(201).json({element:elementView(element)});
});
async function editable(tx:Prisma.TransactionClient,mapId:string,id:unknown,role:string,expected:number){
 if(!uuid.safeParse(id).success)throw new SceneError(404,'Елемент не знайдено.');const e=await tx.mapElement.findFirst({where:{id:String(id),mapId},include:elementInclude});if(!e||!permittedElement(e,role))throw new SceneError(404,'Елемент не знайдено.');if(role!=='DM'&&e.locked)throw new SceneError(403,'Елемент заблоковано DM.');if(e.revision!==expected)throw new SceneError(409,'Елемент вже змінився. Перезавантажте його перед редагуванням.');return e;
}
cartographyRouter.patch('/maps/:mapId/elements/:elementId',limit,async(req,res)=>{
 const data=parse(elementPatch,req.body);if(res.locals.member.role!=='DM'&&data.locked!==undefined)throw new SceneError(403,'Блокуванням керує DM.');
 const element=await locked(res.locals.campaignId,async tx=>{const m=await mapAccess(tx,res.locals.campaignId,req.params.mapId,res.locals.member.role);const e=await editable(tx,m.id,req.params.elementId,res.locals.member.role,data.revision);const {revision:_,...fields}=data;checkElement({...e,points:e.points as {x:number;y:number}[],...fields},m);
 const updated=await tx.mapElement.update({where:{id:e.id},data:{...fields,revision:{increment:1}},include:elementInclude});await tx.sharedMap.update({where:{id:m.id},data:{dataVersion:{increment:1}}});return updated;});notify(res.locals.campaignId);res.json({element:elementView(element)});
});
cartographyRouter.delete('/maps/:mapId/elements/:elementId',limit,async(req,res)=>{
 const data=parse(z.object({revision}).strict(),req.body);await locked(res.locals.campaignId,async tx=>{const m=await mapAccess(tx,res.locals.campaignId,req.params.mapId,res.locals.member.role);const e=await editable(tx,m.id,req.params.elementId,res.locals.member.role,data.revision);await tx.mapElement.delete({where:{id:e.id}});await tx.sharedMap.update({where:{id:m.id},data:{dataVersion:{increment:1}}});});notify(res.locals.campaignId);res.status(204).end();
});
cartographyRouter.post('/fragments',dm,limit,async(req,res)=>{
 const data=parse(z.object({name:title}).strict(),req.body);const f=await locked(res.locals.campaignId,async tx=>{if(await tx.mapFragment.count({where:{campaignId:res.locals.campaignId}})>=100)throw new SceneError(400,'Ліміт: 100 фрагментів на кампанію.');return tx.mapFragment.create({data:{...data,campaignId:res.locals.campaignId},include:fragmentInclude});});notify(f.campaignId);res.status(201).json({fragment:fragmentView(f)});
});
cartographyRouter.patch('/fragments/:fragmentId',dm,limit,async(req,res)=>{
 const data=parse(z.object({name:title.optional(),issued:z.boolean().optional(),revision}).strict(),req.body);const f=await locked(res.locals.campaignId,async tx=>{const old=await fragmentAccess(tx,res.locals.campaignId,req.params.fragmentId,'DM',data.revision);if(data.issued&&(!old.image||old.image.deletedAt))throw new SceneError(400,'Спочатку завантажте зображення фрагмента.');const {revision:_,...fields}=data;const updated=await tx.mapFragment.update({where:{id:old.id},data:{...fields,revision:{increment:1}},include:fragmentInclude});await bumpFragmentMaps(tx,old.id);return updated;});notify(f.campaignId);res.json({fragment:fragmentView(f)});
});
cartographyRouter.delete('/fragments/:fragmentId',dm,limit,async(req,res)=>{
 const data=parse(z.object({revision}).strict(),req.body);const image=await locked(res.locals.campaignId,async tx=>{const f=await fragmentAccess(tx,res.locals.campaignId,req.params.fragmentId,'DM',data.revision);await bumpFragmentMaps(tx,f.id);await tx.mapFragment.delete({where:{id:f.id}});if(f.imageId)await tx.mediaFile.update({where:{id:f.imageId},data:{deletedAt:new Date()}});return f.imageId;});notify(res.locals.campaignId);res.status(204).end();if(image)void cleanupMedia(image).catch(()=>{});
});
// Reuse the authenticated Cloudinary pipeline and tombstone cleanup strategy.
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:MAX_IMAGE_BYTES,files:1,fields:1,fieldSize:32,parts:2},fileFilter:(_req,file,done)=>{if(!['image/png','image/jpeg'].includes(file.mimetype))done(new SceneError(415,'Дозволено лише PNG/JPG.'));else done(null,true);}});
for(const kind of ['maps','fragments'] as const){
 const isMap=kind==='maps',path=isMap?'/maps/:objectId/background':'/fragments/:objectId/image';
 async function access(tx:Prisma.TransactionClient,campaignId:string,id:unknown,role:string,rev?:number){return isMap?mapAccess(tx,campaignId,id,role,rev):fragmentAccess(tx,campaignId,id,role,rev);}
 cartographyRouter.post(path,dm,uploadLimit,async(req,res,next)=>{await access(prisma,res.locals.campaignId,req.params.objectId,'DM');next();},uploadSlot,upload.single('file'),async(req,res)=>{
  if(!req.file)throw new SceneError(400,'Оберіть PNG/JPG-файл.');const rev=parse(z.coerce.number().int().min(0),req.body?.revision);const old=await access(prisma,res.locals.campaignId,req.params.objectId,'DM',rev);if('issued'in old&&old.issued)throw new SceneError(409,'Відкличте фрагмент перед заміною зображення.');
  const image=await normalizeImage(req.file.buffer,req.file.mimetype);const file=await prisma.mediaFile.create({data:{campaignId:res.locals.campaignId,storageKey:`dungeon-master/${res.locals.campaignId}/${randomUUID()}`,format:image.format,mimeType:image.mimeType,byteSize:image.data.length,width:image.width,height:image.height,deletedAt:new Date()}});await uploadImage(file.storageKey,image.data);
  const result=await locked(res.locals.campaignId,async tx=>{const current=await access(tx,res.locals.campaignId,req.params.objectId,'DM',rev);if('issued'in current&&current.issued)throw new SceneError(409,'Спочатку відкличте фрагмент.');await tx.mediaFile.update({where:{id:file.id},data:{deletedAt:null}});
   let oldId:string|null;if(isMap){oldId=(current as {backgroundId:string|null}).backgroundId;await tx.sharedMap.update({where:{id:current.id},data:{backgroundId:file.id,revision:{increment:1},dataVersion:{increment:1}}});}else{oldId=(current as {imageId:string|null}).imageId;await tx.mapFragment.update({where:{id:current.id},data:{imageId:file.id,revision:{increment:1}}});await bumpFragmentMaps(tx,current.id);}
   if(oldId)await tx.mediaFile.update({where:{id:oldId},data:{deletedAt:new Date()}});return oldId;
  });notify(res.locals.campaignId);res.json({ok:true});if(result)void cleanupMedia(result).catch(()=>{});
 });
 cartographyRouter.get(path+'/:mediaId',async(req,res)=>{
  async function allowed(){const member=await prisma.campaignMember.findUnique({where:{campaignId_userId:{campaignId:res.locals.campaignId,userId:res.locals.member.userId}}});if(!member)throw new SceneError(404,'Зображення не знайдено.');const object=await access(prisma,res.locals.campaignId,req.params.objectId,member.role);const file='background'in object?object.background:object.image;if(!file||file.deletedAt||file.id!==req.params.mediaId)throw new SceneError(404,'Зображення не знайдено.');return file;}
  const file=await allowed(),bytes=await readImage(file.storageKey,file.format);await allowed();res.set({'Content-Type':file.mimeType,'Content-Length':String(bytes.length),'Cache-Control':'private, no-store'});res.end(bytes);
 });
}
cartographyRouter.delete('/maps/:mapId/background',dm,limit,async(req,res)=>{
 const data=parse(z.object({revision}).strict(),req.body);const old=await locked(res.locals.campaignId,async tx=>{const m=await mapAccess(tx,res.locals.campaignId,req.params.mapId,'DM',data.revision);await tx.sharedMap.update({where:{id:m.id},data:{backgroundId:null,revision:{increment:1},dataVersion:{increment:1}}});if(m.backgroundId)await tx.mediaFile.update({where:{id:m.backgroundId},data:{deletedAt:new Date()}});return m.backgroundId;});notify(res.locals.campaignId);res.status(204).end();if(old)void cleanupMedia(old).catch(()=>{});
});
