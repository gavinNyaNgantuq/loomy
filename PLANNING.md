# PLANNING.md — Loomy: Sistem Manajemen Produksi, Inventaris, Penjualan, dan Keuangan

> STATUS: PLANNING ONLY — FINAL DRAFT.
> Dokumen ini adalah acuan implementasi. Belum ada kode aplikasi, database, migrasi, atau instalasi dependency yang dilakukan pada tahap ini.

## 0. Hasil Audit Project

- Lokasi: `/home/nodevin/Dokumen/Loomy`
- Kondisi terverifikasi: direktori kosong (0 entries). Tidak ada `package.json`, `vite.config`, `tsconfig`, `.env`, `docker-compose`, dump SQL, maupun file referensi dashboard/mockup.
- Kesimpulan: proyek **greenfield**. Seluruh rancangan di bawah adalah desain baru, bukan migrasi dari sistem existing.
- Kepatuhan: audit dilakukan read-only (`read`, `ls`). Tidak ada pembuatan/pengubahan/penghapusan file aplikasi atau database, tidak ada inisialisasi proyek, tidak ada instal dependency, tidak ada migrasi.

## 1. Tujuan dan Kebutuhan Bisnis

### 1.1 Tujuan
Satu aplikasi web untuk brand Loomy yang mengelola rantai: bahan baku → produksi → barang jadi → penjualan → kas/keuangan, dengan stok tertelusur, HPP konsisten, dan laporan laba yang dapat dipercaya.

### 1.2 Kebutuhan yang Diketahui
- Master barang jadi, bahan baku + BOM/resep.
- Pembelian bahan ke supplier dengan penerimaan parsial.
- Satuan CONFIRMED MBA DEA 2026-10-13 + 2026-10-14: bahan baku (kain, karet, benang) dibeli dalam kg; pemakaian bahan dihitung dalam kg; barang jadi dihitung dalam pcs.
- Retur bahan baku ke supplier perlu didukung (aturan detail masih pending, lihat Bab 2.2).
- HPP bahan baku memakai Average Cost berdasarkan pembelian (CONFIRMED).
- Varian ukuran produk: Normal, Jumbo, Junior (rancangan; penyesuaian model produk masih pending, skema DB tidak diubah pada tahap ini).
- Pengguna sekitar 2 orang dengan kebutuhan peran admin dan user (CONFIRMED; matriks izin detail masih pending).
- Kartu stok + opname.
- Produksi dengan konsumsi bahan + biaya tenaga kerja + overhead + HPP/unit.
- Penjualan POS cepat + riwayat invoice.
- Kas sederhana + dashboard + laporan (pembelian, produksi, penjualan, laba rugi sederhana).

### 1.3 Yang Belum Diketahui (jangan diasumsikan final)
- Jumlah SKU, volume transaksi/hari.
- Target deployment (VPS Docker vs shared hosting), kebijakan backup/retensi.
- Aturan bisnis pada Bab 3 yang masih bertanda PENDING (menunggu Mba Dea).

## 2. Status Keputusan

### 2.1 AGREED (kunci perencanaan)
- Stack: React + TypeScript + Vite (frontend), Node.js + Express (backend), MySQL 8 InnoDB `utf8mb4`.
- Roadmap berurutan F0–F6 dengan dependensi tetap.
- CONFIRMED MBA DEA 2026-10-13:
  1. Bahan baku (kain, karet, benang) dibeli dalam kg; pemakaian bahan dalam kg; barang jadi dalam pcs.
  2. HPP bahan baku = Average Cost berdasarkan pembelian (lihat Bab 6.2).
  3. Retur bahan baku ke supplier wajib didukung (aturan persetujuan/pengaruh kas masih PENDING, lihat Bab 2.2 item 6).
  4. Produk punya varian ukuran Normal/Jumbo/Junior sebagai rancangan; implementasi penyesuaian model produk masih PENDING, skema DB tidak diubah tahap ini.
  5. Pemakai sekitar 2 orang; peran yang dibutuhkan: admin dan user (matriks izin detail masih PENDING, lihat Bab 2.2 item 8 + Bab 9).
