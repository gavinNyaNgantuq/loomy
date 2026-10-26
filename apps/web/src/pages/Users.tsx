import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api } from '../lib/api.js';
import { useAuth, type SessionUser } from '../context/AuthContext.js';

interface UserRow {
  id: number;
  name: string;
  email: string;
  role: SessionUser['role'];
  is_active: boolean;
}

interface Meta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

const EMPTY_META: Meta = { page: 1, limit: 20, total: 0, totalPages: 0 };
const ROLES: SessionUser['role'][] = ['admin', 'gudang', 'produksi', 'kasir', 'keuangan'];

function errMsg(e: unknown): { status?: number; message: string } {
  const r = (e as { response?: { status?: number; data?: { error?: { message?: string } } } }).response;
  return { status: r?.status, message: r?.data?.error?.message ?? 'Request gagal' };
}

export function Users() {
  const { user: me, token, logout } = useAuth();
  const [items, setItems] = useState<UserRow[]>([]);
  const [meta, setMeta] = useState<Meta>(EMPTY_META);
  const [q, setQ] = useState('');
  const [qSent, setQSent] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<SessionUser['role']>('kasir');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const isAdmin = me?.role === 'admin';

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params: Record<string, string | number> = { page, limit: 20 };
      if (qSent) params.q = qSent;
      const r = await api.get('/users', { headers, params });
      setItems(r.data.data);
      setMeta(r.data.meta);
    } catch (e) {
      const err = errMsg(e);
      if (err.status === 401) {
        await logout();
        return;
      }
      setError(err.message);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, qSent, token]);

  useEffect(() => {
    if (isAdmin) load();
    else setLoading(false);
  }, [load, isAdmin]);

  if (!isAdmin) {
    return (
      <div>
        <h2 className="text-xl font-bold">Pengguna</h2>
        <p className="mt-2 rounded-2xl bg-white p-4 text-sm text-red-700 shadow">
          Halaman ini hanya untuk admin. Hubungi administrator untuk pengelolaan akun.
        </p>
      </div>
    );
  }

  function startEdit(u: UserRow) {
    setEditingId(u.id);
    setName(u.name);
    setEmail(u.email);
    setPassword('');
    setRole(u.role);
    setFormError(null);
    setOkMsg(null);
  }

  function resetForm() {
    setEditingId(null);
    setName('');
    setEmail('');
    setPassword('');
    setRole('kasir');
    setFormError(null);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    setOkMsg(null);
    if (!name.trim()) {
      setFormError('Nama wajib diisi');
      return;
    }
    setSaving(true);
    try {
      if (editingId === null) {
        if (!email.includes('@')) {
          setFormError('Email tidak valid');
          return;
        }
        if (password.length < 8) {
          setFormError('Password minimal 8 karakter');
          return;
        }
        await api.post('/users', { name: name.trim(), email: email.trim(), password, role }, { headers });
        setOkMsg('User ditambah');
      } else {
        if (editingId === me?.id) {
          setFormError('Akun sendiri tidak dapat diubah dari halaman ini');
          return;
        }
        await api.patch(`/users/${editingId}`, { name: name.trim(), role }, { headers });
        setOkMsg('User diubah');
      }
      resetForm();
      load();
    } catch (e) {
      const err = errMsg(e);
      if (err.status === 401) {
        await logout();
        return;
      }
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(u: UserRow) {
    if (u.id === me?.id) {
      setFormError('Akun sendiri tidak dapat dinonaktifkan');
      return;
    }
    setFormError(null);
    setOkMsg(null);
    try {
      await api.patch(`/users/${u.id}`, { is_active: !u.is_active }, { headers });
      setOkMsg(u.is_active ? 'Akun dinonaktifkan' : 'Akun diaktifkan');
      load();
    } catch (e) {
      const err = errMsg(e);
      if (err.status === 401) {
        await logout();
        return;
      }
      setFormError(err.message);
    }
  }

  return (
    <div>
      <h2 className="text-xl font-bold">Pengguna</h2>
      <p className="mt-1 text-sm opacity-70">Kelola akun dan role. Hapus fisik dilarang; gunakan nonaktif. Tanpa password tampil.</p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          setQSent(q.trim());
        }}
        className="mt-4 flex flex-col gap-2 sm:flex-row"
      >
        <input
          className="flex-1 rounded-lg border bg-white px-3 py-2"
          placeholder="Cari nama / email…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button className="rounded-lg px-4 py-2 font-medium text-white" style={{ background: 'var(--loomy-burgundy)' }}>
          Cari
        </button>
      </form>

      <form onSubmit={submit} className="mt-4 rounded-2xl bg-white p-4 shadow">
        <div className="text-sm font-bold">{editingId === null ? 'Tambah user' : `Ubah user #${editingId}`}</div>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <input className="rounded-lg border px-3 py-2" placeholder="Nama" value={name} onChange={(e) => setName(e.target.value)} />
          <input
            className="rounded-lg border px-3 py-2 disabled:opacity-50"
            placeholder="Email"
            value={email}
            disabled={editingId !== null}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="off"
          />
          {editingId === null && (
            <input
              type="password"
              className="rounded-lg border px-3 py-2"
              placeholder="Password (min 8)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
            />
          )}
          <select className="rounded-lg border bg-white px-3 py-2" value={role} onChange={(e) => setRole(e.target.value as SessionUser['role'])}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
        {editingId !== null && <p className="mt-1 text-xs opacity-60">Email dan password tidak dapat diubah dari sini. Akun sendiri tidak dapat diubah.</p>}
        {formError && <p className="mt-2 text-sm text-red-700">{formError}</p>}
        {okMsg && <p className="mt-2 text-sm text-green-700">{okMsg}</p>}
        <div className="mt-3 flex gap-2">
          <button disabled={saving} className="rounded-lg px-4 py-2 font-medium text-white disabled:opacity-60" style={{ background: 'var(--loomy-burgundy)' }}>
            {saving ? 'Menyimpan…' : editingId === null ? 'Tambah' : 'Simpan'}
          </button>
          {editingId !== null && (
            <button type="button" onClick={resetForm} className="rounded-lg border px-4 py-2">
              Batal
            </button>
          )}
        </div>
      </form>

      <div className="mt-4 overflow-x-auto rounded-2xl bg-white shadow">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b text-left opacity-60">
              <th className="px-4 py-2">Nama</th>
              <th className="px-4 py-2">Email</th>
              <th className="px-4 py-2">Role</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Aksi</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center opacity-60">Memuat…</td>
              </tr>
            ) : error ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-red-700">
                  {error} <button className="underline" onClick={load}>Coba lagi</button>
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center opacity-60">Tidak ada user.</td>
              </tr>
            ) : (
              items.map((u) => (
                <tr key={u.id} className="border-b last:border-0">
                  <td className="px-4 py-2">{u.name}{u.id === me?.id ? ' (saya)' : ''}</td>
                  <td className="px-4 py-2">{u.email}</td>
                  <td className="px-4 py-2">{u.role}</td>
                  <td className="px-4 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs ${u.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-200 text-gray-700'}`}>
                      {u.is_active ? 'Aktif' : 'Nonaktif'}
                    </span>
                  </td>
                  <td className="px-4 py-2">
                    {u.id === me?.id ? (
                      <span className="opacity-40">—</span>
                    ) : (
                      <div className="flex gap-2">
                        <button className="underline" onClick={() => startEdit(u)}>Ubah</button>
                        <button className="underline" onClick={() => toggleActive(u)}>
                          {u.is_active ? 'Nonaktifkan' : 'Aktifkan'}
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex items-center gap-3 text-sm">
        <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="rounded-lg border bg-white px-3 py-1 disabled:opacity-40">
          ‹ Prev
        </button>
        <span className="opacity-70">Hal {meta.page} / {Math.max(meta.totalPages, 1)} · {meta.total} data</span>
        <button disabled={page >= meta.totalPages} onClick={() => setPage(page + 1)} className="rounded-lg border bg-white px-3 py-1 disabled:opacity-40">
          Next ›
        </button>
      </div>
    </div>
  );
}
