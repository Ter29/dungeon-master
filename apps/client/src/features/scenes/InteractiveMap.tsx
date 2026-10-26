import { useEffect, useRef, useState, type PointerEvent } from 'react';
import type { LocationView, TokenView, LocationPing } from '@dnd/shared';
type Point={x:number;y:number};
type Camera=Point&{scale:number};
export function InteractiveMap({scene,dm,ready,move,ping,pulse}:{scene:LocationView;dm:boolean;ready:boolean;move:(token:TokenView,point:Point)=>Promise<void>;ping:(point:Point)=>void;pulse:LocationPing|null}){
  const svg=useRef<SVGSVGElement|null>(null);
  const fit=()=>{const scale=Math.min(1000/scene.width,650/scene.height)*.95;return {scale,x:(1000-scene.width*scale)/2,y:(650-scene.height*scale)/2};};
  const [camera,setCamera]=useState<Camera>(fit);
  const [preview,setPreview]=useState<(Point&{id:string})|null>(null);
  const [saving,setSaving]=useState(false);
  const [imageError,setImageError]=useState(false);
  useEffect(()=>setImageError(false),[scene.background?.id]);
  const gesture=useRef<{start:Point;last:Point;token?:TokenView;moved:boolean}|null>(null);
  useEffect(()=>{setCamera(fit());setPreview(null);gesture.current=null;},[scene.id,scene.width,scene.height]);
  useEffect(()=>{if(!ready){gesture.current=null;setPreview(null);}},[ready]);
  function viewPoint(event:{clientX:number;clientY:number}){const p=svg.current!.createSVGPoint();p.x=event.clientX;p.y=event.clientY;return p.matrixTransform(svg.current!.getScreenCTM()!.inverse());}
  function world(point:Point){return{x:Math.max(0,Math.min(scene.width,(point.x-camera.x)/camera.scale)),y:Math.max(0,Math.min(scene.height,(point.y-camera.y)/camera.scale))};}
  useEffect(()=>{
    const element=svg.current;if(!element)return;
    const wheel=(event:WheelEvent)=>{event.preventDefault();const point=element.createSVGPoint();point.x=event.clientX;point.y=event.clientY;const p=point.matrixTransform(element.getScreenCTM()!.inverse());
      setCamera(c=>{const scale=Math.max(.05,Math.min(10,c.scale*Math.exp(-event.deltaY*.001)));return{scale,x:p.x-(p.x-c.x)*scale/c.scale,y:p.y-(p.y-c.y)*scale/c.scale};});};
    element.addEventListener('wheel',wheel,{passive:false});return()=>element.removeEventListener('wheel',wheel);
  },[]);
  function begin(event:PointerEvent<SVGElement>,token?:TokenView){
    if(event.button!==0&&event.button!==1)return;
    event.preventDefault();event.stopPropagation();if(saving)return;
    const p=viewPoint(event);gesture.current={start:p,last:p,moved:false,token:dm&&ready&&!event.shiftKey&&event.button===0?token:undefined};
    svg.current!.setPointerCapture(event.pointerId);
  }
  async function finish(event:PointerEvent<SVGSVGElement>){
    const action=gesture.current;if(!action)return;gesture.current=null;
    if(svg.current?.hasPointerCapture(event.pointerId))svg.current.releasePointerCapture(event.pointerId);
    if(action.token&&action.moved&&ready){setSaving(true);try{await move(action.token,world(viewPoint(event)));}finally{setSaving(false);setPreview(null);}}
    else {setPreview(null);if(!action.moved&&!action.token&&ready)ping(world(viewPoint(event)));}
  }
  return <div>
    {imageError&&<p role="alert">Не вдалося завантажити фон. Спробуйте перепідключитися до кімнати.</p>}
    <p><button onClick={()=>setCamera(c=>({...c,scale:Math.min(10,c.scale*1.25)}))}>Збільшити</button>{' '}<button onClick={()=>setCamera(c=>({...c,scale:Math.max(.05,c.scale/1.25)}))}>Зменшити</button>{' '}<button onClick={()=>setCamera(fit())}>Reset View</button>{' '}
      <button aria-label="Камера ліворуч" onClick={()=>setCamera(c=>({...c,x:c.x+50}))}>←</button><button aria-label="Камера праворуч" onClick={()=>setCamera(c=>({...c,x:c.x-50}))}>→</button><button aria-label="Камера вгору" onClick={()=>setCamera(c=>({...c,y:c.y+50}))}>↑</button><button aria-label="Камера вниз" onClick={()=>setCamera(c=>({...c,y:c.y-50}))}>↓</button> Масштаб {Math.round(camera.scale*100)}%</p>
    <p>Колесо — масштаб; перетягування фону — камера. {dm?'Перетягніть токен для переміщення; Shift — камера.':'Натисніть на карту для пінгу. Токенами керує DM.'}</p>
    <svg ref={svg} role="img" aria-label={`Інтерактивна локація: ${scene.name}`} viewBox="0 0 1000 650" preserveAspectRatio="xMidYMid meet" style={{width:'100%',height:'min(65vh,650px)',minHeight:300,background:'#20242b',touchAction:'none',userSelect:'none'}}
      onPointerDown={event=>begin(event)} onPointerMove={event=>{const action=gesture.current;if(!action)return;const p=viewPoint(event);if(Math.hypot(p.x-action.start.x,p.y-action.start.y)>3)action.moved=true;
        if(action.token)setPreview({...world(p),id:action.token.id});else if(action.moved)setCamera(c=>({...c,x:c.x+p.x-action.last.x,y:c.y+p.y-action.last.y}));action.last=p;}}
      onPointerUp={event=>void finish(event)} onPointerCancel={()=>{gesture.current=null;setPreview(null);}}>
      <defs><pattern id={`grid-${scene.id}`} x={scene.grid.offsetX} y={scene.grid.offsetY} width={scene.grid.size} height={scene.grid.size} patternUnits="userSpaceOnUse"><path d={`M ${scene.grid.size} 0 L 0 0 0 ${scene.grid.size}`} fill="none" stroke="#fff" strokeWidth="1" opacity=".6"/></pattern>
        {scene.tokens.map(token=><clipPath key={token.id} id={`clip-${token.id}`}><circle r={token.size/2}/></clipPath>)}
      </defs>
      <g transform={`translate(${camera.x} ${camera.y}) scale(${camera.scale})`}>
        <rect width={scene.width} height={scene.height} fill="#665849"/>
        {scene.background&&<image href={scene.background.url} width={scene.width} height={scene.height} preserveAspectRatio="none" onError={()=>setImageError(true)} onLoad={()=>setImageError(false)}/>}
        {scene.grid.visible&&<rect width={scene.width} height={scene.height} fill={`url(#grid-${scene.id})`} pointerEvents="none"/>}
        {scene.tokens.map(token=>{const pos=preview?.id===token.id?preview:token;return <g key={token.id} data-token-id={token.id} transform={`translate(${pos.x} ${pos.y})`} opacity={token.hidden?.45:1} onPointerDown={event=>begin(event,token)} style={{cursor:dm&&ready?'grab':'crosshair'}}>
          <title>{token.name}{token.hidden?' · прихований':''}</title><circle r={token.size/2} fill={token.kind==='ENEMY'?'#a33333':token.kind==='PLAYER'?'#2862aa':'#806424'}/>
          {token.image&&<image href={token.image.url} x={-token.size/2} y={-token.size/2} width={token.size} height={token.size} preserveAspectRatio="xMidYMid slice" clipPath={`url(#clip-${token.id})`}/>}
          <circle r={token.size/2} fill="none" stroke={token.hidden?'#ffcf66':'white'} strokeWidth="2" strokeDasharray={token.hidden?'5 3':undefined}/><text textAnchor="middle" y={-token.size/2-7} fill="white" stroke="#111" strokeWidth=".5" fontSize="14">{token.name}</text>
        </g>;})}
        {pulse&&pulse.sceneId===scene.id&&<g transform={`translate(${pulse.x} ${pulse.y})`} pointerEvents="none"><circle r="15" stroke="#ffdb00" strokeWidth="4" fill="none"/><text y="-22" fill="#ffdb00" fontSize="18">{pulse.displayName}</text></g>}
      </g>
    </svg>
    {saving&&<p role="status">Зберігаємо позицію…</p>}
  </div>;
}
