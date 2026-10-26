import {useEffect,useRef,useState,type ReactNode} from 'react';
import {io,type Socket} from 'socket.io-client';
import type {ClientEvents,ServerEvents,DirectorSnapshot} from '@dnd/shared';
import {api,errorMessage} from '../../lib/api';
import {DirectorControls} from './DirectorControls';
import {PresentationScreen} from './PresentationScreen';
export function CinematicDirector({campaignId,dm,children,onTable}:{campaignId:string;dm:boolean;children:ReactNode;onTable:()=>void}){
 const [state,setState]=useState<DirectorSnapshot|null>(null),[online,setOnline]=useState(false),[status,setStatus]=useState('Підключення подачі…'),[libraryKey,setLibraryKey]=useState(0),[retry,setRetry]=useState(0);
 function accept(value:DirectorSnapshot){setState(previous=>!previous||value.version>=previous.version?value:previous);}
 async function refresh(){try{accept(await api<DirectorSnapshot>(`/campaigns/${campaignId}/director/state`));}catch(e){setStatus(errorMessage(e));}}
 useEffect(()=>{
  setState(null);setOnline(false);const socket:Socket<ServerEvents,ClientEvents>=io({auth:{campaignId},autoConnect:false});
  socket.on('director:snapshot',value=>{accept(value);setOnline(true);setStatus('Подача онлайн');});socket.on('director:library-changed',()=>setLibraryKey(n=>n+1));
  socket.on('disconnect',()=>{setState(null);setOnline(false);setStatus('Відновлюємо подачу…');});socket.on('connect_error',e=>{setState(null);setOnline(false);setStatus(e.message);});socket.on('room:error',setStatus);socket.connect();
  return()=>{socket.removeAllListeners();socket.disconnect();};
 },[campaignId,retry]);
 const previousMode=useRef<string|null>(null);
 useEffect(()=>{if(state?.mode==='TABLE'&&previousMode.current&&previousMode.current!=='TABLE')onTable();if(state)previousMode.current=state.mode;},[state?.mode,onTable]);
 const covered=!dm&&(!state||state.mode!=='TABLE');
 useEffect(()=>{if(!covered)return;const previous=document.body.style.overflow;document.body.style.overflow='hidden';return()=>{document.body.style.overflow=previous;};},[covered]);
 return <>
 {dm&&<><p role="status">{status} <button onClick={()=>setRetry(n=>n+1)}>Перепідключити подачу</button></p><details><summary>Scene Director · {state?.mode??'Підключення…'}</summary><DirectorControls campaignId={campaignId} state={state} ready={online&&Boolean(state)} refreshKey={libraryKey} onState={accept} refreshState={refresh}/></details></>}
 <div data-director-workspace="true" inert={covered} aria-hidden={covered}>{children}</div>
 {!dm&&<PresentationScreen state={state} fullscreen label="Екран презентації гравця"/>}
 </>;
}