- Prinsip teknis wajib:
  1. Stok berasal dari transaksi tercatat dan dapat ditelusuri.
  2. Ledger mutasi append-only; koreksi hanya via reversal, tidak hapus/ubah posting.
  3. Pembelian, produksi, penjualan memakai transaksi database konsisten (`START TRANSACTION ... COMMIT/ROLLBACK` + `SELECT ... FOR UPDATE`).
  4. Cegah stok negatif (validasi + lock baris).
  5. Snapshot harga dan HPP saat transaksi agar laporan historis tidak berubah saat master diperbarui.
  6. HPP dihitung konsisten sesuai Bab 5.
  7. Validasi input (Zod) di client dan server + RBAC setiap mutasi.
  8. Tanpa dummy data sebagai pengganti backend.
  9. Tanpa overengineering dan dependency yang tidak perlu.

### 2.2 PENDING CONFIRMATION (rekomendasi sementara, bukan keputusan final)
Semua item di bawah bertanda `PENDING CONFIRMATION — MBA DEA`. Rekomendasi default dicantumkan beserta dampak, tetapi tidak boleh dianggap final tanpa persetujuan.

1. **Metode HPP bahan: Average — CONFIRMED MBA DEA 2026-10-13.**
   - Keputusan: Average Cost berdasarkan pembelian. FIFO tidak dipakai untuk bahan.
   - COGS barang jadi tetap lot-FIFO per Bab 6.3 (tidak kontradiksi: bahan Average, lot produk FIFO).
   - Tabel batch tetap diisi untuk ketelusuran.
2. **Satuan bahan: kg/pcs — SEBAGIAN CONFIRMED 2026-10-13.**
   - CONFIRMED 2026-10-13 + 2026-10-14: pembelian bahan baku (kain, karet, benang) dalam kg; pemakaian bahan dalam kg; stok/hitung barang jadi dalam pcs.
   - `PENDING CONFIRMATION`: apakah SEMUA bahan baku memakai kg tanpa kecuali; apakah ada bahan non-kain/karet dengan satuan lain; apakah konversi purchase_unit→base_unit masih perlu.
   - Sampai konfirmasi: kolom `base_unit`/`purchase_unit`/`conversion_to_base` tetap di skema; default kain/karet = kg, produk = pcs.
3. **Overhead produksi: alokasi per unit (rekomendasi) vs beban global.** `PENDING CONFIRMATION`
   - Default: `overhead_total / qty_realisasi` masuk HPP/unit agar antar-batch comparable.
   - Metode global membuat HPP undervalued dan laba overvalued.
4. **Harga retail/reseller/diskon/pajak.** `PENDING CONFIRMATION`
   - Default MVP: dua level harga (`harga_umum`, `harga_reseller`), PPN excluded. Alasan: hindari kompleksitas pajak di MVP.
5. **Satu gudang (MVP) vs multi-gudang.** `PENDING CONFIRMATION`
   - Default MVP: satu gudang. Multi-gudang menambah `warehouse_id` ke semua movement/BOM dan menambah scope ±30%.
6. **Retur dan barang rusak — SEBAGIAN CONFIRMED 2026-10-13.**
   - CONFIRMED: retur bahan baku ke supplier wajib didukung.
   - `PENDING CONFIRMATION`: pemicu retur (cacat/kurang/kelebihan?), batas waktu retur, siapa approve, pengaruh ke kas/utang (refund cash vs potong tagihan), apakah retur parsial per item diizinkan, alur barang rusak.
   - Usulan tetap: retur via movement reversal (`return_out`) pada harga asli tanpa recompute avg; barang rusak via `adjustment` + approval admin; tidak ada hapus ledger.
7. **Utang supplier / piutang pelanggan (pembayaran sebagian).** `PENDING CONFIRMATION`
   - Default MVP: tanpa DP/termin; `sales.status` hanya `lunas/batal`; partial di pembelian artinya barang parsial, bukan bayar parsial. AP/AR + aging ke fase berikutnya.
