import { useState } from 'react';
import { Link, Navigate, Route, Routes } from 'react-router';
import { AuthProvider, useAuth } from '../features/auth/AuthContext';
import { AuthPage } from '../features/auth/AuthPage';
import { CampaignsPage } from '../features/campaigns/CampaignsPage';
import { CampaignPage } from '../features/campaigns/CampaignPage';
import { JoinPage } from '../features/campaigns/JoinPage';

export function App() {
  return <AuthProvider><AppContent /></AuthProvider>;
}

function AppContent() {
  const auth = useAuth();
  const [logoutError, setLogoutError] = useState('');
  const [loggingOut, setLoggingOut] = useState(false);
  if (auth.loading) return <p role="status">Перевіряємо вхід…</p>;
  if (auth.error) return <main><p role="alert">{auth.error}</p><button onClick={() => void auth.refresh()}>Повторити</button></main>;
  async function logout() {
    setLoggingOut(true); setLogoutError('');
    try { await auth.logout(); }
    catch { setLogoutError('Не вдалося вийти. Спробуйте ще раз.'); }
    finally { setLoggingOut(false); }
  }
  return (
    <main>
      <h1>Dungeon Master</h1>
      <nav><Link to="/">Головна</Link> | <Link to="/campaigns">Кампанії</Link></nav>
      {auth.user ? <p>{auth.user.displayName} <button disabled={loggingOut} onClick={() => void logout()}>Вийти</button></p>
        : <p><Link to="/login">Увійти</Link> | <Link to="/register">Реєстрація</Link></p>}
      {logoutError && <p role="alert">{logoutError}</p>}
      <Routes>
        <Route path="/login" element={<AuthPage key="login" mode="login" />} />
        <Route path="/register" element={<AuthPage key="register" mode="register" />} />
        <Route path="/" element={<p>Фундамент сайту налаштовано.</p>} />
        <Route path="/campaigns" element={auth.user ? <CampaignsPage key={auth.user.id} /> : <Navigate to="/login" replace />} />
        <Route path="/campaigns/:id" element={auth.user ? <CampaignPage key={auth.user.id} /> : <Navigate to="/login" replace />} />
        <Route path="/join/:code" element={<JoinPage />} />
        <Route path="*" element={<p>Сторінку не знайдено.</p>} />
      </Routes>
    </main>
  );
}
