import { useEffect, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { ClientEvents, ServerEvents, LocationSnapshot, RoomMember } from '@dnd/shared';
import { LocationManager } from './LocationManager';

export function LocationTable({ campaignId, role }: { campaignId: string; role: 'DM' | 'PLAYER' }) {
  const [state, setState] = useState<LocationSnapshot | null>(null);
  const [status, setStatus] = useState('Підключення…');
  const [online, setOnline] = useState<RoomMember[]>([]);
  const [revision, setRevision] = useState(0);
  const [retry, setRetry] = useState(0);
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => {
    const socket: Socket<ServerEvents, ClientEvents> = io({ auth: { campaignId }, autoConnect: false });
    setState(null); setOnline([]); setStatus('Підключення…');
    socket.on('location:snapshot', snapshot => {
      setState(previous => !previous || snapshot.version >= previous.version ? snapshot : previous);
      setStatus('Онлайн');
    });
    socket.on('room:snapshot', snapshot => setOnline(snapshot.members));
    socket.on('locations:changed', () => setRevision(value => value + 1));
    socket.on('disconnect', () => { setState(null); setStatus('З’єднання втрачено. Перепідключення…'); });
    socket.on('connect_error', error => { setState(null); setStatus(error.message); });
    socket.on('room:error', setStatus);
    socket.connect();
    return () => { socket.removeAllListeners(); socket.disconnect(); };
  }, [campaignId, retry]);
  useEffect(() => { setImageFailed(false); }, [state?.scene?.background?.id]);
  return <section aria-label="Ігровий стіл"><h3>Ігровий стіл</h3>
    <p role="status">{status} <button onClick={() => setRetry(value => value + 1)}>Перепідключитися</button></p>
    <ul>{online.map(member => <li key={member.userId}>{member.displayName} · {member.role === 'DM' ? 'DM' : 'Гравець'} · {member.online ? 'онлайн' : 'офлайн'}</li>)}</ul>
    {!state ? <p>Очікуємо актуальний стан локації…</p> : !state.scene ? <p>Ігровий стіл порожній. DM ще не показав локацію.</p> : <article>
      <h4>{state.scene.name}</h4><p style={{ whiteSpace: 'pre-wrap' }}>{state.scene.description}</p>
      {state.scene.background ? <>
        {imageFailed && <p role="alert">Не вдалося завантажити зображення. <button onClick={() => setRetry(value => value + 1)}>Спробувати знову</button></p>}
        <img key={`${state.scene.background.id}-${retry}`} src={state.scene.background.url} alt={state.scene.name} onError={() => setImageFailed(true)} onLoad={() => setImageFailed(false)}
          width={state.scene.background.width} height={state.scene.background.height} style={{ display: imageFailed ? 'none' : 'block', width: '100%', height: 'auto', maxWidth: 1200 }} />
      </> : <p>Фон для цієї локації ще не завантажено.</p>}
    </article>}
    {role === 'DM' && <LocationManager campaignId={campaignId} refreshKey={revision + retry} />}
  </section>;
}
