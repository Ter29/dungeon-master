import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api, errorMessage } from '../../lib/api';
import { useAuth } from '../auth/AuthContext';

export function JoinPage() {
  const { code } = useParams();
  const auth = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const redirect = encodeURIComponent(`/join/${code}`);
  async function join() {
    setBusy(true); setError('');
    try {
      const { campaign } = await api<{ campaign: { id: string } }>(`/invites/${code}/join`, {});
      navigate(`/campaigns/${campaign.id}`, { replace: true });
    } catch (error) { setError(errorMessage(error)); }
    finally { setBusy(false); }
  }
  return <section><h2>Запрошення до кампанії</h2>
    {!auth.user ? <p>Щоб приєднатися, <Link to={`/login?next=${redirect}`}>увійдіть</Link> або <Link to={`/register?next=${redirect}`}>зареєструйтеся</Link>.</p>
      : <><p>Приєднатися як {auth.user.displayName}?</p><button disabled={busy} onClick={() => void join()}>{busy ? 'Приєднуємо…' : 'Приєднатися до кампанії'}</button></>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