8. **Peran + akses HPP — SEBAGIAN CONFIRMED 2026-10-13.**
   - CONFIRMED: pemakai sekitar 2 orang; peran dibutuhkan: admin dan user. Tidak mengarang matriks izin detail.
   - `PENDING CONFIRMATION`: apa boleh dilakukan role user (apakah gabungan gudang+produksi+kasir+keuangan, atau subset?); apakah user boleh lihat HPP/laba; siapa approve opname/adjustment/retur bila hanya 2 orang; apakah 5 role lama (admin,gudang,produksi,kasir,keuangan) tetap dipakai sebagai fondasi RBAC atau disederhanakan jadi admin/user saja.
9. **Toleransi tanggal (backdate/future), aturan pembulatan, target backup/retensi, target deploy, volume transaksi.** `PENDING CONFIRMATION`
   - Update 2026-10-13: jumlah user (~2) CONFIRMED; volume harian + jumlah SKU tetap pending.
10. **Varian ukuran Normal/Jumbo/Junior — RANCANGAN, PENDING 2026-10-13.**
    - CONFIRMED ada 3 ukuran. Belum final: apakah varian = 3 SKU terpisah vs 1 produk + atribut ukuran; apakah BOM/HPP/harga beda per ukuran; apakah ukuran pengaruhi konversi kg→pcs.
    - Skema DB tidak diubah tahap ini. F1 harus putuskan model varian sebelum master diimplementasi.

## 3. Daftar Fitur: MVP vs Fase Berikutnya

### 3.1 MVP (F0–F6)
- Auth + RBAC + layout dashboard burgundy.
- Master: Barang (pcs; model varian Normal/Jumbo/Junior diputus di F1, skema tidak diubah tahap planning), Bahan (kg untuk kain/karet; cakupan kg penuh pending), Supplier, Customer, BOM (qty per unit dalam kg).
- Pembelian: PO draft → ordered → partial/received/cancelled (via reversal), receive parsial dalam kg + Average bertahap, retur supplier via return_out (aturan approve/kas pending), histori per supplier.
- Inventory: stok real-time dari ledger, kartu stok per bahan/produk, opname + selisih.
- Produksi: rencana → cek BOM → issue bahan atomik → input TK + overhead → selesai + HPP/unit + batch produk.
- Penjualan: POS (katalog + keranjang + bayar + struk) + riwayat; kunci `hpp_snapshot`; idempotency `client_uuid`.
- Keuangan MVP: kas masuk/keluar otomatis (on `pay`, bukan on `receive`) + manual; kategori; dashboard.
- Laporan MVP (6): kartu stok, pembelian, produksi + HPP, penjualan + laba kotor, laba rugi sederhana, stok menipis. Export CSV.

### 3.2 Fase Berikutnya (di luar MVP)
- Multi-gudang + transfer stok.
- Double-entry / COA penuh, AP/AR aging + pengingat jatuh tempo, termin/DP.
- Versi BOM, barcode, retur supplier otomatis, PPN/e-faktur, payroll.
- PWA offline ringan, sinkron marketplace.
- Audit-log UI lanjutan, approval workflow multi-level.

## 4. Arsitektur Teknis

### 4.1 Struktur Folder (rekomendasi)
```
loomy/
  apps/
    web/  # React + TS + Vite
      src/pages/ components/Table,Form,StatCard,Chart/ features/*/ lib/api-client,auth-context/ hooks/
    api/  # Node + Express
      src/routes/ controllers/ services/ repositories/ middlewares/auth,role,error/ validators/zod/ db/pool/
  docs/PLANNING.md (file ini)
```

### 4.2 Frontend
- React Query (server state), React Hook Form + Zod (form), Tailwind (styling), Recharts (grafik), Axios (HTTP).
- Validasi ganda client + server. Pola tabel standar: search/filter/sort/paginasi/badge/empty-state.

