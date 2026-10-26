import {CinematicDirector} from '../director/CinematicDirector';
import {Cartography} from '../cartography/Cartography';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { api, errorMessage } from '../../lib/api';
import type { Campaign } from './CampaignsPage';
import { Room } from '../room/Room';
import { LocationTable } from '../scenes/LocationTable';

type Details = Campaign & { members: { userId: string; displayName: string; role: string }[] };
type Invite = { id: string; expiresAt: string; revokedAt: string | null };
export function CampaignPage() {
  const [tab,setTab]=useState('table');
  const [mapsVisited,setMapsVisited]=useState(false);
  const { id } = useParams();
  const [campaign, setCampaign] = useState<Details | null>(null);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [link, setLink] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  async function load() {
    setLoading(true); setError('');
    try {
      const { campaign } = await api<{ campaign: Details }>(`/campaigns/${id}`);
      setCampaign(campaign);
      if (campaign.role === 'DM') setInvites((await api<{ invites: Invite[] }>(`/campaigns/${id}/invites`)).invites);
    } catch (error) { setCampaign(null); setError(errorMessage(error)); }
    finally { setLoading(false); }
  }
  useEffect(() => { setLink(''); void load(); }, [id]);
  async function createInvite() {
    setBusy(true); setError('');
    try {
      const { invite } = await api<{ invite: { url: string } }>(`/campaigns/${id}/invites`, {});
      setLink(invite.url);
      await load();
    } catch (error) { setError(errorMessage(error)); }
    finally { setBusy(false); }
  }
  async function revoke(inviteId: string) {
    setBusy(true); setError('');
    try { await api(`/campaigns/${id}/invites/${inviteId}/revoke`, {}); setLink(''); await load(); }
    catch (error) { setError(errorMessage(error)); }
    finally { setBusy(false); }
  }
  return <section>
    {error && <p role="alert">{error}</p>}
    <button disabled={busy || loading} onClick={() => void load()}>Оновити</button>
    {loading ? <p role="status">Завантаження…</p> : campaign && <>
      <h2>{campaign.name}</h2><p>Ваша роль: {campaign.role === 'DM' ? 'DM' : 'Гравець'}</p>
      <CinematicDirector key={`director-${campaign.id}`} campaignId={campaign.id} dm={campaign.role==='DM'} onTable={()=>setTab('table')}>
      <div role="tablist" aria-label="Розділи кампанії"><button role="tab" aria-selected={tab==='table'} onClick={()=>setTab('table')}>Ігровий стіл</button><button role="tab" aria-selected={tab==='maps'} onClick={()=>{setMapsVisited(true);setTab('maps');}}>Карти</button></div>
      <div role="tabpanel" hidden={tab!=='table'}><LocationTable key={campaign.id} campaignId={campaign.id} role={campaign.role} /></div>
      {mapsVisited&&<div role="tabpanel" hidden={tab!=='maps'}><Cartography key={campaign.id} campaignId={campaign.id} dm={campaign.role==='DM'}/></div>}
      <details><summary>Тестовий стіл Sprint 1</summary><Room key={campaign.id} campaignId={campaign.id} role={campaign.role} /></details>
      {campaign.role === 'DM' && <div><h3>Запрошення</h3>
        <button disabled={busy} onClick={() => void createInvite()}>Створити посилання на 7 днів</button>
        {link && <p><label>Скопіюйте посилання <input aria-label="Посилання запрошення" readOnly value={link} onFocus={e => e.currentTarget.select()} /></label> Збережіть його зараз: після виходу зі сторінки воно не відображатиметься.</p>}
        <ul>{invites.map(invite => <li key={invite.id}>
          До {new Date(invite.expiresAt).toLocaleString('uk-UA')} — {invite.revokedAt ? 'відкликано' : new Date(invite.expiresAt) <= new Date() ? 'прострочено' : 'активне'}{' '}
          {!invite.revokedAt && new Date(invite.expiresAt) > new Date() && <button disabled={busy} onClick={() => void revoke(invite.id)}>Відкликати</button>}
        </li>)}</ul>
      </div>}
      </CinematicDirector>
    </>}
  </section>;
}
