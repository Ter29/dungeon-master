import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { ClientEvents, ServerEvents, Snapshot, Ping, Reply, Point, SceneId } from '@dnd/shared';

export function Room({ campaignId, role }: { campaignId: string; role: 'DM' | 'PLAYER' }) {
  const connection = useRef<Socket<ServerEvents, ClientEvents> | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState('Підключення…');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [ping, setPing] = useState<Ping | null>(null);
  useEffect(() => {
    const socket: Socket<ServerEvents, ClientEvents> = io({ auth: { campaignId }, autoConnect: false });
    connection.current = socket;
    setSnapshot(null); setReady(false); setPing(null); setError('');
    socket.on('connect', () => { setStatus('Синхронізація…'); setReady(false); setError(''); });
    socket.on('room:snapshot', next => {
      setSnapshot(previous => !previous || next.version >= previous.version ? next : previous);
      setReady(true); setStatus('Онлайн');
    });
    socket.on('room:ping', setPing);
    socket.on('room:error', setError);
    socket.on('disconnect', () => { setReady(false); setBusy(false); setPing(null); setStatus('З’єднання втрачено. Очікуємо перепідключення…'); });
    socket.on('connect_error', event => { setReady(false); setStatus('Не підключено'); setError(event.message); });
    socket.connect();
    return () => { connection.current = null; socket.removeAllListeners(); socket.disconnect(); };
  }, [campaignId]);
  useEffect(() => {
    if (!ping) return;
    const timer = setTimeout(() => setPing(null), 3000);
    return () => clearTimeout(timer);
  }, [ping]);
  useEffect(() => { setPing(null); }, [snapshot?.state.activeScene]);
  function acknowledge(timeoutError: Error | null, reply: Reply) {
    setBusy(false);
    if (timeoutError) {
      setError('Сервер не підтвердив дію. Синхронізуємо стан…');
      if (connection.current?.connected) connection.current.timeout(10000).emit('room:sync', (err, result) => {
        if (err || !result.ok) setError('Не вдалося синхронізувати. Перепідключіться.');
      });
    } else if (!reply.ok) setError(reply.message);
  }
  function act(position: Point) {
    const socket = connection.current;
    if (!socket?.connected || !ready || !snapshot || busy) return;
    setBusy(true); setError('');
    if (role === 'DM') socket.timeout(10000).emit('token:move', { ...position, version: snapshot.version }, acknowledge);
    else socket.timeout(10000).emit('player:ping', position, acknowledge);
  }
  function changeScene(scene: SceneId) {
    const socket = connection.current;
    if (!socket?.connected || !ready || !snapshot || busy) return;
    setBusy(true); setError('');
    socket.timeout(10000).emit('scene:change', { scene, version: snapshot.version }, acknowledge);
  }
  const position = snapshot?.state.positions[snapshot.state.activeScene];
  return <section aria-label="Спільна кімната">
    <h3>Спільна кімната</h3><p role="status">{status}</p>
    <button onClick={() => { connection.current?.disconnect(); connection.current?.connect(); }}>Перепідключитися</button>
    {error && <p role="alert">{error}</p>}
    {snapshot && <>
      <h4>Учасники</h4><ul>{snapshot.members.map(m => <li key={m.userId}>{m.displayName} — {m.role === 'DM' ? 'DM' : 'Гравець'} · {m.online ? 'онлайн' : 'офлайн'}</li>)}</ul>
      <p>Поточна сцена: {snapshot.state.activeScene === 'scene-1' ? '1' : '2'} · версія {snapshot.version}</p>
      {role === 'DM' && <p>{(['scene-1', 'scene-2'] as const).map((scene, index) => <button key={scene} disabled={!ready || busy || snapshot.state.activeScene === scene} onClick={() => changeScene(scene)}>Сцена {index + 1}</button>)}</p>}
      <p>{role === 'DM' ? 'Натисніть на поле, щоб перемістити тестовий токен.' : 'Натисніть на поле, щоб показати DM, куди хочете піти.'}</p>
      <div style={{ width: 'min(100%, 640px)', aspectRatio: '4 / 3', position: 'relative', border: '1px solid #888', backgroundColor: '#f0eee7', backgroundImage: 'linear-gradient(#ccc 1px, transparent 1px), linear-gradient(90deg, #ccc 1px, transparent 1px)', backgroundSize: '10% 10%', cursor: ready && !busy ? 'crosshair' : 'wait' }}
        onClick={event => {
          const box = event.currentTarget.getBoundingClientRect();
          act({ x: Math.max(0, Math.min(100, (event.clientX - box.left) / box.width * 100)), y: Math.max(0, Math.min(100, (event.clientY - box.top) / box.height * 100)) });
        }}>
        {position && <span aria-label="Тестовий токен" style={{ position: 'absolute', left: `${position.x}%`, top: `${position.y}%`, transform: 'translate(-50%, -50%)', color: '#fff', background: '#333', borderRadius: '50%', width: 28, height: 28, textAlign: 'center', lineHeight: '28px', pointerEvents: 'none' }}>T</span>}
        {ping && <span style={{ position: 'absolute', left: `${ping.x}%`, top: `${ping.y}%`, transform: 'translate(-50%, -50%)', color: '#982900', pointerEvents: 'none' }}>◎ {ping.displayName}</span>}
      </div>
      <form onSubmit={event => {
        event.preventDefault(); const data = new FormData(event.currentTarget);
        act({ x: Number(data.get('x')), y: Number(data.get('y')) });
      }}><fieldset disabled={!ready || busy}><legend>{role === 'DM' ? 'Перемістити токен за координатами' : 'Пінг за координатами'}</legend>
        <label>X <input name="x" type="number" min="0" max="100" step="any" required defaultValue="50" /></label>{' '}
        <label>Y <input name="y" type="number" min="0" max="100" step="any" required defaultValue="50" /></label>{' '}
        <button>{role === 'DM' ? 'Перемістити' : 'Пінг'}</button>
      </fieldset></form>
    </>}
  </section>;
}