### 4.3 Backend + API REST
- Base `/api/v1`: `/auth`, `/products`, `/materials`, `/suppliers`, `/customers`, `/purchases`, `/productions`, `/sales`, `/inventory/movements`, `/inventory/opname`, `/finance`, `/reports`, `/health`.
- Lapisan: route → controller → service (aturan bisnis + transaksi) → repository (SQL) → pool `mysql2/promise`.
- Migrasi memakai tool (Knex/Prisma sebagai runner) hanya pada fase implementasi; tidak dijalankan pada tahap planning.

### 4.4 Autentikasi dan Otorisasi
- Password bcrypt; JWT access (±15 mnt, simpan di memori) + refresh (7 hari, httpOnly + Secure + SameSite Strict, rotation + deteksi reuse → revoke seluruh family).
- Tabel `refresh_tokens(jti_hash, user_id, expires_at, revoked)`. Logout = revoke `jti` + hapus cookie.
- Middleware `requireAuth` + `requireRole(...)`. Setiap mutasi mencatat `created_by` + baris `audit_logs`.

### 4.5 Integritas Transaksi
- Semua mutasi stok/HPP/kas dalam satu transaksi DB dengan `SELECT ... FOR UPDATE` pada baris batch/stok terkait.
- Ledger append-only. Pembatalan setelah posting hanya via reversal yang tertaut (`reverses_ref` / `ref_type+ref_id`), baris asli tetap utuh.
- POS memakai `client_uuid` (`UNIQUE` di `sales`) untuk idempotency: retry dengan kunci sama mengembalikan baris existing tanpa ledger/kas ganda.

## 5. Rancangan Database MySQL 8

Konsistensi telah direview: kebenaran tunggal stok = `inventory_movements`; tabel batch hanya pembantu alokasi (tidak dijumlah untuk laporan stok) sehingga tidak ada hitung ganda. Bahan memakai Average; HPP barang jadi per lot (lot-FIFO COGS) agar penjualan parsial teralokasi benar.

