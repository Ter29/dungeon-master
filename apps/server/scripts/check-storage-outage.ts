import assert from 'node:assert/strict';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import sharp from 'sharp';
import { prisma } from '../src/database/client.js';

const id = randomUUID(), campaignId = randomUUID(), token = randomBytes(32).toString('base64url');
let child: ReturnType<typeof spawn> | undefined;
try {
  await prisma.user.create({ data: { id, email: `${id}@example.invalid`, displayName: 'Outage check', passwordHash: 'test', sessions: { create: { tokenHash: createHash('sha256').update(token).digest('hex'), expiresAt: new Date(Date.now() + 600000) } } } });
  await prisma.campaign.create({ data: { id: campaignId, name: 'Outage check', members: { create: { userId: id, role: 'DM' } } } });
  const media = await prisma.mediaFile.create({ data: { campaignId, storageKey: `simulated/${randomUUID()}`, format: 'png', mimeType: 'image/png', byteSize: 10, width: 10, height: 10 } });
  const scene = await prisma.scene.create({ data: { campaignId, name: 'Preserve existing background', backgroundId: media.id } });
  await prisma.campaign.update({ where: { id: campaignId }, data: { activeLocationId: scene.id } });
  child = spawn(process.execPath, ['--env-file-if-exists=.env', 'dist/index.js'], { env: {
    ...process.env, NODE_ENV: 'test', PORT: '3107', APP_ORIGIN: 'http://localhost:5173', CLOUDINARY_TEST_PREFIX: 'http://127.0.0.1:4900/cloudinary',
    CLOUDINARY_URL: 'cloudinary://fake:fake@test?upload_prefix=http%3A%2F%2F127.0.0.1%3A4900%2Fcloudinary',
  }, stdio: ['ignore', 'pipe', 'ignore'] });
  await Promise.race([once(child.stdout!, 'data'), new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('Startup timeout')), 10000); timer.unref(); })]);
  const file = await sharp({ create: { width: 16, height: 16, channels: 3, background: '#000' } }).png().toBuffer();
  const form = new FormData(); form.set('revision', '0'); form.set('file', new Blob([new Uint8Array(file)], { type: 'image/png' }), 'map.png');
  const base = `http://127.0.0.1:3107/api/campaigns/${campaignId}/locations`;
  const headers = { Cookie: `dnd_session=${token}`, Origin: 'http://localhost:5173' };
  const failed = await fetch(`${base}/${scene.id}/background`, { method: 'POST', headers, body: form });
  assert.equal(failed.status, 503);
  const saved = await prisma.scene.findUniqueOrThrow({ where: { id: scene.id } });
  assert.equal(saved.backgroundId, media.id); assert.equal(saved.revision, 0);
  assert.equal((await prisma.campaign.findUniqueOrThrow({ where: { id: campaignId } })).locationVersion, 0);
  assert.equal(await prisma.mediaFile.count({ where: { campaignId, deletedAt: { not: null } } }), 1);
  const read = await fetch(`${base}/${scene.id}/background/${media.id}`, { headers }); assert.equal(read.status, 503);
  const body = JSON.stringify(await read.json()); assert.ok(!body.includes('fake') && !body.includes('signature'));
  const map=await prisma.sharedMap.create({data:{campaignId,name:'Preserve map background',backgroundId:null}});
  const oldMapMedia=await prisma.mediaFile.create({data:{campaignId,storageKey:'simulated/'+randomUUID(),format:'png',mimeType:'image/png',byteSize:10,width:10,height:10}});
  await prisma.sharedMap.update({where:{id:map.id},data:{backgroundId:oldMapMedia.id}});
  const fragment=await prisma.mapFragment.create({data:{campaignId,name:'Private incomplete fragment'}});
  for(const path of ['maps/'+map.id+'/background','fragments/'+fragment.id+'/image']){
    const body=new FormData();body.set('revision','0');body.set('file',new Blob([new Uint8Array(file)],{type:'image/png'}),'image.png');
    const response=await fetch('http://127.0.0.1:3107/api/campaigns/'+campaignId+'/cartography/'+path,{method:'POST',headers,body});assert.equal(response.status,503);
  }
  const retained=await prisma.sharedMap.findUniqueOrThrow({where:{id:map.id}});assert.equal(retained.backgroundId,oldMapMedia.id);assert.equal(retained.revision,0);assert.equal(retained.dataVersion,0);
  const incomplete=await prisma.mapFragment.findUniqueOrThrow({where:{id:fragment.id}});assert.equal(incomplete.issued,false);assert.equal(incomplete.imageId,null);
  assert.equal(await prisma.mediaFile.count({where:{campaignId,deletedAt:{not:null}}}),3);
  console.log('PASS Cartography outage: map background/version retained; failed fragment upload remains private and unissued; pending media stays retryable.');
  console.log('PASS: real app + Cloudinary SDK through Postman outage simulation returns safe 503; old background/revision/state retained; pending asset remains cleanup-retryable.');
} catch (error) { console.error('FAIL: storage outage check', error instanceof assert.AssertionError ? error.message : 'request/setup error'); process.exitCode = 1; }
finally {
  child?.kill();
  try { await prisma.campaign.updateMany({ where: { id: campaignId }, data: { activeLocationId: null } }); await prisma.campaign.deleteMany({ where: { id: campaignId } }); await prisma.user.deleteMany({ where: { id } }); }
  finally { await prisma.$disconnect(); }
}
