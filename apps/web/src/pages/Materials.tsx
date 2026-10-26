import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.js';

interface Material {
  id: number;
  kode: string;
  nama: string;
  jenis: 'kain' | 'karet' | 'benang';
  satuan: string;
  stok_minimum: number;
  harga_rata2: number;
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

export function Materials() {
  const { token, logout } = useAuth();
  const [items, setItems] = useState<Material[]>([]);
  const [meta, setMeta] = useState<Meta>(EMPTY_META);
  const [q, setQ] = useState('');
  const [qSent, setQSent] = useState('');
  const [page, setPage] = useState(1);
  const [jenisFilter, setJenisFilter] = useState<'all' | 'kain' | 'karet' | 'benang'>('all');
  const [activeFilter, setActiveFilter] = useState<'all' | '1' | '0'>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [kode, setKode] = useState('');
  const [nama, setNama] = useState('');
  const [jenis, setJenis] = useState<'kain' | 'karet' | 'benang'>('kain');
  const [stokMin, setStokMin] = useState('');
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
      if (jenisFilter !== 'all') params.jenis = jenisFilter;
      if (activeFilter !== 'all') params.is_active = activeFilter;
      const r = await api.get('/materials', { headers, params });
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
  }, [page, qSent, jenisFilter, activeFilter, token]);

  useEffect(() => {
    load();
  }, [load]);

  function startEdit(m: Material) {
    setEditingId(m.id);
    setKode(m.kode);
    setNama(m.nama);
    setJenis(m.jenis);
    setStokMin(String(m.stok_minimum ?? ''));
    setFormError(null);
    setOkMsg(null);
  }

  function resetForm() {
    setEditingId(null);
    setKode('');
    setNama('');
    setJenis('kain');
    setStokMin('');
    setFormError(null);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    setOkMsg(null);
    if (!/^[A-Za-z0-9_-]{1,50}$/.test(kode.trim())) {
      setFormError('Kode hanya huruf, angka, - dan _ (maks 50)');
      return;
    }
    if (!nama.trim()) {
      setFormError('Nama wajib diisi');
      return;
    }
    const stokNum = stokMin.trim() === '' ? undefined : Number(stokMin);
    if (stokNum !== undefined && (!Number.isFinite(stokNum) || stokNum < 0)) {
      setFormError('Stok minimum >= 0');
      return;
    }
    setSaving(true);
    try {
      const body: Record<string, unknown> = { kode: kode.trim(), nama: nama.trim(), jenis };
      if (stokNum !== undefined) body.stok_minimum = stokNum;
      if (editingId === null) {
        await api.post('/materials', body, { headers });
        setOkMsg('Bahan ditambah');
      } else {
        await api.patch(`/materials/${editingId}`, body, { headers });
        setOkMsg('Bahan diubah');
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

  async function toggleActive(m: Material) {
    setFormError(null);
    setOkMsg(null);
    try {
      await api.patch(`/materials/${m.id}`, { is_active: !m.is_active }, { headers });
      setOkMsg(m.is_active ? 'Bahan dinonaktifkan' : 'Bahan diaktifkan');
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
      <h2 className="text-xl font-bold">Bahan Baku</h2>
      <p className="mt-1 text-sm opacity-70">Master kain / karet / benang dalam kg. Harga rata-rata dihitung dari pembelian (Average). Hapus fisik dilarang.</p>

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
          placeholder="Cari kode / nama…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select
          className="rounded-lg border bg-white px-3 py-2"
          value={jenisFilter}
          onChange={(e) => {
            setJenisFilter(e.target.value as 'all' | 'kain' | 'karet' | 'benang');
            setPage(1);
          }}
        >
          <option value="all">Semua jenis</option>
          <option value="kain">Kain</option>
          <option value="karet">Karet</option>
          <option value="benang">Benang</option>
        </select>
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
        <div className="text-sm font-bold">{editingId === null ? 'Tambah bahan' : `Ubah bahan #${editingId}`}</div>
        <div className="mt-2 grid gap-2 sm:grid-cols-4">
          <input className="rounded-lg border px-3 py-2" placeholder="Kode (unik)" value={kode} onChange={(e) => setKode(e.target.value)} />
          <input className="rounded-lg border px-3 py-2" placeholder="Nama" value={nama} onChange={(e) => setNama(e.target.value)} />
          <select className="rounded-lg border px-3 py-2" value={jenis} onChange={(e) => setJenis(e.target.value as 'kain' | 'karet' | 'benang')}>
            <option value="kain">Kain (kg)</option>
            <option value="karet">Karet (kg)</option>
            <option value="benang">Benang (kg)</option>
          </select>
          <input className="rounded-lg border px-3 py-2" placeholder="Stok min kg (opsional)" value={stokMin} onChange={(e) => setStokMin(e.target.value)} inputMode="decimal" />
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
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b text-left opacity-60">
              <th className="px-4 py-2">Kode</th>
              <th className="px-4 py-2">Nama</th>
              <th className="px-4 py-2">Jenis</th>
              <th className="px-4 py-2">Satuan</th>
              <th className="px-4 py-2">Stok min</th>
              <th className="px-4 py-2">Hrg rata2</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Aksi</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-center opacity-60">
                  Memuat…
                </td>
              </tr>
            ) : error ? (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-center text-red-700">
                  {error} <button className="underline" onClick={load}>Coba lagi</button>
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-center opacity-60">
                  Belum ada bahan. Tambahkan lewat formulir di atas.
                </td>
              </tr>
            ) : (
              items.map((m) => (
                <tr key={m.id} className="border-b last:border-0">
                  <td className="px-4 py-2 font-mono">{m.kode}</td>
                  <td className="px-4 py-2">{m.nama}</td>
                  <td className="px-4 py-2">{m.jenis}</td>
                  <td className="px-4 py-2">{m.satuan}</td>
                  <td className="px-4 py-2">{m.stok_minimum}</td>
                  <td className="px-4 py-2">{m.harga_rata2}</td>
                  <td className="px-4 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs ${m.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-200 text-gray-700'}`}>
                      {m.is_active ? 'Aktif' : 'Nonaktif'}
                    </span>
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex gap-2">
                      <button className="underline" onClick={() => startEdit(m)}>
                        Ubah
                      </button>
                      <button className="underline" onClick={() => toggleActive(m)}>
                        {m.is_active ? 'Nonaktifkan' : 'Aktifkan'}
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
