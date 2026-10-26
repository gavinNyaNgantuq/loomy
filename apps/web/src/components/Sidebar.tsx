import { NavLink } from 'react-router-dom';

const ACTIVE = [
  { to: '/', label: 'Dashboard' },
  { to: '/materials', label: 'Bahan Baku' },
  { to: '/products', label: 'Produk' },
  { to: '/suppliers', label: 'Supplier' },
  { to: '/customers', label: 'Customer' },
  { to: '/users', label: 'Pengguna' },
];
const LATER = ['Pembelian (F2+)', 'Inventory (F2+)', 'Produksi (F3+)', 'Penjualan (F4+)', 'Keuangan (F5+)', 'Laporan (F5+)'];

export function Sidebar({ role, onLogout }: { role: string; onLogout: () => void }) {
  return (
    <aside className="flex w-60 shrink-0 flex-col text-white" style={{ background: 'var(--loomy-burgundy)' }}>
      <div className="px-5 pb-4 pt-6">
        <div className="text-2xl font-bold tracking-wide">Loomy</div>
        <div className="mt-1 text-xs uppercase opacity-70">F1-A · {role}</div>
      </div>
      <nav className="flex flex-1 flex-col gap-1 px-3">
        {ACTIVE.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) => `rounded-lg px-3 py-2 text-sm font-medium ${isActive ? '' : 'opacity-80 hover:opacity-100'}`}
            style={({ isActive }) => (isActive ? { background: 'var(--loomy-burgundy-dark)' } : undefined)}
          >
            {item.label}
          </NavLink>
        ))}
        <div className="px-3 pb-1 pt-4 text-[11px] uppercase opacity-60">Modul berikutnya</div>
        {LATER.map((label) => (
          <span key={label} className="cursor-not-allowed rounded-lg px-3 py-2 text-sm opacity-50">
            {label}
          </span>
        ))}
      </nav>
      <div className="p-4">
        <button onClick={onLogout} className="w-full rounded-lg bg-white/10 px-3 py-2 text-sm hover:bg-white/20">
          Keluar
        </button>
      </div>
    </aside>
  );
}
