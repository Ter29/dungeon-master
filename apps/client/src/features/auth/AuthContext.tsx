import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

type User = { id: string; email: string; displayName: string };
async function request(path: string, data?: unknown): Promise<{ user: User }> {
  const response = await fetch(`/api/auth/${path}`, {
    credentials: 'same-origin',
    ...(data !== undefined ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) } : {}),
  });
  if (response.status === 204) return {} as { user: User };
  const body = await response.json();
  if (!response.ok) throw new Error(body.message ?? 'Не вдалося виконати запит.');
  return body;
}
type Auth = {
  user: User | null; loading: boolean; error: string;
  refresh: () => Promise<void>;
  submit: (mode: 'login' | 'register', data: Record<string, string>) => Promise<void>;
  logout: () => Promise<void>;
};
const Context = createContext<Auth | null>(null);
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  async function refresh() {
    setLoading(true); setError('');
    try {
      const response = await fetch('/api/auth/me', { credentials: 'same-origin' });
      if (response.status === 401) setUser(null);
      else if (!response.ok) throw new Error();
      else setUser((await response.json()).user);
    } catch { setError('Сервер недоступний. Спробуйте ще раз.'); }
    finally { setLoading(false); }
  }
  useEffect(() => { void refresh(); }, []);
  async function submit(mode: 'login' | 'register', data: Record<string, string>) {
    const result = await request(mode, data); setUser(result.user); setError('');
  }
  async function logout() { await request('logout', {}); setUser(null); }
  return <Context.Provider value={{ user, loading, error, refresh, submit, logout }}>{children}</Context.Provider>;
}
export function useAuth() {
  const auth = useContext(Context);
  if (!auth) throw new Error('AuthProvider is missing');
  return auth;
}
