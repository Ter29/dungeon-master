import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { FOG_SIZE, fogCell, type FogOperation, type LocationView } from '@dnd/shared';
type Point={x:number;y:number};
export function FogLayer({scene,dm,tool,radius,save}:{scene:LocationView;dm:boolean;tool:string;radius:number;save:(ops:FogOperation[])=>Promise<void>}){
 const group=useRef<SVGGElement>(null),points=useRef<Point[]>([]);
 const [draft,setDraft]=useState<Point[]>([]),[saving,setSaving]=useState(false);
 useEffect(()=>{points.current=[];setDraft([]);},[scene.id,scene.width,scene.height,tool]);
 const path=useMemo(()=>{let path='';
 for(let row=0;row<FOG_SIZE;row++){let start=-1;for(let col=0;col<=FOG_SIZE;col++){const hidden=col<FOG_SIZE&&!fogCell(scene.fog.bits,col,row);if(hidden&&start<0)start=col;if(!hidden&&start>=0){const w=scene.width/FOG_SIZE,h=scene.height/FOG_SIZE;path+=`M${start*w} ${row*h}h${(col-start)*w}v${h}h${-(col-start)*w}z`;start=-1;}}}
 return path;},[scene.fog.bits,scene.width,scene.height]);
 function point(e:PointerEvent<SVGElement>){const svg=group.current!.ownerSVGElement!,p=svg.createSVGPoint();p.x=e.clientX;p.y=e.clientY;const q=p.matrixTransform(group.current!.getScreenCTM()!.inverse());return{x:Math.max(0,Math.min(scene.width,q.x)),y:Math.max(0,Math.min(scene.height,q.y))};}
 const rectangle=tool.endsWith('rectangle');
 return <g ref={group}>
  <path data-fog-mask="true" d={path} fill="black" opacity={dm ? .55 : 1} pointerEvents="none"/>
  {dm&&tool!=='camera'&&<rect width={scene.width} height={scene.height} fill="transparent" style={{cursor:'crosshair'}}
   onPointerDown={e=>{if(e.shiftKey||e.button!==0||saving)return;e.preventDefault();e.stopPropagation();points.current=[point(e)];setDraft([...points.current]);e.currentTarget.setPointerCapture(e.pointerId);}}
   onPointerMove={e=>{if(!points.current.length)return;e.stopPropagation();const p=point(e),list=points.current;if(rectangle)list[1]=p;else if(Math.hypot(p.x-list[list.length-1]!.x,p.y-list[list.length-1]!.y)>=Math.max(1,radius/4)){if(list.length>=128)points.current=list.filter((_,i)=>i%2===0);points.current.push(p);}setDraft([...points.current]);}}
   onPointerUp={e=>{if(!points.current.length)return;e.stopPropagation();const list=points.current;points.current=[];setDraft([]);e.currentTarget.releasePointerCapture(e.pointerId);const mode=tool.startsWith('reveal')?'reveal':'hide';const op:FogOperation=rectangle?{kind:'rectangle',mode,from:list[0]!,to:point(e)}:{kind:'brush',mode,radius,points:list};setSaving(true);void save([op]).finally(()=>setSaving(false));}}
   onPointerCancel={()=>{points.current=[];setDraft([]);}}/>}
  {draft.length>0&&<g pointerEvents="none" stroke={tool.startsWith('reveal')?'#48edb0':'#ee7777'} opacity=".65" fill="none">
   {draft.length===1&&!rectangle&&<circle cx={draft[0]!.x} cy={draft[0]!.y} r={radius} fill={tool.startsWith('reveal')?'#48edb0':'#ee7777'} stroke="none"/>}
   {rectangle?<rect x={Math.min(draft[0]!.x,draft[draft.length-1]!.x)} y={Math.min(draft[0]!.y,draft[draft.length-1]!.y)} width={Math.abs(draft[0]!.x-draft[draft.length-1]!.x)} height={Math.abs(draft[0]!.y-draft[draft.length-1]!.y)} strokeWidth="3"/>:<polyline points={draft.map(p=>`${p.x},${p.y}`).join(' ')} strokeWidth={radius*2} strokeLinecap="round" strokeLinejoin="round"/>}
  </g>}
 </g>;
}
