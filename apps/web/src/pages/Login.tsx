import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.js';

export function Login() {
  const { login, error } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!email.includes('@')) {
      setLocalError('Email tidak valid');
      return;
    }
    if (!password) {
      setLocalError('Password wajib diisi');
      return;
    }
    setLocalError(null);
    setBusy(true);
    try {
      await login(email.trim(), password);
      nav('/');
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Login gagal');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl bg-white p-6 shadow">
        <h1 className="text-2xl font-bold" style={{ color: 'var(--loomy-burgundy)' }}>
          Loomy
        </h1>
        <p className="mb-4 text-sm opacity-60">Masuk untuk melanjutkan (F0)</p>
        <label className="mb-3 block text-sm">
          Email
          <input
            className="mt-1 w-full rounded-lg border px-3 py-2"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
          />
        </label>
        <label className="mb-4 block text-sm">
          Password
          <input
            type="password"
            className="mt-1 w-full rounded-lg border px-3 py-2"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </label>
        {(localError ?? error) && <p className="mb-3 text-sm text-red-700">{localError ?? error}</p>}
        <button
          disabled={busy}
          className="w-full rounded-lg px-3 py-2 font-medium text-white disabled:opacity-60"
          style={{ background: 'var(--loomy-burgundy)' }}
        >
          {busy ? 'Memproses…' : 'Masuk'}
        </button>
      </form>
    </div>
  );
}