| Tabel | Kolom kunci | FK / Indeks |
|---|---|---|
| `users` | `id PK, name, email UNIQUE, password_hash, role ENUM(admin,gudang,produksi,kasir,keuangan), is_active` | `INDEX(role)` |
| `suppliers`, `customers` | `id PK, kode UNIQUE, nama, telepon, alamat`; customer tambah `tipe ENUM(umum,reseller)` | `INDEX(nama)` |
| `bahan` | `id PK, kode UNIQUE, nama, base_unit, purchase_unit, conversion_to_base DECIMAL(12,6), satuan ENUM, stok_minimum DECIMAL(14,3), harga_rata2 DECIMAL(16,2)` | `UNIQUE(kode)` |
| `products` | `id PK, sku UNIQUE, nama, kategori, harga_umum DECIMAL(16,2), harga_reseller DECIMAL(16,2), hpp_standar DECIMAL(16,2), stok_minimum` | `UNIQUE(sku)` |
| `product_bom` | `id PK, product_id, bahan_id, qty_per_unit DECIMAL(14,3), waste_pct DECIMAL(5,2)` | `FK→products RESTRICT, FK→bahan RESTRICT, UNIQUE(product,bahan)` |
| `purchases` | `id PK, nomor UNIQUE, supplier_id, tanggal DATE, subtotal/diskon/ongkir/pajak/total DECIMAL(16,2), status ENUM(draft,ordered,partial,received,cancelled), created_by` | `FK→suppliers, FK→users, INDEX(tanggal,status)` |
| `purchase_items` | `id PK, purchase_id, bahan_id, qty DECIMAL(14,3), harga_satuan DECIMAL(16,2), subtotal` | `FK→purchases CASCADE, FK→bahan RESTRICT` |
| `material_batches` | `id PK, bahan_id, purchase_item_id, qty_awal/sisa DECIMAL(14,3), harga_satuan DECIMAL(16,2), tanggal_masuk` | `FK→bahan, FK→purchase_items, INDEX(bahan,tanggal)` |
| `productions` | `id PK, nomor UNIQUE, product_id, qty_rencana/realisasi DECIMAL, tanggal_mulai/selesai, status ENUM(planned,in_progress,completed,cancelled), biaya_bahan/TK/overhead/total/hpp_per_unit DECIMAL, created_by` | `FK→products, FK→users, INDEX(status,tanggal)` |
| `production_material_usage` | `id PK, production_id, bahan_id, qty_rencana/aktual DECIMAL, harga_snapshot DECIMAL, subtotal` | `FK→productions CASCADE, FK→bahan` |
| `product_batches` | `id PK, product_id, production_id, qty_awal/sisa DECIMAL, hpp_satuan DECIMAL, tanggal_masuk` | `FK→products, FK→productions, INDEX(product,tanggal)` |
| `sales` | `id PK, nomor UNIQUE, client_uuid UNIQUE, customer_id NULL, tanggal DATETIME, kasir_id, subtotal/diskon/pajak/total DECIMAL, metode ENUM(cash,transfer,qris), status ENUM(lunas,batal) [MVP; dp = next phase]` | `FK→customers SET NULL, FK→users, INDEX(tanggal,status)` |
| `sales_items` | `id PK, sale_id, product_id, qty DECIMAL, harga_satuan DECIMAL, hpp_snapshot DECIMAL, subtotal, laba_item DECIMAL` | `FK→sales CASCADE, FK→products` |
| `inventory_movements` | `id PK, tanggal DATETIME, tipe ENUM(purchase_in,production_out,production_in,sales_out,return_in,return_out,adjustment,opname), ref_type, ref_id, reverses_ref NULL, bahan_id NULL, product_id NULL, qty_masuk/keluar DECIMAL(14,3), harga_satuan DECIMAL, keterangan, created_by` | `FK→bahan/product NULL-able, CHECK satu terisi, INDEX(bahan,tanggal), INDEX(product,tanggal), INDEX(ref_type,ref_id)` |
| `cash_transactions` | `id PK, tanggal DATE, arah ENUM(masuk,keluar), kategori ENUM(penjualan,pembelian,produksi,operasional,gaji,sewa,lainnya), ref_type/ref_id, jumlah DECIMAL(16,2), metode, keterangan, created_by` | `INDEX(tanggal,kategori), INDEX(ref_type,ref_id)` |
| `stock_opnames` | `id PK, tanggal, bahan_id NULL, product_id NULL, stok_sistem/fisik/selisih DECIMAL, alasan, created_by` | Selalu dipasangkan dengan `inventory_movements(opname)` |
| `refresh_tokens` | `id PK, jti_hash UNIQUE, user_id FK→users CASCADE, expires_at, revoked BOOL` | `INDEX(user_id)` |
| `audit_logs` | `id PK, tanggal DATETIME, user_id FK, aksi, entity, ref_id, before_json JSON NULL, after_json JSON NULL` | `INDEX(entity,ref_id)`, append-only |

Relasi alur:
`Supplier → purchases/items → material_batches (+) → movements(purchase_in) → productions/usage (− bahan, snapshot) → movements(out/in) → product_batches (+) → sales/items (− produk, hpp_snapshot) → movements(sales_out) + cash_transactions`. Opname hanya via movement.

## 6. Perhitungan Bisnis (Final Revisi)

### 6.1 Stok
`stok = SUM(qty_masuk) − SUM(qty_keluar)` dari `inventory_movements` per bahan/produk. Kolom stok di master hanya cache. Larang edit langsung; semua perubahan lewat movement dalam transaksi.

### 6.2 Average Cost Bahan — CONFIRMED MBA DEA 2026-10-13
- Metode: Average Cost berdasarkan pembelian. Hanya berubah pada `purchase_in`: `new_avg = (old_stock×old_avg + qty_in×price_in) / (old_stock+qty_in)`.
- Konsumsi produksi tidak mengubah avg (memakai `harga_snapshot = avg saat issue`).
- Retur ke supplier (`return_out`) memakai harga asli untuk nilai, tanpa recompute avg.

