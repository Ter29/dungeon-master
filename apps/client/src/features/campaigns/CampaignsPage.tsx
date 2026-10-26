import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { api, errorMessage } from '../../lib/api';

export type Campaign = { id: string; name: string; role: 'DM' | 'PLAYER' };
export function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  async function load() {
    setLoading(true); setError('');
    try { setCampaigns((await api<{ campaigns: Campaign[] }>('/campaigns')).campaigns); }
    catch (error) { setError(errorMessage(error)); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = String(new FormData(event.currentTarget).get('name') ?? '');
    setBusy(true); setError('');
    try {
      const { campaign } = await api<{ campaign: Campaign }>('/campaigns', { name });
      navigate(`/campaigns/${campaign.id}`);
    } catch (error) { setError(errorMessage(error)); }
    finally { setBusy(false); }
  }
  return <section><h2>Мої кампанії</h2>
    <form onSubmit={create}><label>Назва кампанії <input name="name" required maxLength={120} disabled={busy} /></label> <button disabled={busy}>{busy ? 'Створюємо…' : 'Створити кампанію'}</button></form>
    {error && <p role="alert">{error} <button onClick={() => void load()}>Оновити список</button></p>}
    {loading ? <p role="status">Завантаження…</p> : <>
      {!campaigns.length && <p>Кампаній поки немає. Створіть свою або перейдіть за запрошенням DM.</p>}
      <ul>{campaigns.map(c => <li key={c.id}><Link to={`/campaigns/${c.id}`}>{c.name}</Link> — {c.role === 'DM' ? 'DM' : 'Гравець'}</li>)}</ul>
    </>}
  </section>;
}
