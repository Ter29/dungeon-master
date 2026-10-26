export type CombatParticipantView={id:string;tokenId:string;name:string;kind:'PLAYER'|'NPC'|'ENEMY';initiative:number;order:number;visible:boolean;hidden:boolean};
export type CombatEncounterView={id:string;sceneId:string;sceneName:string;status:'PREPARING'|'ACTIVE';round:number;version:number;manualOrder:boolean;currentParticipantId:string|null;participants:CombatParticipantView[]};
export type CombatSnapshot={version:number;locationVersion:number;encounter:CombatEncounterView|null};
