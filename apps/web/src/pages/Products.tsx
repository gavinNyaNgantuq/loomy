import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.js';

interface Product {
  id: number;
  sku: string;
  nama: string;
  kategori: string | null;
  is_active: boolean;
}

interface Meta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

const EMPTY_META: Meta = { page: 1, limit: 20, total: 0, totalPages: 0 };

function errMsg(e: unknown): { status?: number; message: string } {
  const r = (e as { response?: { status?: number; data?: { error?: { message?: string } } } }).response;
  return { status: r?.status, message: r?.data?.error?.message ?? 'Request gagal' };
}

export function Products() {
  const { token, logout } = useAuth();
  const [items, setItems] = useState<Product[]>([]);
  const [meta, setMeta] = useState<Meta>(EMPTY_META);
  const [q, setQ] = useState('');
  const [qSent, setQSent] = useState('');
  const [page, setPage] = useState(1);
  const [activeFilter, setActiveFilter] = useState<'all' | '1' | '0'>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [sku, setSku] = useState('');
  const [nama, setNama] = useState('');
  const [kategori, setKategori] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  const headers = token ? { Authorization: `Bearer ${token}` } : {};

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params: Record<string, string | number> = { page, limit: 20 };
      if (qSent) params.q = qSent;
      if (activeFilter !== 'all') params.is_active = activeFilter;
      const r = await api.get('/products', { headers, params });
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
  }, [page, qSent, activeFilter, token]);

  useEffect(() => {
    load();
  }, [load]);

  function startEdit(p: Product) {
    setEditingId(p.id);
    setSku(p.sku);
    setNama(p.nama);
    setKategori(p.kategori ?? '');
    setFormError(null);
    setOkMsg(null);
  }

  function resetForm() {
    setEditingId(null);
    setSku('');
    setNama('');
    setKategori('');
    setFormError(null);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    setOkMsg(null);
    if (!/^[A-Za-z0-9_-]{1,50}$/.test(sku.trim())) {
      setFormError('SKU hanya huruf, angka, - dan _ (maks 50)');
      return;
    }
    if (!nama.trim()) {
      setFormError('Nama wajib diisi');
      return;
    }
    setSaving(true);
    try {
      const body = { sku: sku.trim(), nama: nama.trim(), kategori: kategori.trim() ? kategori.trim() : null };
      if (editingId === null) {
        await api.post('/products', body, { headers });
        setOkMsg('Produk ditambah');
      } else {
        await api.patch(`/products/${editingId}`, body, { headers });
        setOkMsg('Produk diubah');
      }
      resetForm();
      load();
    } catch (e) {
      const err = errMsg(e);
      if (err.status === 401) {
        await logout();
        return;
      }
      // Input pengguna dipertahankan saat gagal.
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(p: Product) {
    setFormError(null);
    setOkMsg(null);
    try {
      await api.patch(`/products/${p.id}`, { is_active: !p.is_active }, { headers });
      setOkMsg(p.is_active ? 'Produk dinonaktifkan' : 'Produk diaktifkan');
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
      <h2 className="text-xl font-bold">Produk</h2>
      <p className="mt-1 text-sm opacity-70">Master barang jadi. Hapus fisik dilarang; gunakan nonaktif.</p>

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
          placeholder="Cari SKU / nama…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select
          className="rounded-lg border bg-white px-3 py-2"
          value={activeFilter}
          onChange={(e) => {
            setActiveFilter(e.target.value as 'all' | '1' | '0');
            setPage(1);
          }}
        >
          <option value="all">Semua status</option>
          <option value="1">Aktif</option>
          <option value="0">Nonaktif</option>
        </select>
        <button className="rounded-lg px-4 py-2 font-medium text-white" style={{ background: 'var(--loomy-burgundy)' }}>
          Cari
        </button>
      </form>

      <form onSubmit={submit} className="mt-4 rounded-2xl bg-white p-4 shadow">
        <div className="text-sm font-bold">{editingId === null ? 'Tambah produk' : `Ubah produk #${editingId}`}</div>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          <input className="rounded-lg border px-3 py-2" placeholder="SKU (unik)" value={sku} onChange={(e) => setSku(e.target.value)} />
          <input className="rounded-lg border px-3 py-2" placeholder="Nama" value={nama} onChange={(e) => setNama(e.target.value)} />
          <input className="rounded-lg border px-3 py-2" placeholder="Kategori (opsional)" value={kategori} onChange={(e) => setKategori(e.target.value)} />
        </div>
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
              <th className="px-4 py-2">SKU</th>
              <th className="px-4 py-2">Nama</th>
              <th className="px-4 py-2">Kategori</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Aksi</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center opacity-60">
                  Memuat…
                </td>
              </tr>
            ) : error ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-red-700">
                  {error} <button className="underline" onClick={load}>Coba lagi</button>
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center opacity-60">
                  Belum ada produk. Tambahkan lewat formulir di atas.
                </td>
              </tr>
            ) : (
              items.map((p) => (
                <tr key={p.id} className="border-b last:border-0">
                  <td className="px-4 py-2 font-mono">{p.sku}</td>
                  <td className="px-4 py-2">{p.nama}</td>
                  <td className="px-4 py-2">{p.kategori ?? '—'}</td>
                  <td className="px-4 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs ${p.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-200 text-gray-700'}`}>
                      {p.is_active ? 'Aktif' : 'Nonaktif'}
                    </span>
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex gap-2">
                      <button className="underline" onClick={() => startEdit(p)}>
                        Ubah
                      </button>
                      <button className="underline" onClick={() => toggleActive(p)}>
                        {p.is_active ? 'Nonaktifkan' : 'Aktifkan'}
                      </button>
                    </div>
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
        <span className="opacity-70">
          Hal {meta.page} / {Math.max(meta.totalPages, 1)} · {meta.total} data
        </span>
        <button disabled={page >= meta.totalPages} onClick={() => setPage(page + 1)} className="rounded-lg border bg-white px-3 py-1 disabled:opacity-40">
          Next ›
        </button>
      </div>
    </div>
  );
}
