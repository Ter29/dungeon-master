import {EventEmitter} from 'node:events';
import type {DirectorSnapshot,PresentationMaterialView} from '@dnd/shared';
import type {PresentationMaterial,MediaFile} from '../generated/prisma/client.js';
import {prisma} from '../database/client.js';
export const directorEvents=new EventEmitter();
export function materialView(m:PresentationMaterial&{image:MediaFile|null}):PresentationMaterialView{
 const f=m.image;
 return{id:m.id,name:m.name,description:m.description,category:m.category,revision:m.revision,image:f&&!f.deletedAt?{id:f.id,url:`/api/campaigns/${m.campaignId}/director/materials/${m.id}/image/${f.id}`,width:f.width,height:f.height,mimeType:f.mimeType,byteSize:f.byteSize}:null};
}
export async function directorSnapshot(campaignId:string):Promise<DirectorSnapshot>{
 return prisma.$transaction(async tx=>{
  const c=await tx.campaign.findUniqueOrThrow({where:{id:campaignId},include:{presentationMaterial:{include:{image:true}}}});
  if(c.presentationMode==='TABLE'||c.presentationMode==='BLANK')return{version:c.presentationVersion,mode:c.presentationMode,material:null};
  const m=c.presentationMaterial;
  if(!m||m.campaignId!==c.id||!m.image||m.image.deletedAt)return{version:c.presentationVersion,mode:'BLANK',material:null};
  return{version:c.presentationVersion,mode:c.presentationMode,material:materialView(m)};
 },{isolationLevel:'RepeatableRead'});
}
