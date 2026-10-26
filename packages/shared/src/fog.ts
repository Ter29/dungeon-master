// Fixed 128x128 bitmask, four cells per hex digit. Empty string means fully revealed.
export const FOG_SIZE=128;
export const FOG_HEX_LENGTH=FOG_SIZE*FOG_SIZE/4;
export type FogState={revision:number;bits:string};
export type FogPoint={x:number;y:number};
export type FogOperation={kind:'all';mode:'reveal'|'hide'}|{kind:'rectangle';mode:'reveal'|'hide';from:FogPoint;to:FogPoint}|{kind:'brush';mode:'reveal'|'hide';radius:number;points:FogPoint[]};
export function fogCell(bits:string,col:number,row:number){if(!bits)return true;const i=row*FOG_SIZE+col;return Boolean(parseInt(bits[Math.floor(i/4)]??'0',16)&(1<<(i%4)));}
export function tokenInOpenFog(bits:string,token:{x:number;y:number;size:number},width:number,height:number){
 if(!bits)return true;
 const low=(value:number,max:number)=>Math.max(0,Math.min(FOG_SIZE-1,Math.floor(value/max*FOG_SIZE)));
 for(let y=low(token.y-token.size/2,height);y<=low(token.y+token.size/2,height);y++)for(let x=low(token.x-token.size/2,width);x<=low(token.x+token.size/2,width);x++)if(!fogCell(bits,x,y))return false;
 return true;
}
function segmentDistance(p:FogPoint,a:FogPoint,b:FogPoint){const dx=b.x-a.x,dy=b.y-a.y,d=dx*dx+dy*dy;const t=d?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/d)):0;return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);}
export function applyFog(bits:string,width:number,height:number,operations:FogOperation[]){
 let cells=Array.from({length:FOG_HEX_LENGTH},(_,i)=>bits?parseInt(bits[i]!,16):15);
 for(const op of operations){
  if(op.kind==='all'){cells.fill(op.mode==='reveal'?15:0);continue;}
  for(let row=0;row<FOG_SIZE;row++)for(let col=0;col<FOG_SIZE;col++){
   const p={x:(col+.5)/FOG_SIZE*width,y:(row+.5)/FOG_SIZE*height};let hit=false;
   if(op.kind==='rectangle')hit=p.x>=Math.min(op.from.x,op.to.x)&&p.x<=Math.max(op.from.x,op.to.x)&&p.y>=Math.min(op.from.y,op.to.y)&&p.y<=Math.max(op.from.y,op.to.y);
   else {hit=op.points.length===1&&segmentDistance(p,op.points[0]!,op.points[0]!)<=op.radius;for(let i=1;!hit&&i<op.points.length;i++)hit=segmentDistance(p,op.points[i-1]!,op.points[i]!)<=op.radius;}
   if(hit){const i=row*FOG_SIZE+col,index=Math.floor(i/4),bit=1<<(i%4);cells[index]=op.mode==='reveal'?cells[index]!|bit:cells[index]!&~bit;}
  }
 }
 return cells.every(value=>value===15)?'':cells.map(value=>value.toString(16)).join('');
}
