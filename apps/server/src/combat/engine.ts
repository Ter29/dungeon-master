export type OrderedParticipant={id:string;initiative:number;joinOrder:number;position:number};
export type Turn={round:number;currentParticipantId:string|null};
export const MAX_ROUND=1_000_000;
export function initiativeOrder<T extends OrderedParticipant>(roster:T[]):T[]{
 return [...roster].sort((a,b)=>b.initiative-a.initiative||a.joinOrder-b.joinOrder||a.id.localeCompare(b.id));
}
export function advanceTurn(roster:{id:string}[],turn:Turn,action:'NEXT'|'PREVIOUS'|'SKIP'):Turn{
 if(!roster.length)return{round:turn.round,currentParticipantId:null};
 const index=roster.findIndex(p=>p.id===turn.currentParticipantId);
 if(index<0)return{round:turn.round,currentParticipantId:roster[0]!.id};
 if(action==='PREVIOUS'){
  if(index===0&&turn.round===1)return{round:turn.round,currentParticipantId:turn.currentParticipantId};
  return index===0?{round:turn.round-1,currentParticipantId:roster[roster.length-1]!.id}:{round:turn.round,currentParticipantId:roster[index-1]!.id};
 }
 return index===roster.length-1?{round:Math.min(MAX_ROUND,turn.round+1),currentParticipantId:roster[0]!.id}:{round:turn.round,currentParticipantId:roster[index+1]!.id};
}
export function turnAfterRemoval(roster:{id:string}[],turn:Turn,removedId:string):Turn{
 const remaining=roster.filter(p=>p.id!==removedId);
 if(!remaining.length)return{round:turn.round,currentParticipantId:null};
 if(turn.currentParticipantId!==removedId)return{round:turn.round,currentParticipantId:turn.currentParticipantId};
 const index=roster.findIndex(p=>p.id===removedId);
 return index===roster.length-1?{round:Math.min(MAX_ROUND,turn.round+1),currentParticipantId:remaining[0]!.id}:{round:turn.round,currentParticipantId:roster[index+1]!.id};
}