### 6.3 HPP Produksi dan Alokasi Jual Parsial
- `HPP/unit = (SUM(qty_aktual×cost_snapshot) + TK + overhead) / qty_realisasi`.
- Setiap lot `product_batches` menyimpan `hpp_satuan`. Penjualan mengonsumsi lot secara FIFO untuk COGS: `COGS = SUM(lot_qty_taken × lot_hpp)`, walau bahan memakai Average. Tidak ada kontradiksi.

### 6.4 Omzet, Laba, Arus Kas (dipisah tegas)
- Omzet = `SUM(sales.total WHERE status=lunas)`.
- Laba kotor = `SUM((harga_satuan − hpp_snapshot)×qty) − diskon teralokasi`.
- Laba bersih MVP = `laba kotor − beban operasional (cash keluar non-HPP)`. Belum akrual/penyusutan.
- Arus kas = `SUM(cash masuk) − SUM(cash keluar)`; saldo kas bukan laba. Dashboard memakai 4 kartu terpisah.

### 6.5 Pembelian dan Laba Rugi
- Laporan pembelian: total per supplier/periode + harga rata-rata bahan + keterlambatan terima.
- Kas MVP dicatat pada event `pay` (bukan otomatis pada `receive`) agar satu transaksi tidak menimbulkan beban ganda. Setiap flow maksimal satu baris kas per arah.

### 6.6 Satuan dan Presisi — SEBAGIAN CONFIRMED 2026-10-13 (bahan baku kg, produk pcs; sisanya pending)
- CONFIRMED: beli bahan (kain/karet/benang) dalam kg, pakai dalam kg, barang jadi dalam pcs.
- `base_unit` per bahan immutable setelah ada transaksi; semua hitung BOM dikonversi ke basis via `conversion_to_base`.
- Qty `DECIMAL(14,3)`, uang `DECIMAL(16,2)`, tidak memakai float. Pembulatan half-up hanya pada total/baris tampil; ledger menyimpan nilai penuh. `PENDING CONFIRMATION` untuk aturan pembulatan final dan daftar konversi.

## 7. Alur Batal dan Retur (Reversal-Only)

- Dilarang `UPDATE/DELETE` baris posted. Pembatalan = baris reversal baru bertaut (`reverses_ref`), baris asli utuh untuk audit.
- Beli yang sudah received dibatalkan → `return_out` penuh + koreksi kas.
- Produksi `completed` dibatalkan → dilarang bila output sudah terjual; bila belum, reverse pasangan `out/in`.
- Jual `lunas` dibatalkan → `return_in` pada `hpp_snapshot` asli + kas refund (`keluar`).
- Retur supplier pada `price_in` asli; retur customer menambah lot baru pada HPP asli; avg bahan tidak dihitung ulang. Retur supplier CONFIRMED wajib ada (aturan approve + pengaruh kas masih PENDING per Bab 2.2 item 6).

## 8. UI/UX

- Palet: burgundy `#7B1E2E` (sidebar/primer), hover `#5E1422`, background abu muda `#F4F5F7`, kartu putih, teks `#1E1E24`; status hijau/merah standar. Font Inter/system.
- Navigasi: Dashboard, Pembelian, Inventory (Stok/Kartu/Opname), Produksi (Rencana/BOM), Penjualan (POS/Riwayat), Keuangan, Laporan, Master (Barang/Bahan/Supplier/Customer), Pengguna.
- Dashboard: 4 kartu (Omzet, Laba Kotor, Arus Kas / Stok Kritis, PO Pending) + garis omzet 30 hari + bar top-5 + tabel stok kritis & produksi berjalan.
- Pola tabel/formulir/POS/wizard produksi dan responsif (drawer mobile, kartu 1 kolom, tabel h-scroll) sesuai draft; tidak ada referensi visual external yang ditemukan saat audit.

