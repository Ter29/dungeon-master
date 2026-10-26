import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {io,type Socket} from 'socket.io-client';
import sharp from 'sharp';
import type {ClientEvents,ServerEvents,LocationSnapshot,TokenView} from '@dnd/shared';
import {prisma} from '../src/database/client.js';
import {destroyImage} from '../src/scenes/storage.js';
const live=process.argv[2],base=live?new URL(live).origin:'http://127.0.0.1:3109',origin=live?base:'http://localhost:5173';
const users:string[]=[],campaigns:string[]=[],sockets:Socket<ServerEvents,ClientEvents>[]=[];
const latest=new Map<Socket<ServerEvents,ClientEvents>,LocationSnapshot>();
let child:ReturnType<typeof spawn>|undefined;
async function wait(predicate:()=>boolean,label:string){const start=Date.now();while(!predicate()){if(Date.now()-start>20000)throw new Error(label);await new Promise(r=>setTimeout(r,25));}}
async function start(){if(live)return;child=spawn(process.execPath,['--env-file-if-exists=.env','dist/index.js'],{env:{...process.env,NODE_ENV:'test',PORT:'3109',APP_ORIGIN:origin},stdio:['ignore','pipe','ignore']});let ready=false;child.stdout!.once('data',()=>{ready=true;});await wait(()=>ready,'Server startup');}
async function identity(){const id=randomUUID(),token=randomBytes(32).toString('base64url');users.push(id);await prisma.user.create({data:{id,email:`${id}@example.invalid`,displayName:'Token check',passwordHash:'test-only',sessions:{create:{tokenHash:createHash('sha256').update(token).digest('hex'),expiresAt:new Date(Date.now()+600000)}}}});return{id,cookie:`${live?'__Host-dnd_session':'dnd_session'}=${token}`};}
async function request(path:string,cookie?:string,data?:unknown,method=data===undefined?'GET':'POST'){return fetch(base+path,{method,signal:AbortSignal.timeout(45000),headers:{Origin:origin,...(cookie?{Cookie:cookie}:{}),...(data===undefined||data instanceof FormData?{}:{'Content-Type':'application/json'})},...(data===undefined?{}:{body:data instanceof FormData?data:JSON.stringify(data)})});}
function connect(id:string,cookie:string){const socket:Socket<ServerEvents,ClientEvents>=io(base,{auth:{campaignId:id},transports:['websocket'],extraHeaders:{Origin:origin,Cookie:cookie},reconnectionDelay:100});socket.on('location:snapshot',snapshot=>latest.set(socket,snapshot));sockets.push(socket);return socket;}
try{
 const dm=await identity(),players=[];for(let i=0;i<3;i++)players.push(await identity());const outsider=await identity();
 const campaign=await prisma.campaign.create({data:{name:'Token test',members:{create:[{userId:dm.id,role:'DM'},...players.map(p=>({userId:p.id,role:'PLAYER' as const}))]}}});campaigns.push(campaign.id);
 const other=await prisma.campaign.create({data:{name:'Other token test',members:{create:{userId:dm.id,role:'DM'}}}});campaigns.push(other.id);
 await start();const locations=`/api/campaigns/${campaign.id}/locations`;
 let response=await request(locations,dm.cookie,{name:'Fog arena'});assert.equal(response.status,201);let scene=(await response.json()).scene;
 const png=await sharp({create:{width:640,height:400,channels:3,background:'#72624a'}}).png().toBuffer();
 const form=new FormData();form.set('revision','0');form.set('file',new Blob([new Uint8Array(png)],{type:'image/png'}),'map.png');
 response=await request(`${locations}/${scene.id}/background`,dm.cookie,form);assert.equal(response.status,200);scene=(await response.json()).scene;
 assert.equal((await request(`${locations}/activate`,dm.cookie,{sceneId:scene.id,version:0})).status,200);
 const clients=[connect(campaign.id,dm.cookie),...players.map(p=>connect(campaign.id,p.cookie))];
 await wait(()=>clients.every(s=>latest.get(s)?.scene?.id===scene.id),'Four-client scene');
 const packets:string[]=[];clients.slice(1).forEach(s=>s.onAny((...args)=>packets.push(JSON.stringify(args))));
 const path=`${locations}/${scene.id}/tokens`;
 const fields={name:'Hero',kind:'PLAYER',x:100,y:100,size:40,hidden:false};
 assert.equal((await request(path,undefined,fields)).status,401);
 assert.equal((await request(path,players[0]!.cookie,fields)).status,403);
 assert.equal((await request(path,outsider.cookie)).status,404);
 assert.equal((await request(path,dm.cookie,{...fields,x:641})).status,400);
 response=await request(path,dm.cookie,fields);assert.equal(response.status,201);let hero:TokenView=(await response.json()).token;
 response=await request(path,dm.cookie,{...fields,name:'Secret enemy 991',kind:'ENEMY',x:250,hidden:true});assert.equal(response.status,201);let enemy:TokenView=(await response.json()).token;
 response=await request(path,dm.cookie,{...fields,name:'Guide',kind:'NPC',x:200});assert.equal(response.status,201);const guide:TokenView=(await response.json()).token;
 const tokenImage=new FormData();tokenImage.set('revision','0');tokenImage.set('file',new Blob([new Uint8Array(png)],{type:'image/png'}),'enemy.png');
 response=await request(`${path}/${enemy.id}/image`,dm.cookie,tokenImage);assert.equal(response.status,200);enemy=(await response.json()).token;assert.ok(enemy.image);
 await wait(()=>latest.get(clients[0]!)?.scene?.tokens.length===3,'DM sees three tokens');
 assert.ok(clients.slice(1).every(s=>latest.get(s)?.scene?.tokens.every(t=>t.id!==enemy.id)));
 assert.ok(!packets.some(packet=>packet.includes(enemy.id)||packet.includes(enemy.name)||packet.includes(enemy.image!.id)));
 assert.ok(clients.slice(1).every(s=>latest.get(s)?.scene?.tokens.length===0));
 assert.ok(!packets.some(packet=>packet.includes(hero.id)));
 assert.equal((await request(path,players[0]!.cookie)).status,200);
 assert.equal((await (await request(path,players[0]!.cookie)).json()).tokens.length,0);
 assert.equal((await request(path+'/'+hero.id,players[0]!.cookie)).status,404);
 const fogPath=locations+'/'+scene.id+'/fog';
 let fogRevision=0;
 async function fog(operations:unknown[]){const r=await request(fogPath,dm.cookie,{revision:fogRevision,operations},'PATCH');assert.equal(r.status,200);const f=(await r.json()).fog;fogRevision=f.revision;assert.ok(f.bits.length<=4096);await wait(()=>clients.every(s=>latest.get(s)?.scene?.fog.revision===fogRevision),'Fog snapshot four clients');return f;}
 assert.equal((await request(fogPath,players[0]!.cookie,{revision:0,operations:[{kind:'all',mode:'reveal'}]},'PATCH')).status,403);
 assert.equal((await request(fogPath,outsider.cookie)).status,404);
 assert.equal((await request(fogPath,dm.cookie,{revision:0,operations:[{kind:'brush',mode:'reveal',radius:50,points:[{x:641,y:0}]}]},'PATCH')).status,400);
 assert.equal((await request(fogPath,dm.cookie,{revision:0,operations:Array(33).fill({kind:'all',mode:'reveal'})},'PATCH')).status,400);
 assert.equal((await request(fogPath,dm.cookie,{revision:0,operations:[{kind:'brush',mode:'reveal',radius:10,points:Array(129).fill({x:100,y:100})}]},'PATCH')).status,400);
 assert.equal((await request(fogPath,dm.cookie,{revision:0,operations:Array(3).fill({kind:'brush',mode:'reveal',radius:10,points:Array(100).fill({x:100,y:100})})},'PATCH')).status,400);
 await fog([{kind:'rectangle',mode:'reveal',from:{x:50,y:50},to:{x:310,y:160}}]);
 assert.ok(clients.slice(1).every(s=>latest.get(s)?.scene?.tokens.length===2));
 assert.equal((await prisma.token.findUniqueOrThrow({where:{id:enemy.id}})).hidden,true);
 assert.equal((await request(enemy.image!.url,players[0]!.cookie)).status,404);
 await fog([{kind:'brush',mode:'hide',radius:35,points:[{x:100,y:100}]}]);
 assert.ok(clients.slice(1).every(s=>!latest.get(s)?.scene?.tokens.some(t=>t.id===hero.id)));
 await fog([{kind:'brush',mode:'reveal',radius:50,points:[{x:100,y:90},{x:100,y:110}]}]);
 assert.ok(clients.slice(1).every(s=>latest.get(s)?.scene?.tokens.some(t=>t.id===hero.id)));
 assert.equal((await request(fogPath,dm.cookie,{revision:0,operations:[{kind:'all',mode:'hide'}]},'PATCH')).status,409);
 await fog([{kind:'all',mode:'hide'}]);
 assert.ok(clients.slice(1).every(s=>latest.get(s)?.scene?.tokens.length===0));
 await fog([{kind:'all',mode:'reveal'}]);
 // An inactive scene has its own mask and is inaccessible to Player.
 const next=await (await request(locations,dm.cookie,{name:'Other fog',initialFog:'revealed'})).json();
 assert.equal(next.scene.fog.bits,'');
 assert.equal((await request(locations+'/'+next.scene.id+'/fog',players[0]!.cookie)).status,404);
 let active=await(await request(locations+'/active',dm.cookie)).json();
 await request(locations+'/activate',dm.cookie,{sceneId:next.scene.id,version:active.version});
 await wait(()=>clients.every(s=>latest.get(s)?.scene?.id===next.scene.id),'Switch scene mask');
 assert.ok(clients.every(s=>latest.get(s)?.scene?.fog.bits===''));
 active=await(await request(locations+'/active',dm.cookie)).json();
 await request(locations+'/activate',dm.cookie,{sceneId:scene.id,version:active.version});
 await wait(()=>clients.every(s=>latest.get(s)?.scene?.id===scene.id),'Return scene');
 const list=await(await request(path,players[0]!.cookie)).json();assert.equal(list.tokens.length,2);
 assert.equal((await request(`${path}/${enemy.id}`,players[0]!.cookie)).status,404);
 assert.equal((await request(enemy.image!.url,players[0]!.cookie)).status,404);
 for(const method of ['PATCH','DELETE'])assert.equal((await request(`${path}/${hero.id}`,players[0]!.cookie,{revision:hero.revision,x:20},method)).status,403);
 assert.equal((await request(`${locations}/${scene.id}/grid`,players[0]!.cookie,{visible:true,size:40,offsetX:3,offsetY:4,revision:0},'PATCH')).status,403);
 const dmScene=(await(await request(`${locations}/active`,dm.cookie)).json()).scene;
 response=await request(`${locations}/${scene.id}/grid`,dm.cookie,{visible:true,size:40,offsetX:3,offsetY:-4,revision:dmScene.tableRevision},'PATCH');assert.equal(response.status,200);
 await wait(()=>clients.every(s=>latest.get(s)?.scene?.grid.size===40),'Shared grid');
 assert.equal((await request(`${locations}/${scene.id}/grid`,dm.cookie,{visible:false,size:50,offsetX:0,offsetY:0,revision:0},'PATCH')).status,409);
 response=await request(`${path}/${hero.id}`,dm.cookie,{x:325,y:275,size:70,name:'Moved hero',revision:hero.revision},'PATCH');assert.equal(response.status,200);hero=(await response.json()).token;
 await wait(()=>clients.every(s=>latest.get(s)?.scene?.tokens.find(t=>t.id===hero.id)?.x===325),'Movement broadcast');
 assert.equal((await request(`${path}/${hero.id}`,dm.cookie,{x:1,revision:0},'PATCH')).status,409);
 assert.equal((await request(`${path}/${hero.id}`,dm.cookie,{size:-1,revision:hero.revision},'PATCH')).status,400);
 const cross=`/api/campaigns/${other.id}/locations/${scene.id}/tokens/${hero.id}`;assert.equal((await request(cross,dm.cookie)).status,404);
 response=await request(`${path}/${enemy.id}`,dm.cookie,{hidden:false,revision:enemy.revision},'PATCH');assert.equal(response.status,200);enemy=(await response.json()).token;
 await wait(()=>clients.every(s=>latest.get(s)?.scene?.tokens.some(t=>t.id===enemy.id)),'Reveal broadcast');
 assert.equal((await request(enemy.image!.url,players[0]!.cookie)).status,200);
 response=await request(`${path}/${enemy.id}`,dm.cookie,{hidden:true,revision:enemy.revision},'PATCH');assert.equal(response.status,200);enemy=(await response.json()).token;
 await wait(()=>clients.slice(1).every(s=>!latest.get(s)?.scene?.tokens.some(t=>t.id===enemy.id)),'Hide broadcast');
 assert.equal((await request(enemy.image!.url,players[0]!.cookie)).status,404);
 await fog([{kind:'rectangle',mode:'hide',from:{x:550,y:320},to:{x:640,y:400}}]);
 const savedBits=(await prisma.scene.findUniqueOrThrow({where:{id:scene.id}})).fogMask;
 assert.equal(savedBits.length,4096);
 // An explicitly revealed enemy inside fog still has no API or image access.
 packets.length=0;
 response=await request(path+'/'+enemy.id,dm.cookie,{hidden:false,x:600,y:360,revision:enemy.revision},'PATCH');assert.equal(response.status,200);enemy=(await response.json()).token;
 await wait(()=>clients.every(s=>latest.get(s)?.version===latest.get(clients[0]!)?.version),'Fog-filtered movement');
 assert.equal((await request(path+'/'+enemy.id,players[0]!.cookie)).status,404);
 assert.equal((await request(enemy.image!.url,players[0]!.cookie)).status,404);
 assert.ok(clients.slice(1).every(s=>!latest.get(s)?.scene?.tokens.some(t=>t.id===enemy.id)));
 assert.ok(!packets.some(packet=>packet.includes(enemy.id)||packet.includes(enemy.image!.id)));
 let pinged=false;clients[0]!.once('location:ping',()=>{pinged=true;});assert.equal((await clients[1]!.timeout(10000).emitWithAck('location:ping',{sceneId:scene.id,x:200,y:180})).ok,true);await wait(()=>pinged,'Player ping');
 assert.equal((await prisma.token.findUniqueOrThrow({where:{id:hero.id}})).x,325);
 const recovering=clients[2]!,oldId=recovering.id;recovering.io.engine.close();await wait(()=>recovering.connected&&recovering.id!==oldId,'Reconnect');
 assert.ok(!latest.get(recovering)?.scene?.tokens.some(t=>t.id===enemy.id));
 if(!live){sockets.forEach(s=>s.disconnect());const stop=new Promise(resolve=>child!.once('exit',resolve));child!.kill();await stop;await start();const fresh=connect(campaign.id,players[0]!.cookie);await wait(()=>latest.get(fresh)?.scene?.tokens.find(t=>t.id===hero.id)?.x===325,'Restart persistence');assert.equal(latest.get(fresh)?.scene?.grid.offsetY,-4);assert.equal(latest.get(fresh)?.scene?.fog.bits,savedBits);assert.ok(!latest.get(fresh)?.scene?.tokens.some(t=>t.id===enemy.id));}
 assert.equal((await request(`${path}/${guide.id}`,dm.cookie,{revision:guide.revision},'DELETE')).status,204);
 assert.equal((await request(`${path}/${guide.id}`,dm.cookie)).status,404);
 await request(`${locations}/activate`,dm.cookie,{sceneId:null,version:(await(await request(`${locations}/active`,dm.cookie)).json()).version});
 assert.equal((await request(path,players[0]!.cookie)).status,404);
 console.log(`PASS Fog of War: ${live?'public HTTPS/WSS':'local with real Neon/Cloudinary'} DM + 3 Players; brush/rectangle reveal/hide/all, independent scene masks, bounded payload, stale revision rejection, fog persistence, token CRUD/types/size/image, role checks, hidden API/socket/image privacy, Reveal/Hide, grid, coordinate bounds, conflicts, pings, reconnect${live?'':'/server restart'}, inactive/cross-campaign isolation.`);
}catch(error){console.error('FAIL: token check',error instanceof Error?error.message:'unknown');process.exitCode=1;}
finally{sockets.forEach(s=>s.disconnect());child?.kill();try{for(const file of await prisma.mediaFile.findMany({where:{campaignId:{in:campaigns}}})){await destroyImage(file.storageKey);}await prisma.campaign.updateMany({where:{id:{in:campaigns}},data:{activeLocationId:null}});await prisma.campaign.deleteMany({where:{id:{in:campaigns}}});await prisma.user.deleteMany({where:{id:{in:users}}});console.log('Token-test records and images removed.');}finally{await prisma.$disconnect();}}
