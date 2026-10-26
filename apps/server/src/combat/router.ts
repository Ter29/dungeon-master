import {Router,type RequestHandler} from 'express';
import {rateLimit} from 'express-rate-limit';
import {z} from 'zod';
import type {Prisma} from '../generated/prisma/client.js';
import {prisma} from '../database/client.js';
import {sessionUser} from '../auth/router.js';
import {appOrigin} from '../config/app.js';
import {SceneError} from '../scenes/state.js';
import {combatSnapshots,combatEvents} from './state.js';
import {advanceTurn,initiativeOrder,turnAfterRemoval} from './engine.js';
import {bumpCombat,writeOrder} from './service.js';
export const combatRouter=Router({mergeParams:true});
const uuid=z.string().uuid(),version=z.number().int().min(0),initiative=z.number().int().min(-1000).max(1000);
function parse<T>(schema:z.ZodType<T>,body:unknown):T{const value=schema.safeParse(body);if(!value.success)throw new SceneError(400,'Перевірте учасників, ініціативу та версію бою.');return value.data;}
combatRouter.use(async(req,res,next)=>{
 res.set('Cache-Control','no-store');const user=await sessionUser(req);if(!user)throw new SceneError(401,'Увійдіть до облікового запису.');const campaignId=parse(uuid,req.params.campaignId);const member=await prisma.campaignMember.findUnique({where:{campaignId_userId:{campaignId,userId:user.id}}});if(!member)throw new SceneError(404,'Кампанію не знайдено.');res.locals.member=member;res.locals.campaignId=campaignId;
 if(!['GET','HEAD'].includes(req.method)){if(req.headers.origin&&req.headers.origin!==appOrigin)throw new SceneError(403,'Недозволене джерело запиту.');if(!req.is('application/json'))throw new SceneError(415,'Потрібен JSON.');}next();
});
const dm:RequestHandler=(_req,res,next)=>{if(res.locals.member.role!=='DM')throw new SceneError(403,'Керувати боєм може лише DM.');next();};
const limit=rateLimit({windowMs:15*60000,limit:900,standardHeaders:'draft-8',legacyHeaders:false,message:{message:'Забагато дій бою. Зачекайте.'}});
async function locked<T>(id:string,task:(tx:Prisma.TransactionClient)=>Promise<T>){return prisma.$transaction(async tx=>{await tx.$queryRaw`SELECT id FROM "Campaign" WHERE id=${id}::uuid FOR UPDATE`;return task(tx);},{timeout:10000});}
async function current(tx:Prisma.TransactionClient,campaignId:string,id:unknown,expected:number){
 if(!uuid.safeParse(id).success)throw new SceneError(404,'Бій не знайдено.');const encounter=await tx.combatEncounter.findFirst({where:{id:String(id),campaignId},include:{participants:{orderBy:[{position:'asc'},{joinOrder:'asc'}]}}});if(!encounter)throw new SceneError(404,'Бій не знайдено.');if(encounter.status==='ENDED')throw new SceneError(409,'Цей бій вже завершено.');if(encounter.version!==expected)throw new SceneError(409,'Бій вже змінився. Оновіть стан і повторіть дію.');return encounter;
}
async function change(campaignId:string,task:(tx:Prisma.TransactionClient)=>Promise<void>){await locked(campaignId,async tx=>{await task(tx);await bumpCombat(tx,campaignId);});combatEvents.emit('changed',campaignId);return(await combatSnapshots(campaignId)).DM;}
combatRouter.get('/',async(_req,res)=>{const snapshots=await combatSnapshots(res.locals.campaignId);res.json(res.locals.member.role==='DM'?snapshots.DM:snapshots.PLAYER);});
combatRouter.post('/',dm,limit,async(req,res)=>{
 const data=parse(z.object({sceneId:uuid}).strict(),req.body);
 const snapshot=await change(res.locals.campaignId,async tx=>{
  if(await tx.combatEncounter.findFirst({where:{campaignId:res.locals.campaignId,status:{in:['PREPARING','ACTIVE']}}}))throw new SceneError(409,'Спочатку завершіть поточний бій або підготовку.');
  const campaign=await tx.campaign.findUniqueOrThrow({where:{id:res.locals.campaignId}}),scene=await tx.scene.findFirst({where:{id:data.sceneId,campaignId:campaign.id}});
  if(!scene)throw new SceneError(404,'Локацію не знайдено.');if(campaign.activeLocationId!==scene.id)throw new SceneError(409,'Підготуйте бій для активної локації.');
  await tx.combatEncounter.create({data:{campaignId:campaign.id,sceneId:scene.id}});
 });res.status(201).json(snapshot);
});
combatRouter.post('/:encounterId/start',dm,limit,async(req,res)=>{
 const data=parse(z.object({version}).strict(),req.body);res.json(await change(res.locals.campaignId,async tx=>{const e=await current(tx,res.locals.campaignId,req.params.encounterId,data.version);if(e.status!=='PREPARING')throw new SceneError(409,'Бій вже розпочався.');if(!e.participants.length)throw new SceneError(400,'Додайте хоча б одного учасника.');await tx.combatEncounter.update({where:{id:e.id},data:{status:'ACTIVE',round:1,currentParticipantId:e.participants[0]!.id,startedAt:new Date(),version:{increment:1}}});}));
});
combatRouter.post('/:encounterId/end',dm,limit,async(req,res)=>{
 const data=parse(z.object({version,confirm:z.literal(true)}).strict(),req.body);res.json(await change(res.locals.campaignId,async tx=>{const e=await current(tx,res.locals.campaignId,req.params.encounterId,data.version);await tx.combatEncounter.update({where:{id:e.id},data:{status:'ENDED',endedAt:new Date(),currentParticipantId:null,version:{increment:1}}});}));
});
combatRouter.post('/:encounterId/turn',dm,limit,async(req,res)=>{
 const data=parse(z.object({version,action:z.enum(['NEXT','PREVIOUS','SKIP'])}).strict(),req.body);res.json(await change(res.locals.campaignId,async tx=>{const e=await current(tx,res.locals.campaignId,req.params.encounterId,data.version);if(e.status!=='ACTIVE')throw new SceneError(409,'Спочатку почніть бій.');if(!e.participants.length)throw new SceneError(400,'У бою немає учасників.');const turn=advanceTurn(e.participants,e,data.action);await tx.combatEncounter.update({where:{id:e.id},data:{...turn,version:{increment:1}}});}));
});
combatRouter.post('/:encounterId/participants',dm,limit,async(req,res)=>{
 const data=parse(z.object({version,tokenId:uuid,initiative:initiative.default(0)}).strict(),req.body);res.status(201).json(await change(res.locals.campaignId,async tx=>{const e=await current(tx,res.locals.campaignId,req.params.encounterId,data.version);if(e.participants.length>=100)throw new SceneError(400,'Ліміт: 100 учасників бою.');const token=await tx.token.findFirst({where:{id:data.tokenId,sceneId:e.sceneId}});if(!token)throw new SceneError(404,'Токен цієї локації не знайдено.');if(e.participants.some(p=>p.tokenId===token.id))throw new SceneError(409,'Токен вже бере участь у бою.');
 const added=await tx.combatParticipant.create({data:{encounterId:e.id,tokenId:token.id,initiative:data.initiative,joinOrder:e.nextSequence,position:e.participants.length}});const roster=e.manualOrder?[...e.participants,added]:initiativeOrder([...e.participants,added]);await writeOrder(tx,roster);
 await tx.combatEncounter.update({where:{id:e.id},data:{nextSequence:{increment:1},currentParticipantId:e.status==='ACTIVE'?(e.currentParticipantId??roster[0]!.id):null,version:{increment:1}}});}));
});
combatRouter.patch('/:encounterId/participants/:participantId',dm,limit,async(req,res)=>{
 const data=parse(z.object({version,initiative}).strict(),req.body);res.json(await change(res.locals.campaignId,async tx=>{const e=await current(tx,res.locals.campaignId,req.params.encounterId,data.version);const p=e.participants.find(p=>p.id===req.params.participantId);if(!p)throw new SceneError(404,'Учасника не знайдено.');await tx.combatParticipant.update({where:{id:p.id},data:{initiative:data.initiative}});if(!e.manualOrder)await writeOrder(tx,initiativeOrder(e.participants.map(row=>row.id===p.id?{...row,initiative:data.initiative}:row)));await tx.combatEncounter.update({where:{id:e.id},data:{version:{increment:1}}});}));
});
combatRouter.delete('/:encounterId/participants/:participantId',dm,limit,async(req,res)=>{
 const data=parse(z.object({version}).strict(),req.body);res.json(await change(res.locals.campaignId,async tx=>{const e=await current(tx,res.locals.campaignId,req.params.encounterId,data.version);const p=e.participants.find(p=>p.id===req.params.participantId);if(!p)throw new SceneError(404,'Учасника не знайдено.');const turn=e.status==='ACTIVE'?turnAfterRemoval(e.participants,e,p.id):{round:e.round,currentParticipantId:null};await tx.combatEncounter.update({where:{id:e.id},data:{...turn,version:{increment:1}}});await tx.combatParticipant.delete({where:{id:p.id}});await writeOrder(tx,e.participants.filter(row=>row.id!==p.id));}));
});
combatRouter.patch('/:encounterId/order',dm,limit,async(req,res)=>{
 const data=parse(z.discriminatedUnion('mode',[z.object({mode:z.literal('initiative'),version}).strict(),z.object({mode:z.literal('manual'),version,participantIds:z.array(uuid).max(100)}).strict()]),req.body);
 res.json(await change(res.locals.campaignId,async tx=>{const e=await current(tx,res.locals.campaignId,req.params.encounterId,data.version);let roster=e.participants;if(data.mode==='manual'){if(data.participantIds.length!==roster.length||new Set(data.participantIds).size!==roster.length||data.participantIds.some(id=>!roster.some(p=>p.id===id)))throw new SceneError(400,'Порядок має містити кожного учасника рівно один раз.');roster=data.participantIds.map(id=>roster.find(p=>p.id===id)!);}else roster=initiativeOrder(roster);await writeOrder(tx,roster);await tx.combatEncounter.update({where:{id:e.id},data:{manualOrder:data.mode==='manual',version:{increment:1}}});}));
});
