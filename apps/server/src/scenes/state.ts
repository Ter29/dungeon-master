import { EventEmitter } from 'node:events';
import type { LocationView, LocationSnapshot, TokenView } from '@dnd/shared';
import type { Scene, MediaFile, Token } from '../generated/prisma/client.js';
import { prisma } from '../database/client.js';
import {tokenInOpenFog} from '@dnd/shared';

export const locationEvents = new EventEmitter();
export function playerCanSeeToken(scene:{fogMask:string;background:{width:number;height:number}|null},token:{hidden:boolean;x:number;y:number;size:number}){
  return !token.hidden&&tokenInOpenFog(scene.fogMask,token,scene.background?.width??1000,scene.background?.height??700);
}
export function tokenView(token: Token & { image: MediaFile | null }, campaignId: string): TokenView {
  const file = token.image;
  return {id: token.id,name:token.name,kind:token.kind,x:token.x,y:token.y,size:token.size,hidden:token.hidden,revision:token.revision,
    image:file && !file.deletedAt ? {id:file.id,url:`/api/campaigns/${campaignId}/locations/${token.sceneId}/tokens/${token.id}/image/${file.id}`,width:file.width,height:file.height,mimeType:file.mimeType,byteSize:file.byteSize}:null};
}
export function sceneView(scene: Scene & { background: MediaFile | null; tokens?: (Token & {image:MediaFile|null})[] }): LocationView {
  const file = scene.background;
  return { id: scene.id, name: scene.name, description: scene.description, revision: scene.revision,
    fog:{revision:scene.fogRevision,bits:scene.fogMask},
    tableRevision:scene.tableRevision,width:file?.width??1000,height:file?.height??700,
    grid:{visible:scene.gridVisible,size:scene.gridSize,offsetX:scene.gridOffsetX,offsetY:scene.gridOffsetY},tokens:(scene.tokens??[]).map(token=>tokenView(token,scene.campaignId)),
    background: file && !file.deletedAt ? { id: file.id, url: `/api/campaigns/${scene.campaignId}/locations/${scene.id}/background/${file.id}`,
      width: file.width, height: file.height, mimeType: file.mimeType, byteSize: file.byteSize } : null };
}
export async function activeSnapshot(campaignId: string, role: 'DM'|'PLAYER' = 'PLAYER'): Promise<LocationSnapshot> {
  const campaign = await prisma.campaign.findUniqueOrThrow({ where: { id: campaignId }, include: { activeLocation: { include: { background: true, tokens:{where:role==='DM'?{}:{hidden:false},include:{image:true},orderBy:[{createdAt:'asc'},{id:'asc'}]} } } } });
  const active = campaign.activeLocation;
  if(active&&role!=='DM')active.tokens=active.tokens.filter(token=>playerCanSeeToken(active,token));
  return { version: campaign.locationVersion, scene: active && active.campaignId === campaignId ? sceneView(active) : null };
}
export class SceneError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