## 9. Hak Akses (RBAC) — SEBAGIAN CONFIRMED 2026-10-13 (~2 user: admin + user; izin detail pending)
- CONFIRMED: kebutuhan peran = admin dan user untuk ~2 pemakai. Tidak mengarang izin detail final.
- Rancangan peran lama tetap sebagai referensi fondasi (belum diputuskan apakah disederhanakan):
  - admin: penuh + approve adjustment/opname + kelola user.
  - gudang: bahan, receive PO, inventory/opname (adjust butuh admin).
  - produksi: lihat BOM, buat/selesaikan produksi, tanpa approve keuangan.
  - kasir: POS + riwayat sendiri.
  - keuangan: kas + laporan, tanpa mutasi stok.
- `PENDING CONFIRMATION`: pemetaan user→izin (apakah user = semua non-admin?); apakah user boleh lihat HPP/laba; siapa approve bila admin berhalangan. Putuskan sebelum F0 selesai agar middleware `requireRole` + ENUM `users.role` tidak dirombak tengah jalan.

## 10. Deployment, Environment, Backup, Audit Log

- Env (`.env`, tidak di-commit): `DB_HOST/PORT/USER/PASS/NAME`, `JWT_ACCESS/REFRESH_SECRET`, `CORS_ORIGIN`, `PORT`. Target deploy `PENDING CONFIRMATION` (usulan: satu VPS + Nginx reverse proxy + PM2/systemd + MySQL 8; health check `/api/v1/health`).
- Backup (usulan, `PENDING CONFIRMATION`): dump harian 02:00, retensi 7 hari lokal + 30 hari offsite, aktifkan binary log bila memungkinkan, drill restore bulanan ke staging + verifikasi jumlah ledger.
- Audit log: tabel `audit_logs` append-only (siapa/kapan/aksi/entity/before-after). Backdate hanya admin + alasan tercatat; tanggal masa depan >+1 hari ditolak kecuali tanggal produksi terencana. Toleransi +1 hari untuk skew jam. `PENDING CONFIRMATION`.

## 11. Strategi Pengujian

- Unit: rumus HPP, update Average, omzet/laba.
- Integrasi: PO→stok, rollback produksi atomik, tolak oversell, imutabilitas snapshot, satu kas per flow.
- E2E per peran; beban ringan (mis. 20 POS konkuren); matriks 401/403; UAT + tanda tangan Mba Dea.

## 12. Roadmap F0–F6 dan Acceptance Criteria

- **F0 Fondasi (3–5 hari).** Hasil: repo, auth+RBAC, layout, pool DB. Selesai bila: login semua peran lolos; unauth 401; peran salah 403; refresh rotation bekerja.
- **F1 Master (1 mgg).** Dep: F0 (tambah: peran admin/user final harus jelas sebelum RBAC dikunci). Selesai bila: SKU/kode duplikat ditolak; satuan default bahan kg / produk pcs ditegakkan; model varian Normal/Jumbo/Junior diputus (1 produk+atribut vs 3 SKU) + BOM per varian jelas; hitung kebutuhan BOM = `qty_per_unit × qty_rencana`; hapus master yang terpakai diblokir.
- **F2 Pembelian + Inventory (1–2 mgg).** Dep: F1 (tambah: model varian ukuran harus diputus di F1 sebelum F2; satuan kg/pcs CONFIRMED ikut F1 master). Selesai bila: stok hanya berubah saat receive; receive parsial 40+60 kg → stok +100 kg + avg bertahap benar ((old_stock×old_avg+qty_in×price_in)/(old_stock+qty_in)) + status partial→received; retur supplier via `return_out` pada harga asli tanpa recompute avg + ledger utuh; nol kas sebelum pay; `SUM(movements)=stok`; opname menulis movement selisih. Urutan dalam F2: (1) receive + satuan kg + Average, (2) kartu stok/opname, (3) retur supplier (butuh aturan approve + efek kas dari Mba Dea; bila belum final, bangun movement reversal + flag pending-approval). Blocker sisa: aturan retur detail, cakupan kg untuk semua bahan, peran admin/user final.
- **F3 Produksi + HPP (1–2 mgg).** Dep: F2. Selesai bila: bahan kurang → rollback penuh (nol movement + nol kas); HPP = (bahan+TK+overhead)/realisasi; input sama → HPP sama; snapshot stabil.
- **F4 POS (1 mgg).** Dep: F1+F2 (+F3 bila tanpa stok awal). Selesai bila: oversell ditolak; klik ganda satu `client_uuid` → satu sale + satu ledger + satu kas; laba lama tak berubah setelah harga master berubah; konkuren stok 1 + 2 pay → satu lunas satu 409.
- **F5 Keuangan + Laporan (1 mgg).** Dep: F2–F4. Selesai bila: setiap sale/purchase-pay/production menulis kas yang benar; filter tanggal akurat; jumlah baris CSV = jumlah query; 4 metrik (omzet/kas/gross/net) terpisah benar.
- **F6 Hardening (1 mgg).** Dep: semua. Selesai bila: backup→restore teruji; audit log lengkap; uji beban ringan lolos; rekonsiliasi stok vs ledger nol selisih; UAT ditandatangani.

