import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {io,type Socket} from 'socket.io-client';
import sharp from 'sharp';
import type {ClientEvents,ServerEvents,CombatSnapshot,CombatEncounterView,TokenView} from '@dnd/shared';
import {prisma} from '../src/database/client.js';
import {destroyImage} from '../src/scenes/storage.js';
const live=process.argv[2],base=live?new URL(live).origin:'http://127.0.0.1:3111',origin=live?base:'http://localhost:5173';
const users:string[]=[],campaigns:string[]=[],sockets:Socket<ServerEvents,ClientEvents>[]=[];
const latest=new Map<Socket<ServerEvents,ClientEvents>,CombatSnapshot>(),packets:string[]=[];
let child:ReturnType<typeof spawn>|undefined;
async function wait(predicate:()=>boolean,label:string){const start=Date.now();while(!predicate()){if(Date.now()-start>30000)throw new Error(label);await new Promise(r=>setTimeout(r,30));}}
async function start(){if(live)return;child=spawn(process.execPath,['--env-file-if-exists=.env','dist/index.js'],{env:{...process.env,NODE_ENV:'test',PORT:'3111',APP_ORIGIN:origin},stdio:['ignore','pipe','ignore']});let ready=false;child.stdout!.once('data',()=>{ready=true;});await wait(()=>ready,'server startup');}
async function identity(){const id=randomUUID(),token=randomBytes(32).toString('base64url');users.push(id);await prisma.user.create({data:{id,email:`${id}@example.invalid`,displayName:'Combat check',passwordHash:'test-only',sessions:{create:{tokenHash:createHash('sha256').update(token).digest('hex'),expiresAt:new Date(Date.now()+1200000)}}}});return{id,cookie:`${live?'__Host-dnd_session':'dnd_session'}=${token}`};}
async function request(path:string,cookie?:string,data?:unknown,method=data===undefined?'GET':'POST'){return fetch(base+path,{method,signal:AbortSignal.timeout(45000),headers:{Origin:origin,...(cookie?{Cookie:cookie}:{}),...(data===undefined||data instanceof FormData?{}:{'Content-Type':'application/json'})},...(data===undefined?{}:{body:data instanceof FormData?data:JSON.stringify(data)})});}
async function json<T>(path:string,cookie:string,data?:unknown,method=data===undefined?'GET':'POST',status=200):Promise<T>{const r=await request(path,cookie,data,method);assert.equal(r.status,status,`${method} ${path}: ${await r.clone().text()}`);return r.json();}
function connect(id:string,cookie:string,player=false){const s:Socket<ServerEvents,ClientEvents>=io(base,{auth:{campaignId:id},transports:['websocket'],extraHeaders:{Origin:origin,Cookie:cookie},reconnectionDelay:100});s.on('combat:snapshot',state=>latest.set(s,state));if(player)s.onAny((...args)=>packets.push(JSON.stringify(args)));sockets.push(s);return s;}
try{
 const dm=await identity(),players=[];for(let i=0;i<3;i++)players.push(await identity());const outsider=await identity();
 const campaign=await prisma.campaign.create({data:{name:'Combat integration test',members:{create:[{userId:dm.id,role:'DM'},...players.map(p=>({userId:p.id,role:'PLAYER' as const}))]}}});campaigns.push(campaign.id);
 const other=await prisma.campaign.create({data:{name:'Other combat test',members:{create:{userId:dm.id,role:'DM'}}}});campaigns.push(other.id);
 await start();const locations=`/api/campaigns/${campaign.id}/locations`,path=`/api/campaigns/${campaign.id}/combat`;
 const scene=(await json<{scene:{id:string}}>(locations,dm.cookie,{name:'Combat arena',initialFog:'revealed'},'POST',201)).scene;
 const otherScene=(await json<{scene:{id:string}}>(locations,dm.cookie,{name:'Other scene',initialFog:'revealed'},'POST',201)).scene;
 await json(locations+'/activate',dm.cookie,{sceneId:scene.id,version:0});
 const tokenPath=`${locations}/${scene.id}/tokens`;
 async function token(name:string,x:number,hidden=false){return(await json<{token:TokenView}>(tokenPath,dm.cookie,{name,kind:'ENEMY',x,y:200,size:40,hidden},'POST',201)).token;}
 const hero=await token('Hero',100),guide=await token('Guide',200);let enemy=await token('Secret combat enemy 47299',700,true);
 const png=await sharp({create:{width:32,height:32,channels:3,background:'#603b3b'}}).png().toBuffer(),form=new FormData();form.set('revision','0');form.set('file',new Blob([new Uint8Array(png)],{type:'image/png'}),'enemy.png');
 enemy=(await json<{token:TokenView}>(tokenPath+'/'+enemy.id+'/image',dm.cookie,form)).token;
 const clients=[connect(campaign.id,dm.cookie),...players.map(p=>connect(campaign.id,p.cookie,true))];await wait(()=>clients.every(s=>latest.has(s)),'DM + 3 initial combat snapshots');
 assert.equal((await request(path)).status,401);assert.equal((await request(path,outsider.cookie)).status,404);
 assert.equal((await request(path,players[0]!.cookie,{sceneId:scene.id})).status,403);
 assert.equal((await fetch(base+path,{method:'POST',headers:{Origin:'https://invalid.example',Cookie:dm.cookie,'Content-Type':'application/json'},body:JSON.stringify({sceneId:scene.id})})).status,403);
 assert.equal((await request(path,dm.cookie,{sceneId:otherScene.id})).status,409);
 const race=await Promise.all([request(path,dm.cookie,{sceneId:scene.id}),request(path,dm.cookie,{sceneId:scene.id})]);assert.deepEqual(race.map(r=>r.status).sort(),[201,409]);
 let snapshot=await json<CombatSnapshot>(path,dm.cookie),e=snapshot.encounter!;const encounterId=e.id;
 async function mutate(suffix:string,data:Record<string,unknown>={},method='POST',status=200){snapshot=await json<CombatSnapshot>(path+'/'+encounterId+suffix,dm.cookie,{version:e.version,...data},method,status);if(snapshot.encounter)e=snapshot.encounter;await wait(()=>clients.every(s=>(latest.get(s)?.version??-1)>=snapshot.version),'combat broadcast');return e;}
 assert.equal(e.status,'PREPARING');assert.equal(e.round,1);
 await assert.rejects(prisma.combatEncounter.create({data:{campaignId:campaign.id,sceneId:scene.id,status:'ACTIVE'}}),error=>Boolean(error&&typeof error==='object'&&'code'in error&&error.code==='P2002'));
 assert.equal((await request(path+'/'+e.id+'/start',dm.cookie,{version:e.version})).status,400);
 await mutate('/participants',{tokenId:hero.id,initiative:15},'POST',201);
 await mutate('/participants',{tokenId:guide.id,initiative:15},'POST',201);
 await mutate('/participants',{tokenId:enemy.id,initiative:77},'POST',201);
 assert.deepEqual(e.participants.map(p=>p.tokenId),[enemy.id,hero.id,guide.id]);
 const enemyParticipant=e.participants[0]!,heroParticipant=e.participants[1]!,guideParticipant=e.participants[2]!;
 const allowed=await json<CombatSnapshot>(path,players[0]!.cookie);assert.deepEqual(allowed.encounter!.participants.map(p=>p.tokenId),[hero.id,guide.id]);assert.deepEqual(allowed.encounter!.participants.map(p=>p.order),[0,1]);
 for(const secret of [enemy.id,enemy.name,enemyParticipant.id,enemy.image!.id]){assert.ok(!JSON.stringify(allowed).includes(secret));assert.ok(!packets.some(p=>p.includes(secret)));}
 assert.equal((await request(enemy.image!.url,players[0]!.cookie)).status,404);
 assert.equal((await request(path+'/'+e.id+'/participants',dm.cookie,{version:e.version,tokenId:hero.id})).status,409);
 assert.equal((await request(path+'/'+e.id+'/participants',dm.cookie,{version:e.version,tokenId:randomUUID()})).status,404);
 assert.equal((await request(path+'/'+e.id+'/participants',dm.cookie,{version:e.version,tokenId:hero.id,initiative:1.5})).status,400);
 await mutate('/start');assert.equal(e.status,'ACTIVE');assert.equal(e.currentParticipantId,enemyParticipant.id);
 assert.ok(clients.slice(1).every(s=>latest.get(s)?.encounter?.currentParticipantId===null));
 const writes=[['/turn',{action:'NEXT'},'POST'],['/end',{confirm:true},'POST'],['/start',{},'POST'],['/participants',{tokenId:hero.id},'POST'],['/participants/'+heroParticipant.id,{initiative:1},'PATCH'],['/participants/'+heroParticipant.id,{},'DELETE'],['/order',{mode:'initiative'},'PATCH']] as const;
 for(const [suffix,fields,method] of writes)assert.equal((await request(path+'/'+e.id+suffix,players[0]!.cookie,{version:e.version,...fields},method)).status,403);
 assert.equal((await request(`/api/campaigns/${other.id}/combat/${e.id}/turn`,dm.cookie,{version:e.version,action:'NEXT'})).status,404);
 await mutate('/turn',{action:'SKIP'});assert.equal(e.currentParticipantId,heroParticipant.id);assert.equal(e.round,1);
 await mutate('/turn',{action:'NEXT'});assert.equal(e.currentParticipantId,guideParticipant.id);
 await mutate('/turn',{action:'NEXT'});assert.equal(e.currentParticipantId,enemyParticipant.id);assert.equal(e.round,2);
 await mutate('/turn',{action:'PREVIOUS'});assert.equal(e.currentParticipantId,guideParticipant.id);assert.equal(e.round,1);
 await mutate('/turn',{action:'PREVIOUS'});await mutate('/turn',{action:'PREVIOUS'});await mutate('/turn',{action:'PREVIOUS'});assert.equal(e.currentParticipantId,enemyParticipant.id);assert.equal(e.round,1);
 const stale=e.version;await mutate('/turn',{action:'NEXT'});assert.equal((await request(path+'/'+e.id+'/turn',dm.cookie,{version:stale,action:'NEXT'})).status,409);
 const current=e.currentParticipantId;
 await mutate('/order',{mode:'manual',participantIds:[guideParticipant.id,heroParticipant.id,enemyParticipant.id]},'PATCH');assert.equal(e.manualOrder,true);assert.equal(e.currentParticipantId,current);
 await mutate('/participants/'+heroParticipant.id,{initiative:100},'PATCH');assert.deepEqual(e.participants.map(p=>p.id),[guideParticipant.id,heroParticipant.id,enemyParticipant.id]);
 assert.equal((await request(path+'/'+e.id+'/order',dm.cookie,{version:e.version,mode:'manual',participantIds:[heroParticipant.id,heroParticipant.id,enemyParticipant.id]},'PATCH')).status,400);
 await mutate('/order',{mode:'initiative'},'PATCH');assert.equal(e.manualOrder,false);assert.equal(e.participants[0]!.id,heroParticipant.id);assert.equal(e.currentParticipantId,current);
 // Additions and removals preserve the active turn until that participant is removed.
 const late=await token('Late arrival',300);await mutate('/participants',{tokenId:late.id,initiative:120},'POST',201);assert.equal(e.participants[0]!.tokenId,late.id);assert.equal(e.currentParticipantId,current);
 const lateParticipant=e.participants[0]!;await mutate('/participants/'+lateParticipant.id,{},'DELETE');assert.equal(e.currentParticipantId,current);
 await mutate('/participants/'+heroParticipant.id,{},'DELETE');assert.equal(e.currentParticipantId,enemyParticipant.id);
 await mutate('/order',{mode:'manual',participantIds:[guideParticipant.id,enemyParticipant.id]},'PATCH');const round=e.round;
 await mutate('/participants/'+enemyParticipant.id,{},'DELETE');assert.equal(e.currentParticipantId,guideParticipant.id);assert.equal(e.round,round+1);
 // Token deletion uses the same transition, not a dangling/null current with survivors.
 await mutate('/participants',{tokenId:enemy.id,initiative:9},'POST',201);
 let currentToken=await prisma.token.findUniqueOrThrow({where:{id:guide.id}});
 assert.equal((await request(tokenPath+'/'+guide.id,dm.cookie,{revision:currentToken.revision},'DELETE')).status,204);
 await wait(()=>latest.get(clients[0]!)?.encounter?.participants.length===1,'token deletion republished');snapshot=await json<CombatSnapshot>(path,dm.cookie);e=snapshot.encounter!;assert.equal(e.participants[0]!.tokenId,enemy.id);assert.equal(e.currentParticipantId,e.participants[0]!.id);
 const concurrentVersion=e.version;const turns=await Promise.all([request(path+'/'+e.id+'/turn',dm.cookie,{version:concurrentVersion,action:'NEXT'}),request(path+'/'+e.id+'/turn',dm.cookie,{version:concurrentVersion,action:'NEXT'})]);assert.deepEqual(turns.map(r=>r.status).sort(),[200,409]);snapshot=await json<CombatSnapshot>(path,dm.cookie);e=snapshot.encounter!;
 // Fog changes never toggle hidden, and a visible flag still cannot reveal a fog-covered token.
 let fogRevision=0;async function fog(mode:'hide'|'reveal'){await json(`${locations}/${scene.id}/fog`,dm.cookie,{revision:fogRevision++,operations:[{kind:'all',mode}]},'PATCH');const loc=(await prisma.campaign.findUniqueOrThrow({where:{id:campaign.id}})).locationVersion;await wait(()=>clients.every(s=>(latest.get(s)?.locationVersion??-1)>=loc),'fog refilters tracker');}
 await fog('hide');enemy=(await json<{token:TokenView}>(tokenPath+'/'+enemy.id,dm.cookie,{revision:enemy.revision,hidden:false},'PATCH')).token;
 await wait(()=>clients.every(s=>(latest.get(s)?.locationVersion??-1)>snapshot.locationVersion),'visibility snapshot');
 assert.equal((await json<CombatSnapshot>(path,players[0]!.cookie)).encounter!.participants.length,0);assert.equal((await request(enemy.image!.url,players[0]!.cookie)).status,404);
 await fog('reveal');await wait(()=>clients.slice(1).every(s=>latest.get(s)?.encounter?.participants.some(p=>p.tokenId===enemy.id)),'fog reveal shows allowed participant');
 assert.equal((await request(enemy.image!.url,players[0]!.cookie)).status,200);
 enemy=(await json<{token:TokenView}>(tokenPath+'/'+enemy.id,dm.cookie,{revision:enemy.revision,hidden:true},'PATCH')).token;
 const hiddenLoc=(await prisma.campaign.findUniqueOrThrow({where:{id:campaign.id}})).locationVersion;await wait(()=>clients.every(s=>(latest.get(s)?.locationVersion??-1)>=hiddenLoc),'hide refilters tracker');await fog('reveal');assert.equal((await prisma.token.findUniqueOrThrow({where:{id:enemy.id}})).hidden,true);
 assert.ok(clients.slice(1).every(s=>latest.get(s)?.encounter?.participants.length===0));
 const recovering=clients[2]!,oldId=recovering.id;recovering.io.engine.close();await wait(()=>recovering.connected&&recovering.id!==oldId,'auto reconnect');await wait(()=>latest.get(recovering)?.encounter?.id===encounterId,'reconnect encounter');assert.equal(latest.get(recovering)!.encounter!.participants.length,0);
 if(!live){sockets.forEach(s=>s.disconnect());const stopped=new Promise(r=>child!.once('exit',r));child!.kill();await stopped;await start();const fresh=connect(campaign.id,players[0]!.cookie,true);await wait(()=>latest.get(fresh)?.encounter?.id===encounterId,'process restart');assert.equal(latest.get(fresh)!.encounter!.round,e.round);assert.equal(latest.get(fresh)!.encounter!.participants.length,0);}
 // Switching locations hides the entire encounter from Player, preserves DM and uniqueness.
 const active=(await json<{version:number}>(locations+'/active',dm.cookie)).version;await json(locations+'/activate',dm.cookie,{sceneId:otherScene.id,version:active});assert.equal((await json<CombatSnapshot>(path,players[0]!.cookie)).encounter,null);assert.equal((await request(path,dm.cookie,{sceneId:otherScene.id})).status,409);
 await json(locations+'/activate',dm.cookie,{sceneId:scene.id,version:(await json<{version:number}>(locations+'/active',dm.cookie)).version});
 snapshot=await json<CombatSnapshot>(path,dm.cookie);e=snapshot.encounter!;
 assert.equal((await request(path+'/'+e.id+'/end',dm.cookie,{version:e.version})).status,400);
 const finalParticipant=e.participants[0]!;snapshot=await json<CombatSnapshot>(path+'/'+e.id+'/participants/'+finalParticipant.id,dm.cookie,{version:e.version},'DELETE');e=snapshot.encounter!;assert.equal(e.currentParticipantId,null);assert.equal(e.participants.length,0);
 assert.equal((await request(path+'/'+e.id+'/turn',dm.cookie,{version:e.version,action:'NEXT'})).status,400);
 await json(path+'/'+e.id+'/end',dm.cookie,{version:e.version,confirm:true});assert.equal((await json<CombatSnapshot>(path,dm.cookie)).encounter,null);assert.equal((await prisma.combatEncounter.findUniqueOrThrow({where:{id:e.id}})).status,'ENDED');
 // Reopen after completion; scene deletion must release the open encounter without breaking CRUD.
 const next=(await json<CombatSnapshot>(path,dm.cookie,{sceneId:scene.id},'POST',201)).encounter!;
 const quotaTokens=await prisma.token.createManyAndReturn({data:Array.from({length:100},()=>({sceneId:scene.id,name:'Quota participant',hidden:true}))});await prisma.combatParticipant.createMany({data:quotaTokens.map((t,i)=>({encounterId:next.id,tokenId:t.id,joinOrder:i,position:i}))});assert.equal((await request(path+'/'+next.id+'/participants',dm.cookie,{version:next.version,tokenId:hero.id})).status,400);
 const sceneRow=await prisma.scene.findUniqueOrThrow({where:{id:scene.id}});assert.equal((await request(`${locations}/${scene.id}`,dm.cookie,{revision:sceneRow.revision},'DELETE')).status,204);assert.equal(await prisma.combatEncounter.count({where:{id:next.id}}),0);assert.equal((await json<CombatSnapshot>(path,dm.cookie)).encounter,null);
 console.log(`PASS Combat: ${live?'public HTTPS/WSS':'local Neon/Cloudinary'} DM + 3 Players; preparation/start/end confirmation, unique encounter, initiative/ties/manual ordering, turns/rounds, mid-combat add/remove/token deletion, DM-only writes/stale versions, API/WS/fog/image privacy, reconnect${live?'':'/server restart'}, inactive scene isolation/deletion.`);
}catch(error){console.error('FAIL Combat:',error instanceof Error?error.stack:'unknown');process.exitCode=1;}
finally{sockets.forEach(s=>s.disconnect());child?.kill();try{for(const f of await prisma.mediaFile.findMany({where:{campaignId:{in:campaigns}}}))await destroyImage(f.storageKey);await prisma.campaign.updateMany({where:{id:{in:campaigns}},data:{activeLocationId:null}});await prisma.campaign.deleteMany({where:{id:{in:campaigns}}});await prisma.user.deleteMany({where:{id:{in:users}}});console.log('Combat fixtures and provider images removed.');}finally{await prisma.$disconnect();}}
