import {Prisma} from '../generated/prisma/client.js';
import type {OrderedParticipant} from './engine.js';
import {turnAfterRemoval} from './engine.js';
export async function writeOrder(tx:Prisma.TransactionClient,roster:OrderedParticipant[]){
 if(!roster.length)return;
 const values=roster.map((p,i)=>Prisma.sql`(${p.id}::uuid,${i}::integer)`);
 await tx.$executeRaw(Prisma.sql`UPDATE "CombatParticipant" AS p SET position=v.position FROM (VALUES ${Prisma.join(values)}) AS v(id,position) WHERE p.id=v.id`);
}
export async function bumpCombat(tx:Prisma.TransactionClient,campaignId:string){await tx.campaign.update({where:{id:campaignId},data:{combatVersion:{increment:1}}});}
// Called inside the existing campaign-locked token deletion transaction.
export async function removeTokenFromCombat(tx:Prisma.TransactionClient,tokenId:string){
 const encounters=await tx.combatEncounter.findMany({where:{status:{in:['PREPARING','ACTIVE']},participants:{some:{tokenId}}},include:{participants:{orderBy:[{position:'asc'},{joinOrder:'asc'}]}}});
 for(const encounter of encounters){
  const participant=encounter.participants.find(p=>p.tokenId===tokenId)!;
  const turn=encounter.status==='ACTIVE'?turnAfterRemoval(encounter.participants,encounter,participant.id):{round:encounter.round,currentParticipantId:null};
  await tx.combatEncounter.update({where:{id:encounter.id},data:{...turn,version:{increment:1}}});
  await tx.combatParticipant.delete({where:{id:participant.id}});
  await writeOrder(tx,encounter.participants.filter(p=>p.id!==participant.id));
  await bumpCombat(tx,encounter.campaignId);
 }
}
