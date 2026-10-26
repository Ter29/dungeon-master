import {useEffect,useRef,useState,type PointerEvent} from 'react';
import type {CartographyPoint as Point,MapElementView,SharedMapView} from '@dnd/shared';
type NewElement=Partial<MapElementView>&{kind:MapElementView['kind']};
export function CartographyCanvas({map,dm,ready,tool,text,color,fragmentId,onCreate,onMove,onSelect}:{map:SharedMapView;dm:boolean;ready:boolean;tool:string;text:string;color:string;fragmentId:string;onCreate:(e:NewElement)=>Promise<void>;onMove:(e:MapElementView,p:Point)=>Promise<void>;onSelect:(e:MapElementView)=>void}){
 const svg=useRef<SVGSVGElement>(null);
 const fit=()=>{const scale=Math.min(1000/map.width,600/map.height)*.95;return{scale,x:(1000-map.width*scale)/2,y:(600-map.height*scale)/2};};
 const [camera,setCamera]=useState(fit),[draft,setDraft]=useState<Point[]>([]),[preview,setPreview]=useState<(Point&{id:string})|null>(null);
 const gesture=useRef<{kind:'pan'|'draw'|'move';start:Point;last:Point;points:Point[];element?:MapElementView;moved:boolean}|null>(null);
 function view(event:{clientX:number;clientY:number}){const p=svg.current!.createSVGPoint();p.x=event.clientX;p.y=event.clientY;return p.matrixTransform(svg.current!.getScreenCTM()!.inverse());}
 function world(p:Point){return{x:Math.max(0,Math.min(map.width,(p.x-camera.x)/camera.scale)),y:Math.max(0,Math.min(map.height,(p.y-camera.y)/camera.scale))};}
 useEffect(()=>{const el=svg.current!;const wheel=(event:WheelEvent)=>{event.preventDefault();const p=view(event);setCamera(c=>{const scale=Math.max(.02,Math.min(10,c.scale*Math.exp(-event.deltaY*.001)));return{scale,x:p.x-(p.x-c.x)*scale/c.scale,y:p.y-(p.y-c.y)*scale/c.scale};});};el.addEventListener('wheel',wheel,{passive:false});return()=>el.removeEventListener('wheel',wheel);},[]);
 useEffect(()=>{if(!ready){gesture.current=null;setDraft([]);setPreview(null);}},[ready]);
 function begin(event:PointerEvent<SVGElement>,element?:MapElementView){
  if(event.button!==0&&event.button!==1)return;event.preventDefault();event.stopPropagation();const p=view(event),move=tool==='select'&&element&&ready&&(dm||!element.locked)&&!event.shiftKey&&event.button===0;
  if(element&&tool==='select')onSelect(element);
  const kind=event.shiftKey||event.button===1||tool==='select'||!ready?(move?'move':'pan'):'draw';gesture.current={kind,start:p,last:p,points:[world(p)],element:move?element:undefined,moved:false};if(kind==='draw')setDraft([world(p)]);svg.current!.setPointerCapture(event.pointerId);
 }
 async function finish(event:PointerEvent<SVGSVGElement>){
  const action=gesture.current;if(!action)return;gesture.current=null;if(svg.current?.hasPointerCapture(event.pointerId))svg.current.releasePointerCapture(event.pointerId);setDraft([]);setPreview(null);
  if(!ready)return;
  if(action.kind==='move'&&action.element&&action.moved){const a=world(action.start),b=world(view(event));await onMove(action.element,{x:Math.max(0,Math.min(map.width,action.element.x+b.x-a.x)),y:Math.max(0,Math.min(map.height,action.element.y+b.y-a.y))});}
  else if(action.kind==='draw'){
   const end=world(view(event)),kind=tool as MapElementView['kind'];let points=action.points;
   if(kind==='LINE')points=[points[0]!,end];
   if(['LINE','ROUTE','CONTOUR'].includes(kind)){if(points.length<(kind==='CONTOUR'?3:2))return;const x=Math.min(...points.map(p=>p.x)),y=Math.min(...points.map(p=>p.y));await onCreate({kind,text,color,x,y,points:points.map(p=>({x:p.x-x,y:p.y-y}))});}
   else await onCreate({kind,text:kind==='FRAGMENT'?'':text,color,x:end.x,y:end.y,...(kind==='FRAGMENT'?{fragmentId}: {})});
  }
 }
 return <div><p><button onClick={()=>setCamera(fit())}>Reset Map View</button>{' '}<button onClick={()=>setCamera(c=>({...c,scale:Math.min(10,c.scale*1.25)}))}>Збільшити карту</button>{' '}<button onClick={()=>setCamera(c=>({...c,scale:Math.max(.02,c.scale/1.25)}))}>Зменшити карту</button> Масштаб {Math.round(camera.scale*100)}%</p>
 <p>Колесо — масштаб. Інструмент «Вибір / камера» — вибір і перетягування елементів; фон — камера. Shift або середня кнопка — камера з будь-яким інструментом.</p>
 <svg ref={svg} role="img" aria-label={`Спільна карта: ${map.name}`} viewBox="0 0 1000 600" style={{width:'100%',height:'min(65vh,600px)',minHeight:300,background:'#282c34',touchAction:'none',userSelect:'none'}} onPointerDown={e=>begin(e)}
  onPointerMove={event=>{const a=gesture.current;if(!a)return;const p=view(event);if(Math.hypot(p.x-a.start.x,p.y-a.start.y)>3)a.moved=true;
   if(a.kind==='pan'&&a.moved){const dx=p.x-a.last.x,dy=p.y-a.last.y;setCamera(c=>({...c,x:c.x+dx,y:c.y+dy}));}
   else if(a.kind==='move'&&a.element){const start=world(a.start),end=world(p);setPreview({id:a.element.id,x:a.element.x+end.x-start.x,y:a.element.y+end.y-start.y});}
   else if(a.kind==='draw'){const q=world(p);if(tool==='LINE')a.points=[a.points[0]!,q];else if(Math.hypot(q.x-a.points[a.points.length-1]!.x,q.y-a.points[a.points.length-1]!.y)>Math.max(1,3/camera.scale)){if(a.points.length>=128)a.points=a.points.filter((_,i)=>i%2===0);a.points.push(q);}setDraft([...a.points]);}a.last=p;}}
  onPointerUp={e=>void finish(e)} onPointerCancel={()=>{gesture.current=null;setDraft([]);setPreview(null);}}>
  <defs><clipPath id={`map-clip-${map.id}`}><rect width={map.width} height={map.height}/></clipPath></defs>
  <g transform={`translate(${camera.x} ${camera.y}) scale(${camera.scale})`}><rect data-map-paper="true" width={map.width} height={map.height} fill="#eee5cc"/>
   <g clipPath={`url(#map-clip-${map.id})`}>
   {map.background&&<image href={map.background.url} width={map.width} height={map.height} preserveAspectRatio="none"/>}
   {map.elements.map(e=>{const p=preview?.id===e.id?preview:e;return <g key={e.id} data-map-element={e.id} transform={`translate(${p.x} ${p.y})`} onPointerDown={event=>begin(event,e)} style={{cursor:tool==='select'?(e.locked&&!dm?'not-allowed':'grab'):'crosshair'}}>
    <title>{e.text||e.fragment?.name||e.kind}{e.locked?' · заблоковано':''}</title>
    {e.kind==='FRAGMENT'&&e.fragment?.image?<g transform={`rotate(${e.rotation}) scale(${e.scale})`}><image href={e.fragment.image.url} width={e.fragment.image.width} height={e.fragment.image.height}/>{dm&&!e.fragment.issued&&<rect width={e.fragment.image.width} height={e.fragment.image.height} fill="none" stroke="#b00020" strokeWidth={3/e.scale} strokeDasharray="10 5"/>}</g>:
     e.kind==='NOTE'?<><rect x="-5" y="-22" width={Math.min(600,Math.max(100,e.text.length*11))} height="32" fill="#fff4b8" opacity=".9"/><text fill={e.color} fontSize="20">{e.text||'Нотатка'}</text></>:
     e.kind==='MARKER'?<><circle r="12" fill={e.color}/><text x="18" y="6" fill={e.color} fontSize="20">{e.text}</text></>:
     <><polyline points={e.points.map(p=>`${p.x},${p.y}`).join(' ')+(e.kind==='CONTOUR'&&e.points.length?` ${e.points[0]!.x},${e.points[0]!.y}`:'')} stroke="transparent" strokeWidth="18" fill="none"/><polyline points={e.points.map(p=>`${p.x},${p.y}`).join(' ')+(e.kind==='CONTOUR'&&e.points.length?` ${e.points[0]!.x},${e.points[0]!.y}`:'')} stroke={e.color} strokeWidth="4" strokeDasharray={e.kind==='ROUTE'?'12 7':undefined} strokeLinecap="round" fill={e.kind==='CONTOUR'?e.color:'none'} fillOpacity={e.kind==='CONTOUR'?.12:1}/></>}
    {e.locked&&<text x="-12" y="-28" fontSize="20" fill="#a32727">🔒</text>}
   </g>;})}
   {draft.length>0&&<polyline pointerEvents="none" points={draft.map(p=>`${p.x},${p.y}`).join(' ')} stroke={color} strokeWidth="4" fill="none"/>}
   </g>
  </g>
 </svg></div>;
}
