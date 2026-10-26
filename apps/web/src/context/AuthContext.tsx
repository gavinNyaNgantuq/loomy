import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from '../lib/api.js';

export interface SessionUser {
  id: number;
  name: string;
  email: string;
  role: 'admin' | 'gudang' | 'produksi' | 'kasir' | 'keuangan';
}

interface AuthState {
  user: SessionUser | null;
  token: string | null;
  loading: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

// Single-flight boot session: StrictMode dev me-mount ulang efek; tanpa ini
// request ganda paralel → reuse-detection cabut family, atau cleanup
// membatalkan satu-satunya handler sehingga loading macet selamanya.
let bootRefresh: Promise<{ accessToken: string; user: SessionUser } | null> | null = null;

function bootSession() {
  if (!bootRefresh) {
    bootRefresh = api.post('/auth/refresh').then(
      (r) => ({ accessToken: r.data.accessToken as string, user: r.data.user as SessionUser }),
      () => null,
    );
  }
  return bootRefresh;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  // B2: access token hanya di memori (state React). Tanpa web storage.
  const [user, setUser] = useState<SessionUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Pemulihan sesi memakai refresh token httpOnly via cookie (tak terbaca JS).
    bootSession().then((s) => {
      if (cancelled) return;
      if (s) {
        setToken(s.accessToken);
        setUser(s.user);
      } else {
        // Sesi tidak valid/kedaluwarsa: bersihkan status, tetap di login. Tanpa retry loop.
        setToken(null);
        setUser(null);
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    setError(null);
    try {
      const r = await api.post('/auth/login', { email, password });
      bootRefresh = null;
      setToken(r.data.accessToken);
      setUser(r.data.user);
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { error?: { message?: string } } } }).response?.data?.error?.message ??
        'Login gagal';
      setError(msg);
      throw new Error(msg);
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      bootRefresh = null;
      setToken(null);
      setUser(null);
    }
  }, []);

  return <Ctx.Provider value={{ user, token, loading, error, login, logout }}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth di luar provider');
  return v;
}