Risiko utama: aturan retur belum final; race oversell; varian ukuran belum dipetakan ke SKU; scope creep multi-gudang/akuntansi penuh; tamper ledger; drift harga; target deploy tak pasti. Metode HPP bahan sudah kunci Average 2026-10-13 (risiko ganti metode turun). Mitigasi: kunci sisa Bab 2.2 (retur, peran, varian) sebelum F2/F3; transaksi + lock + idempotency; satuan kg/pcs CONFIRMED + konversi basis untuk sisa; kontrak single-gudang + kas sederhana MVP; append-only + snapshot; deploy/backup dikonfirmasi awal.

## 13. Pertanyaan untuk Mba Dea (PENDING CONFIRMATION) — update 2026-10-13
Sudah CONFIRMED: bahan kain/karet/benang, satuan beli kg / pakai kg / jual pcs; HPP Average; retur cacat wajib didukung; varian Normal/Jumbo/Junior ada; ~2 user admin+user.

1. ~~HPP Average disetujui?~~ CONFIRMED Average.
2. Satuan sisa: apakah SEMUA bahan kg tanpa kecuali? Ada bahan non-kain/karet beda satuan? Perlu konversi purchase→base (mis. karung→kg)?
3. Overhead per unit atau global?
4. Harga umum/reseller/diskon/PPN? + apakah harga/HPP beda per ukuran (Normal/Jumbo/Junior)?
5. Satu atau multi gudang sejak awal?
6. Aturan retur/rusak + approval (BLOCKER F2): pemicu retur? batas hari? siapa approve? refund cash vs potong tagihan? retur parsial boleh? barang rusak alur apa?
7. Pembayaran sebagian/termin + AP/AR masuk MVP atau next? Kas diakui saat terima atau saat bayar?
8. Peran final (BLOCKER F0/F2): user boleh apa saja? boleh lihat HPP/laba? siapa approve opname/adjust/retur? 5 role lama dipertahankan atau sederhanakan ke admin/user?
9. Varian ukuran (BLOCKER F1): 1 produk + atribut vs 3 SKU? BOM beda per ukuran? konversi kg→pcs per ukuran?
10. Aturan pembulatan final?
11. Target deploy, target backup/retensi/drill, volume harian + jumlah SKU untuk sizing? (user ~2 CONFIRMED)

## 14. Kriteria Penerimaan Global
- Tidak ada stok negatif akibat race.
- Setiap mutasi punya jejak `inventory_movements` + `audit_logs`.
- Laba historis tak berubah saat master berubah (snapshot).
- Setiap endpoint mutasi butuh auth + role + validasi Zod + transaksi.
- Laporan inti rekonsiliasi dengan ledger.

---
*Berhenti setelah planning. Menunggu persetujuan sebelum implementasi.*
