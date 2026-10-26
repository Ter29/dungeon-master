import { useEffect, useState, useRef } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { ClientEvents, ServerEvents, LocationSnapshot, RoomMember, LocationPing } from '@dnd/shared';
import { LocationManager } from './LocationManager';
import { InteractiveMap } from './InteractiveMap';
import { TokenManager } from './TokenManager';
import {api,errorMessage} from '../../lib/api';

export function LocationTable({ campaignId, role }: { campaignId: string; role: 'DM' | 'PLAYER' }) {
  const [state, setState] = useState<LocationSnapshot | null>(null);
  const [status, setStatus] = useState('Підключення…');
  const [online, setOnline] = useState<RoomMember[]>([]);
  const [revision, setRevision] = useState(0);
  const [retry, setRetry] = useState(0);

  const [tableError,setTableError]=useState('');
  const [pulse,setPulse]=useState<LocationPing|null>(null);
  const connection=useRef<Socket<ServerEvents,ClientEvents>|null>(null);
  useEffect(()=>{if(!pulse)return;const timer=setTimeout(()=>setPulse(null),3000);return()=>clearTimeout(timer);},[pulse]);
  useEffect(()=>setPulse(null),[state?.scene?.id]);
  useEffect(() => {
    const socket: Socket<ServerEvents, ClientEvents> = io({ auth: { campaignId }, autoConnect: false });
    connection.current=socket;
    setState(null); setOnline([]); setStatus('Підключення…');
    socket.on('location:snapshot', snapshot => {
      setState(previous => !previous || snapshot.version >= previous.version ? snapshot : previous);
      setStatus('Онлайн');
    });
    socket.on('room:snapshot', snapshot => setOnline(snapshot.members));
    socket.on('location:ping',setPulse);
    socket.on('locations:changed', () => setRevision(value => value + 1));
    socket.on('disconnect', () => { setState(null); setStatus('З’єднання втрачено. Перепідключення…'); });
    socket.on('connect_error', error => { setState(null); setStatus(error.message); });
    socket.on('room:error', setStatus);
    socket.connect();
    return () => { connection.current=null;socket.removeAllListeners(); socket.disconnect(); };
  }, [campaignId, retry]);
  return <section aria-label="Ігровий стіл"><h3>Ігровий стіл</h3>
    <p role="status">{status} <button onClick={() => setRetry(value => value + 1)}>Перепідключитися</button></p>
    <ul>{online.map(member => <li key={member.userId}>{member.displayName} · {member.role === 'DM' ? 'DM' : 'Гравець'} · {member.online ? 'онлайн' : 'офлайн'}</li>)}</ul>
    {!state ? <p>Очікуємо актуальний стан локації…</p> : !state.scene ? <p>Ігровий стіл порожній. DM ще не показав локацію.</p> : <article>
      <h4>{state.scene.name}</h4><p style={{ whiteSpace: 'pre-wrap' }}>{state.scene.description}</p>
      {tableError&&<p role="alert">{tableError}</p>}
      <InteractiveMap key={state.scene.id} scene={state.scene} dm={role==='DM'} ready={Boolean(connection.current?.connected)} pulse={pulse}
        move={async(token,point)=>{setTableError('');try{await api(`/campaigns/${campaignId}/locations/${state.scene!.id}/tokens/${token.id}`,{...point,revision:token.revision},'PATCH');}catch(error){setTableError(errorMessage(error));}}}
        ping={point=>{const socket=connection.current;if(!socket?.connected)return;socket.timeout(10000).emit('location:ping',{...point,sceneId:state.scene!.id},(error,reply)=>{if(error)setTableError('Пінг не підтверджено.');else if(!reply.ok)setTableError(reply.message);});}}/>
      {role==='DM'&&<TokenManager key={state.scene.id} scene={state.scene} campaignId={campaignId}/>}

    </article>}
    {role === 'DM' && <LocationManager campaignId={campaignId} refreshKey={revision + retry} />}
  </section>;
}
