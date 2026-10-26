import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {io,type Socket} from 'socket.io-client';
import sharp from 'sharp';
import type {ClientEvents,ServerEvents,SharedMapView,MapElementView,MapFragmentView,CartographyCatalog} from '@dnd/shared';
import {prisma} from '../src/database/client.js';
import {destroyImage} from '../src/scenes/storage.js';
const live=process.argv[2],base=live?new URL(live).origin:'http://127.0.0.1:3110',origin=live?base:'http://localhost:5173';
const users:string[]=[],campaigns:string[]=[],sockets:Socket<ServerEvents,ClientEvents>[]=[];
let child:ReturnType<typeof spawn>|undefined,watch='',catalogPath='';
const latest=new Map<Socket<ServerEvents,ClientEvents>,SharedMapView|null>(),packets:string[]=[],changes=new Map<Socket,number>();
async function wait(fn:()=>boolean,label:string){const end=Date.now()+25000;while(!fn()){if(Date.now()>end)throw new Error(label);await new Promise(r=>setTimeout(r,30));}}
async function start(){if(live)return;child=spawn(process.execPath,['--env-file-if-exists=.env','dist/index.js'],{env:{...process.env,NODE_ENV:'test',PORT:'3110',APP_ORIGIN:origin},stdio:['ignore','pipe','ignore']});let started=false;child.stdout!.once('data',()=>{started=true;});await wait(()=>started,'startup');}
async function identity(){const id=randomUUID(),token=randomBytes(32).toString('base64url');users.push(id);await prisma.user.create({data:{id,email:`${id}@example.invalid`,displayName:'Cartography check',passwordHash:'test-only',sessions:{create:{tokenHash:createHash('sha256').update(token).digest('hex'),expiresAt:new Date(Date.now()+1200000)}}}});return{id,cookie:`${live?'__Host-dnd_session':'dnd_session'}=${token}`};}
async function req(path:string,cookie?:string,data?:unknown,method=data===undefined?'GET':'POST'){return fetch(base+path,{method,signal:AbortSignal.timeout(45000),headers:{Origin:origin,...(cookie?{Cookie:cookie}:{}),...(data===undefined||data instanceof FormData?{}:{'Content-Type':'application/json'})},...(data===undefined?{}:{body:data instanceof FormData?data:JSON.stringify(data)})});}
async function json<T>(path:string,cookie:string,data?:unknown,method=data===undefined?'GET':'POST',status=200):Promise<T>{const r=await req(path,cookie,data,method);assert.equal(r.status,status,`${method} ${path}: ${await r.clone().text()}`);return r.json();}
function connect(id:string,cookie:string,player=false){const s:Socket<ServerEvents,ClientEvents>=io(base,{auth:{campaignId:id},transports:['websocket'],extraHeaders:{Origin:origin,Cookie:cookie},reconnectionDelay:100});
 async function refresh(){if(!watch)return;try{const r=await req(watch,cookie);if(r.status===404){latest.set(s,null);return;}const m=(await r.json()).map as SharedMapView;const old=latest.get(s);if(!old||old.id!==m.id||old.dataVersion<=m.dataVersion)latest.set(s,m);}catch{}}
 s.on('connect',()=>void refresh());s.on('cartography:changed',()=>{changes.set(s,(changes.get(s)??0)+1);void refresh();});if(player)s.onAny((...args)=>packets.push(JSON.stringify(args)));sockets.push(s);return s;
}
try{
 const dm=await identity(),players=[];for(let i=0;i<3;i++)players.push(await identity());const outsider=await identity();
 const campaign=await prisma.campaign.create({data:{name:'Cartography test',members:{create:[{userId:dm.id,role:'DM'},...players.map(p=>({userId:p.id,role:'PLAYER' as const}))]}}});campaigns.push(campaign.id);
 const other=await prisma.campaign.create({data:{name:'Cartography limits test',members:{create:{userId:dm.id,role:'DM'}}}});campaigns.push(other.id);
 const scene=await prisma.scene.create({data:{campaignId:campaign.id,name:'Active battle preserved',fogMask:'0'.repeat(4096)}});await prisma.campaign.update({where:{id:campaign.id},data:{activeLocationId:scene.id}});
 const before=await prisma.campaign.findUniqueOrThrow({where:{id:campaign.id}});
 await start();catalogPath=`/api/campaigns/${campaign.id}/cartography`;const otherPath=`/api/campaigns/${other.id}/cartography`;
 assert.equal((await req(catalogPath)).status,401);assert.equal((await req(catalogPath,outsider.cookie)).status,404);
 assert.equal((await req(catalogPath+'/maps',players[0]!.cookie,{name:'forbidden'})).status,403);
 assert.equal((await fetch(base+catalogPath+'/maps',{method:'POST',headers:{Cookie:dm.cookie,Origin:'https://invalid.example','Content-Type':'application/json'},body:JSON.stringify({name:'invalid origin'})})).status,403);
 let map=(await json<{map:SharedMapView}>(catalogPath+'/maps',dm.cookie,{name:'DM original 92471',width:1000,height:800},'POST',201)).map;watch=`${catalogPath}/maps/${map.id}`;
 const clients=[connect(campaign.id,dm.cookie),...players.map(p=>connect(campaign.id,p.cookie,true))];await wait(()=>clients.every(s=>s.connected),'DM + 3 connected');
 const png=await sharp({create:{width:200,height:100,channels:3,background:'#ac9c74'}}).png().toBuffer();
 function form(revision:number){const f=new FormData();f.set('revision',String(revision));f.set('file',new Blob([new Uint8Array(png)],{type:'image/png'}),'fragment.png');return f;}
 assert.equal((await req(watch+'/background',dm.cookie,form(map.revision))).status,200);map=(await json<{map:SharedMapView}>(watch,dm.cookie)).map;assert.ok(map.background);
 assert.equal((await req(map.background.url,players[0]!.cookie)).status,404);
 assert.equal((await req(watch,players[0]!.cookie)).status,404);
 assert.equal((await req(watch,dm.cookie,{name:'Renamed map',revision:map.revision},'PATCH')).status,200);map=(await json<{map:SharedMapView}>(watch,dm.cookie)).map;
 const privateCatalog=await json<CartographyCatalog>(catalogPath,players[0]!.cookie);assert.equal(privateCatalog.maps.length,0);assert.ok(!JSON.stringify(privateCatalog).includes(map.id));
 assert.ok(!packets.some(p=>p.includes(map.id)||p.includes('DM original 92471')));
 assert.equal((await req(watch,players[0]!.cookie,{name:'No',revision:map.revision},'PATCH')).status,403);
 assert.equal((await req(watch,dm.cookie,{available:true,revision:0},'PATCH')).status,409);
 await json(watch,dm.cookie,{available:true,revision:map.revision},'PATCH');await wait(()=>clients.every(s=>latest.get(s)?.id===map.id),'issued map visible');
 assert.equal((await req(map.background.url,players[0]!.cookie)).status,200);
 assert.equal((await req(`${otherPath}/maps/${map.id}`,dm.cookie)).status,404);
 assert.equal((await req(watch,dm.cookie,{revision:map.revision,elements:[]},'PATCH')).status,400);
 const elementPath=watch+'/elements';
 const create=async(cookie:string,data:unknown)=>(await json<{element:MapElementView}>(elementPath,cookie,data,'POST',201)).element;
 const notes=await Promise.all(players.map((p,i)=>create(p.cookie,{kind:i===0?'NOTE':'MARKER',text:`Player ${i}`,x:100+i*100,y:100})));
 await wait(()=>clients.every(s=>latest.get(s)?.elements.length===3),'three concurrent creates preserved');
 assert.equal((await req(elementPath,players[0]!.cookie,{kind:'NOTE',locked:false})).status,403);
 assert.equal((await req(elementPath,players[0]!.cookie,{kind:'NOTE',text:'x'.repeat(1001)})).status,400);
 assert.equal((await req(elementPath,players[0]!.cookie,{kind:'NOTE',x:1001})).status,400);
 assert.equal((await req(elementPath,players[0]!.cookie,{kind:'ROUTE',points:Array(129).fill({x:0,y:0})})).status,400);
 const line=await create(players[0]!.cookie,{kind:'LINE',x:100,y:200,points:[{x:0,y:0},{x:100,y:50}]});
 const route=await create(players[1]!.cookie,{kind:'ROUTE',x:150,y:250,points:[{x:0,y:0},{x:80,y:20},{x:120,y:80}]});
 const contour=await create(players[2]!.cookie,{kind:'CONTOUR',x:200,y:300,points:[{x:0,y:0},{x:70,y:0},{x:70,y:70}]});
 const conflicting=await Promise.all(players.slice(0,2).map((p,i)=>req(`${elementPath}/${notes[0]!.id}`,p.cookie,{revision:0,text:`winner ${i}`},'PATCH')));assert.deepEqual(conflicting.map(r=>r.status).sort(),[200,409]);
 const independent=await Promise.all([req(`${elementPath}/${line.id}`,players[0]!.cookie,{revision:0,text:'line edited'},'PATCH'),req(`${elementPath}/${route.id}`,players[1]!.cookie,{revision:0,text:'route edited'},'PATCH')]);assert.ok(independent.every(r=>r.status===200));
 let locked=(await json<{element:MapElementView}>(`${elementPath}/${notes[1]!.id}`,dm.cookie,{revision:0,locked:true},'PATCH')).element;
 for(const method of ['PATCH','DELETE'])assert.equal((await req(`${elementPath}/${locked.id}`,players[0]!.cookie,{revision:locked.revision,text:'No'},method)).status,method==='DELETE'?400:403);
 assert.equal((await req(`${elementPath}/${locked.id}`,players[0]!.cookie,{revision:locked.revision},'DELETE')).status,403);
 locked=(await json<{element:MapElementView}>(`${elementPath}/${locked.id}`,dm.cookie,{revision:locked.revision,locked:false},'PATCH')).element;
 await json(`${elementPath}/${locked.id}`,players[0]!.cookie,{revision:locked.revision,x:450},'PATCH');
 let fragment=(await json<{fragment:MapFragmentView}>(catalogPath+'/fragments',dm.cookie,{name:'Secret fragment 42891'},'POST',201)).fragment;
 assert.equal((await req(`${catalogPath}/fragments/${fragment.id}`,dm.cookie,{issued:true,revision:0},'PATCH')).status,400);
 assert.equal((await req(`${catalogPath}/fragments/${fragment.id}`,players[0]!.cookie,{issued:true,revision:0},'PATCH')).status,403);
 const corrupt=new FormData();corrupt.set('revision','0');corrupt.set('file',new Blob(['not png'],{type:'image/png'}),'bad.png');assert.equal((await req(`${catalogPath}/fragments/${fragment.id}/image`,dm.cookie,corrupt)).status,415);
 assert.equal((await req(`${catalogPath}/fragments/${fragment.id}/image`,players[0]!.cookie,form(0))).status,403);
 assert.equal((await req(`${catalogPath}/fragments/${fragment.id}/image`,dm.cookie,form(0))).status,200);
 fragment=(await json<CartographyCatalog>(catalogPath,dm.cookie)).fragments.find(f=>f.id===fragment.id)!;assert.ok(fragment.image);
 assert.equal((await req(fragment.image.url,players[0]!.cookie)).status,404);
 assert.equal((await req(fragment.image.url,outsider.cookie)).status,404);
 assert.equal((await req(elementPath,players[0]!.cookie,{kind:'FRAGMENT',fragmentId:fragment.id,x:100,y:100})).status,404);
 const secretPlacement=await create(dm.cookie,{kind:'FRAGMENT',fragmentId:fragment.id,x:100,y:500});
 assert.ok(!(await json<{map:SharedMapView}>(watch,players[0]!.cookie)).map.elements.some(e=>e.id===secretPlacement.id));
 assert.equal((await req(`${elementPath}/${secretPlacement.id}`,players[0]!.cookie,{revision:0,x:10},'PATCH')).status,404);
 assert.equal((await json<CartographyCatalog>(catalogPath,players[0]!.cookie)).fragments.length,0);
 assert.ok(!packets.some(p=>p.includes(fragment.id)||p.includes(fragment.image!.id)||p.includes(fragment.name)||p.includes(secretPlacement.id)));
 fragment=(await json<{fragment:MapFragmentView}>(`${catalogPath}/fragments/${fragment.id}`,dm.cookie,{issued:true,revision:fragment.revision},'PATCH')).fragment;
 await wait(()=>clients.every(s=>latest.get(s)?.elements.some(e=>e.id===secretPlacement.id)),'explicit fragment issue');
 assert.equal((await req(fragment.image!.url,players[0]!.cookie)).status,200);
 assert.equal((await req(`${catalogPath}/fragments/${fragment.id}/image`,dm.cookie,form(fragment.revision))).status,409);
 let placement=await create(players[0]!.cookie,{kind:'FRAGMENT',fragmentId:fragment.id,x:600,y:400});
 placement=(await json<{element:MapElementView}>(`${elementPath}/${placement.id}`,players[2]!.cookie,{revision:placement.revision,x:620,y:420,scale:1.5,rotation:35},'PATCH')).element;
 await wait(()=>clients.every(s=>latest.get(s)?.elements.find(e=>e.id===placement.id)?.rotation===35),'fragment transform sync');
 assert.equal((await req(`${otherPath}/fragments/${fragment.id}/image/${fragment.image!.id}`,dm.cookie)).status,404);
 packets.length=0;
 fragment=(await json<{fragment:MapFragmentView}>(`${catalogPath}/fragments/${fragment.id}`,dm.cookie,{issued:false,revision:fragment.revision},'PATCH')).fragment;
 await wait(()=>clients.slice(1).every(s=>!latest.get(s)?.elements.some(e=>e.fragmentId===fragment.id)),'revocation removes all placements');
 assert.equal((await req(fragment.image!.url,players[0]!.cookie)).status,404);
 assert.equal((await req(`${elementPath}/${placement.id}`,players[0]!.cookie,{revision:placement.revision},'DELETE')).status,404);
 assert.ok(!JSON.stringify(await json<CartographyCatalog>(catalogPath,players[0]!.cookie)).includes(fragment.id));
 assert.ok(!packets.some(p=>p.includes(fragment.id)||p.includes(fragment.image!.id)));
 fragment=(await json<{fragment:MapFragmentView}>(`${catalogPath}/fragments/${fragment.id}`,dm.cookie,{issued:true,revision:fragment.revision},'PATCH')).fragment;
 const recovery=clients[2]!,oldId=recovery.id;recovery.io.engine.close();await wait(()=>recovery.connected&&recovery.id!==oldId,'reconnect');await wait(()=>latest.get(recovery)?.elements.some(e=>e.id===placement.id&&e.scale===1.5),'reconnect allowed state');
 const stored=await prisma.mapElement.findUniqueOrThrow({where:{id:placement.id}});assert.equal(stored.rotation,35);
 if(!live){sockets.forEach(s=>s.disconnect());const stopped=new Promise(r=>child!.once('exit',r));child!.kill();await stopped;await start();const fresh=connect(campaign.id,players[0]!.cookie,true);await wait(()=>latest.get(fresh)?.elements.some(e=>e.id===placement.id&&e.scale===1.5),'restart persistence');}
 // Quotas are transactionally enforced without creating hundreds of HTTP requests.
 const capMap=await prisma.sharedMap.create({data:{campaignId:other.id,name:'Element quota'}});
 await prisma.mapElement.createMany({data:Array.from({length:500},()=>({mapId:capMap.id,kind:'NOTE' as const}))});
 assert.equal((await req(`${otherPath}/maps/${capMap.id}/elements`,dm.cookie,{kind:'NOTE'})).status,400);
 await prisma.sharedMap.createMany({data:Array.from({length:49},()=>({campaignId:other.id,name:'Map quota'}))});assert.equal((await req(otherPath+'/maps',dm.cookie,{name:'Over quota'})).status,400);
 await prisma.mapFragment.createMany({data:Array.from({length:100},()=>({campaignId:other.id,name:'Fragment quota'}))});assert.equal((await req(otherPath+'/fragments',dm.cookie,{name:'Over quota'})).status,400);
 assert.equal((await req(`${elementPath}/${contour.id}`,players[0]!.cookie,{revision:0},'DELETE')).status,204);
 const current=(await json<{map:SharedMapView}>(watch,dm.cookie)).map;
 assert.equal((await req(watch,dm.cookie,{available:false,revision:current.revision},'PATCH')).status,200);
 assert.equal((await req(watch,players[0]!.cookie)).status,404);assert.equal((await req(map.background!.url,players[0]!.cookie)).status,404);
 assert.equal((await req(elementPath,players[0]!.cookie,{kind:'NOTE'})).status,404);
 const after=await prisma.campaign.findUniqueOrThrow({where:{id:campaign.id}});assert.equal(after.activeLocationId,scene.id);assert.equal(after.locationVersion,before.locationVersion);assert.deepEqual(after.roomState,before.roomState);
 const liveSocket=live?clients[1]!:sockets[sockets.length-1]!;
 await prisma.campaignMember.delete({where:{campaignId_userId:{campaignId:campaign.id,userId:players[0]!.id}}});
 map=(await json<{map:SharedMapView}>(watch,dm.cookie)).map;await json(watch,dm.cookie,{name:'After membership revoke',revision:map.revision},'PATCH');await wait(()=>!liveSocket.connected,'revoked membership disconnected');assert.equal((await req(catalogPath,players[0]!.cookie)).status,404);
 map=(await json<{map:SharedMapView}>(watch,dm.cookie)).map;
 assert.equal((await req(watch+'/background',dm.cookie,{revision:map.revision},'DELETE')).status,204);assert.equal((await req(map.background!.url,dm.cookie)).status,404);
 assert.equal((await req(`${catalogPath}/fragments/${fragment.id}`,dm.cookie,{revision:fragment.revision},'DELETE')).status,204);assert.equal(await prisma.mapElement.count({where:{fragmentId:fragment.id}}),0);
 map=(await json<{map:SharedMapView}>(watch,dm.cookie)).map;assert.equal((await req(watch,dm.cookie,{revision:map.revision},'DELETE')).status,204);assert.equal((await req(watch,dm.cookie)).status,404);
 console.log(`PASS Cartography: ${live?'public HTTPS/WSS':'local Neon/Cloudinary'} DM + 3 Players; map CRUD/private backgrounds, six element kinds, concurrent edits 200/409, independent revisions, DM locks, fragment upload/issue/revoke/placement/transforms, private images/IDs, quotas/bounds, reconnect${live?'':'/process restart'}, Scene/Fog/legacy preservation.`);
}catch(error){console.error('FAIL Cartography:',error instanceof Error?error.stack:'unknown');process.exitCode=1;}
finally{sockets.forEach(s=>s.disconnect());child?.kill();try{for(const f of await prisma.mediaFile.findMany({where:{campaignId:{in:campaigns}}}))await destroyImage(f.storageKey);await prisma.campaign.updateMany({where:{id:{in:campaigns}},data:{activeLocationId:null}});await prisma.campaign.deleteMany({where:{id:{in:campaigns}}});await prisma.user.deleteMany({where:{id:{in:users}}});console.log('Cartography fixtures and provider images removed.');}finally{await prisma.$disconnect();}}
