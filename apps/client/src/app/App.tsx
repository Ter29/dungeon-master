import { useState } from "react";
import { Link, Navigate, Route, Routes, useLocation } from "react-router";
import { AuthProvider, useAuth } from "../features/auth/AuthContext";
import { AuthPage } from "../features/auth/AuthPage";
import { CampaignsPage } from "../features/campaigns/CampaignsPage";
import { CampaignPage } from "../features/campaigns/CampaignWorkspace";
import { Icon } from "../features/workspace/icons";
import "./theme.css";
import './live.css';
import { JoinPage } from "../features/campaigns/JoinPage";

export function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}

function AppContent() {
  const auth = useAuth();
  const campaignRoute = /^\/campaigns\/[^/]+$/.test(useLocation().pathname);
  const [logoutError, setLogoutError] = useState("");
  const [loggingOut, setLoggingOut] = useState(false);
  if (auth.loading) return <p role="status">Перевіряємо вхід…</p>;
  if (auth.error)
    return (
      <main>
        <p role="alert">{auth.error}</p>
        <button onClick={() => void auth.refresh()}>Повторити</button>
      </main>
    );
  async function logout() {
    setLoggingOut(true);
    setLogoutError("");
    try {
      await auth.logout();
    } catch {
      setLogoutError("Не вдалося вийти. Спробуйте ще раз.");
    } finally {
      setLoggingOut(false);
    }
  }
  return (
    <div className={campaignRoute ? "campaign-app" : "site-app"}>
      {!campaignRoute && (
        <header className="site-header">
          <Link to="/" className="site-brand">
            <Icon name="brand" />
            <span>
              OBSIDIAN <strong>TABLE</strong>
            </span>
          </Link>
          <nav>
            <Link to="/">Головна</Link>
            <Link to="/campaigns">Кампанії</Link>
          </nav>
          {auth.user ? (
            <p>
              {auth.user.displayName}{" "}
              <button disabled={loggingOut} onClick={() => void logout()}>
                Вийти
              </button>
            </p>
          ) : (
            <p>
              <Link to="/login">Увійти</Link> |{" "}
              <Link to="/register">Реєстрація</Link>
            </p>
          )}
          {logoutError && <p role="alert">{logoutError}</p>}
        </header>
      )}
      <Routes>
        <Route path="/login" element={<AuthPage key="login" mode="login" />} />
        <Route
          path="/register"
          element={<AuthPage key="register" mode="register" />}
        />
        <Route
          path="/"
          element={
            <section className="home-hero">
              <span className="eyebrow">A PLACE FOR UNFORGETTABLE STORIES</span>
              <h1>
                Ваш світ.
                <br />
                <em>Їхня пригода.</em>
              </h1>
              <p>
                Карти, персонажі, музика й моменти, які залишаться з вами. Усе,
                що потрібно майстру, — за одним столом.
              </p>
              <Link className="primary-button" to="/campaigns">
                Відкрити мої кампанії <Icon name="arrow" />
              </Link>
              <div className="hero-rule">
                OBSIDIAN TABLE <span>✦</span> ВАША НАСТУПНА ІСТОРІЯ
              </div>
            </section>
          }
        />
        <Route
          path="/campaigns"
          element={
            auth.user ? (
              <CampaignsPage key={auth.user.id} />
            ) : (
              <Navigate to="/login" replace />
            )
          }
        />
        <Route
          path="/campaigns/:id"
          element={
            auth.user ? (
              <CampaignPage key={auth.user.id} />
            ) : (
              <Navigate to="/login" replace />
            )
          }
        />
        <Route path="/join/:code" element={<JoinPage />} />
        <Route path="*" element={<p>Сторінку не знайдено.</p>} />
      </Routes>
    </div>
  );
}
