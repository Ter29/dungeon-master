import {EventEmitter} from 'node:events';
import type {MediaFile,SharedMap,MapElement,MapFragment} from '../generated/prisma/client.js';
import type {LocationBackground,SharedMapSummary,MapElementView,MapFragmentView,CartographyPoint} from '@dnd/shared';
export const cartographyEvents=new EventEmitter();
type Fragment=MapFragment&{image:MediaFile|null};
export function fragmentView(f:Fragment):MapFragmentView{
 return{id:f.id,name:f.name,issued:f.issued,revision:f.revision,image:f.image&&!f.image.deletedAt?mediaView(f.image,`/api/campaigns/${f.campaignId}/cartography/fragments/${f.id}/image/${f.image.id}`):null};
}
function mediaView(f:MediaFile,url:string):LocationBackground{return{id:f.id,url,width:f.width,height:f.height,mimeType:f.mimeType,byteSize:f.byteSize};}
export function mapSummary(m:SharedMap&{background:MediaFile|null}):SharedMapSummary{
 return{id:m.id,name:m.name,description:m.description,width:m.width,height:m.height,available:m.available,revision:m.revision,dataVersion:m.dataVersion,background:m.background&&!m.background.deletedAt?mediaView(m.background,`/api/campaigns/${m.campaignId}/cartography/maps/${m.id}/background/${m.background.id}`):null};
}
export function elementView(e:MapElement&{fragment:Fragment|null}):MapElementView{
 return{id:e.id,kind:e.kind,text:e.text,color:e.color,x:e.x,y:e.y,points:e.points as CartographyPoint[],scale:e.scale,rotation:e.rotation,locked:e.locked,revision:e.revision,fragmentId:e.fragmentId,fragment:e.fragment?fragmentView(e.fragment):null};
}
export function permittedElement(e:{fragmentId:string|null;fragment:{issued:boolean;image:MediaFile|null}|null},role:string){return role==='DM'||!e.fragmentId||Boolean(e.fragment?.issued&&e.fragment.image&&!e.fragment.image.deletedAt);}
