import { useAuth } from '../context/AuthContext.js';

export function Dashboard() {
  const { user } = useAuth();
  return (
    <div>
      <h2 className="text-xl font-bold">Dashboard F0</h2>
      <p className="mt-1 text-sm opacity-70">
        Halo, {user?.name} ({user?.email}). Fondasi auth + layout aktif. Modul bisnis menyusul F1–F5.
      </p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {['Omzet (F5)', 'Laba Kotor (F5)', 'Stok Kritis (F2)', 'PO Pending (F2)'].map((t) => (
          <div key={t} className="rounded-2xl bg-white p-4 shadow">
            <div className="text-xs uppercase opacity-60">{t}</div>
            <div className="mt-2 text-2xl font-bold opacity-30">—</div>
          </div>
        ))}
      </div>
    </div>
  );
}
