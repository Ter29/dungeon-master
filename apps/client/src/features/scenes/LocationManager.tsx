import { useEffect, useState, type FormEvent } from 'react';
import type { LocationView } from '@dnd/shared';
import { api, errorMessage } from '../../lib/api';

type List = { scenes: LocationView[]; version: number; activeLocationId: string | null; storageAvailable: boolean };
export function LocationManager({ campaignId, refreshKey }: { campaignId: string; refreshKey: number }) {
  const base = `/campaigns/${campaignId}/locations`;
  const [list, setList] = useState<List | null>(null);
  const [selected, setSelected] = useState<LocationView | null>(null);
  const [name, setName] = useState(''); const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [deleting, setDeleting] = useState(false);
  async function load() { setList(await api<List>(base)); }
  useEffect(() => { let live = true; void api<List>(base).then(result => { if (live) setList(result); }).catch(error => { if (live) setError(errorMessage(error)); }); return () => { live = false; }; }, [base, refreshKey]);
  function edit(scene: LocationView | null) { setSelected(scene); setName(scene?.name ?? ''); setDescription(scene?.description ?? ''); setDeleting(false); setError(''); }
  async function run(action: () => Promise<void>) {
    setBusy(true); setError('');
    try { await action(); await load(); } catch (error) { setError(errorMessage(error)); }
    finally { setBusy(false); }
  }
  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void run(async () => {
      const { scene } = await api<{ scene: LocationView }>(selected ? `${base}/${selected.id}` : base,
        { name, description, ...(selected ? { revision: selected.revision } : {}) }, selected ? 'PATCH' : 'POST');
      edit(scene);
    });
  }
  function activate(sceneId: string | null) {
    if (!list) return;
    void run(async () => { await api(`${base}/activate`, { sceneId, version: list.version }); });
  }
  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const file = data.get('file');
    if (!(file instanceof File) || !file.size || file.size > 8 * 1024 * 1024) { setError('Оберіть PNG/JPG розміром до 8 МіБ.'); return; }
    data.set('revision', String(selected.revision));
    await run(async () => {
      const { scene } = await api<{ scene: LocationView }>(`${base}/${selected.id}/background`, data);
      edit(scene); form.reset();
    });
  }
  return <section aria-label="Менеджер локацій"><h3>Локації · DM</h3>
    {error && <p role="alert">{error}</p>}
    <button disabled={busy} onClick={() => void run(load)}>Оновити список</button>{' '}
    <button disabled={busy} onClick={() => edit(null)}>Нова локація</button>{' '}
    <button disabled={busy || !list} onClick={() => activate(null)}>Залишити стіл порожнім</button>
    {!list ? <p>Завантаження списку…</p> : <>
      {!list.storageAvailable && <p>Завантаження зображень недоступне: сховище ще не налаштовано.</p>}
      {!list.scenes.length && <p>Підготовлених локацій ще немає.</p>}
      <ul>{list.scenes.map(scene => <li key={scene.id}>
        <button disabled={busy} onClick={() => edit(scene)}>{scene.name}</button>{' '}
        {list.activeLocationId === scene.id ? <strong>Активна</strong> : <button disabled={busy} onClick={() => activate(scene.id)}>Активувати</button>}
      </li>)}</ul>
    </>}
    <form onSubmit={save}><fieldset disabled={busy}><legend>{selected ? 'Редагувати локацію' : 'Створити локацію'}</legend>
      <p><label>Назва <input required maxLength={120} value={name} onChange={event => setName(event.target.value)} /></label></p>
      <p><label>Опис, видимий гравцям активної локації <textarea maxLength={4000} value={description} onChange={event => setDescription(event.target.value)} /></label></p>
      <button>{busy ? 'Зберігаємо…' : 'Зберегти'}</button>
      {selected && <button type="button" onClick={() => void run(async () => { edit((await api<{ scene: LocationView }>(`${base}/${selected.id}`)).scene); })}>Перезавантажити локацію</button>}
    </fieldset></form>
    {selected && <div>
      <h4>Фонове зображення</h4>
      {selected.background && <img key={selected.background.id} src={selected.background.url} alt={`Попередній перегляд: ${selected.name}`} style={{ maxWidth: '100%', maxHeight: 240 }} />}
      <form key={selected.id} onSubmit={event => void upload(event)}><fieldset disabled={busy || !list?.storageAvailable}>
        <label>PNG/JPG, до 8 МіБ і 20 мегапікселів <input type="file" name="file" accept="image/png,image/jpeg" required /></label>{' '}
        <button>{busy ? 'Завантаження…' : selected.background ? 'Замінити фон' : 'Завантажити фон'}</button>
      </fieldset></form>
      {!deleting ? <button disabled={busy} onClick={() => setDeleting(true)}>Видалити локацію…</button> : <p>Видалити «{selected.name}»? Якщо вона активна, стіл стане порожнім.{' '}
        <button disabled={busy} onClick={() => void run(async () => { await api(`${base}/${selected.id}`, { revision: selected.revision }, 'DELETE'); edit(null); })}>Так, видалити</button>{' '}
        <button disabled={busy} onClick={() => setDeleting(false)}>Скасувати</button>
      </p>}
    </div>}
  </section>;
}
