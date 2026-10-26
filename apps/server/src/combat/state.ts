import {EventEmitter} from 'node:events';
import type {CombatSnapshot,CombatEncounterView} from '@dnd/shared';
import {prisma} from '../database/client.js';
import {playerCanSeeToken} from '../scenes/state.js';
export const combatEvents=new EventEmitter();
export async function combatSnapshots(campaignId:string):Promise<{DM:CombatSnapshot;PLAYER:CombatSnapshot}>{
 return prisma.$transaction(async tx=>{
  const campaign=await tx.campaign.findUniqueOrThrow({where:{id:campaignId},select:{combatVersion:true,locationVersion:true,activeLocationId:true}});
  const encounter=await tx.combatEncounter.findFirst({where:{campaignId,status:{in:['PREPARING','ACTIVE']}},include:{scene:{include:{background:true}},participants:{include:{token:true},orderBy:[{position:'asc'},{joinOrder:'asc'}]}}});
  const base={version:campaign.combatVersion,locationVersion:campaign.locationVersion};
  function project(dm:boolean):CombatSnapshot{
   if(!encounter||(!dm&&campaign.activeLocationId!==encounter.sceneId))return{...base,encounter:null};
   const participants=encounter.participants.filter(p=>dm||playerCanSeeToken(encounter.scene,p.token)).map((p,index)=>({id:p.id,tokenId:p.tokenId,name:p.token.name,kind:p.token.kind,initiative:p.initiative,order:index,hidden:p.token.hidden,visible:campaign.activeLocationId===encounter.sceneId&&playerCanSeeToken(encounter.scene,p.token)}));
   const view:CombatEncounterView={id:encounter.id,sceneId:encounter.sceneId,sceneName:encounter.scene.name,status:encounter.status as 'PREPARING'|'ACTIVE',round:encounter.round,version:encounter.version,manualOrder:encounter.manualOrder,currentParticipantId:dm||participants.some(p=>p.id===encounter.currentParticipantId)?encounter.currentParticipantId:null,participants};
   return{...base,encounter:view};
  }
  return{DM:project(true),PLAYER:project(false)};
 },{isolationLevel:'RepeatableRead'});
}
