import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
import { useAuth } from './AuthContext';

export function AuthPage({ mode }: { mode: 'login' | 'register' }) {
  const auth = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const register = mode === 'register';
  if (auth.user) return <Navigate to="/campaigns" replace />;
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>;
    setBusy(true); setError('');
    try { await auth.submit(mode, data); navigate('/campaigns', { replace: true }); }
    catch (error) { setError(error instanceof Error ? error.message : 'Помилка з’єднання.'); }
    finally { setBusy(false); }
  }
  return <section>
    <h2>{register ? 'Реєстрація' : 'Вхід'}</h2>
    <form onSubmit={handleSubmit}>
      <fieldset disabled={busy}>
        {register && <p><label>Ім’я <input name="displayName" autoComplete="nickname" required maxLength={80} /></label></p>}
        <p><label>Email <input name="email" type="email" autoComplete="email" required maxLength={254} /></label></p>
        <p><label>Пароль <input name="password" type="password" autoComplete={register ? 'new-password' : 'current-password'} required minLength={12} maxLength={128} /></label></p>
        <p>Пароль: 12–128 символів.</p>
        <button type="submit">{busy ? 'Зачекайте…' : register ? 'Зареєструватися' : 'Увійти'}</button>
      </fieldset>
      {error && <p role="alert">{error}</p>}
    </form>
    <p><Link to={register ? '/login' : '/register'}>{register ? 'Уже є обліковий запис? Увійти' : 'Створити обліковий запис'}</Link></p>
  </section>;
}
