import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from '../src/app.js';
import { pingDb, pool } from '../src/db/pool.js';
import { purchaseCreateSchema, purchaseUpdateSchema } from '../src/validators/purchases.js';

const dbUp = await pingDb();

function todayLocal(): string {
  const n = new Date();
  const y = n.getFullYear();
  const mo = String(n.getMonth() + 1).padStart(2, '0');
  const d = String(n.getDate()).padStart(2, '0');
  return `${y}-${mo}-${d}`;
}
function tomorrowLocal(): string {
  const n = new Date();
  n.setDate(n.getDate() + 1);
  const y = n.getFullYear();
  const mo = String(n.getMonth() + 1).padStart(2, '0');
  const d = String(n.getDate()).padStart(2, '0');
  return `${y}-${mo}-${d}`;
}

describe.skipIf(!dbUp)('purchases F2 S2 Tahap 1 (butuh DB)', () => {
  const app = createApp();
  const ts = Date.now();
  const adminEmail = `potadmin${ts}@test.local`;
  const gudangEmail = `potgudang${ts}@test.local`;
  const kasirEmail = `potkasir${ts}@test.local`;
  const password = 'password-uji-aman-123';
  const supKode = `SUPPOT${ts}`.slice(0, 40);
  const supInactKode = `SUPPOTI${ts}`.slice(0, 40);
  const bahanAKode = `BHNPOTA${ts}`.slice(0, 40);
  const bahanBKode = `BHNPOTB${ts}`.slice(0, 40);
  const bahanIKode = `BHNPOTI${ts}`.slice(0, 40);
  let adminToken = '';
  let gudangToken = '';
  let kasirToken = '';
  let supId = 0;
  let supInactId = 0;
  let bahanAId = 0;
  let bahanBId = 0;
  let bahanIId = 0;
  const poIds: number[] = [];
  const track = (id: number) => {
    poIds.push(id);
  };

  beforeAll(async () => {
    const hash = await bcrypt.hash(password, 4);
    await pool.query("INSERT INTO users (name, email, password_hash, role) VALUES ('POT Admin', ?, ?, 'admin')", [adminEmail, hash]);
    await pool.query("INSERT INTO users (name, email, password_hash, role) VALUES ('POT Gudang', ?, ?, 'gudang')", [gudangEmail, hash]);
    await pool.query("INSERT INTO users (name, email, password_hash, role) VALUES ('POT Kasir', ?, ?, 'kasir')", [kasirEmail, hash]);
    adminToken = (await request(app).post('/api/v1/auth/login').send({ email: adminEmail, password })).body.accessToken;
    gudangToken = (await request(app).post('/api/v1/auth/login').send({ email: gudangEmail, password })).body.accessToken;
    kasirToken = (await request(app).post('/api/v1/auth/login').send({ email: kasirEmail, password })).body.accessToken;
    const s1 = await request(app).post('/api/v1/suppliers').set('Authorization', `Bearer ${adminToken}`).send({ kode: supKode, nama: 'Supplier POT' });
    supId = s1.body.data.id;
    const s2 = await request(app).post('/api/v1/suppliers').set('Authorization', `Bearer ${adminToken}`).send({ kode: supInactKode, nama: 'Supplier POT Inact' });
    supInactId = s2.body.data.id;
    const mka = (k: string, n: string) => request(app).post('/api/v1/materials').set('Authorization', `Bearer ${adminToken}`).send({ kode: k, nama: n, jenis: 'kain' });
    bahanAId = (await mka(bahanAKode, 'Bahan POT A')).body.data.id;
    bahanBId = (await mka(bahanBKode, 'Bahan POT B')).body.data.id;
    bahanIId = (await mka(bahanIKode, 'Bahan POT I')).body.data.id;
  });

  afterAll(async () => {
    if (poIds.length > 0) {
      const ph = poIds.map(() => '?').join(',');
      await pool.query(`DELETE FROM purchase_items WHERE purchase_id IN (${ph})`, poIds);
      await pool.query(`DELETE FROM purchases WHERE id IN (${ph})`, poIds);
    }
    await pool.query('DELETE FROM bahan WHERE kode IN (?, ?, ?)', [bahanAKode, bahanBKode, bahanIKode]);
    await pool.query('DELETE FROM suppliers WHERE kode IN (?, ?)', [supKode, supInactKode]);
    await pool.query('DELETE FROM users WHERE email IN (?, ?, ?)', [adminEmail, gudangEmail, kasirEmail]);
  });

  it('Zod tolak input invalid', () => {
    const base = { supplier_id: 1, tanggal: todayLocal(), items: [{ bahan_id: 1, qty: 1, harga_satuan: 100 }] };
    expect(() => purchaseCreateSchema.parse({ ...base, tanggal: tomorrowLocal() })).toThrow();
    expect(() => purchaseCreateSchema.parse({ ...base, tanggal: '2026-13-99' })).toThrow();
    expect(() => purchaseCreateSchema.parse({ ...base, items: [] })).toThrow();
    expect(() => purchaseCreateSchema.parse({ ...base, items: [{ bahan_id: 1, qty: 1, harga_satuan: 1 }, { bahan_id: 1, qty: 2, harga_satuan: 2 }] })).toThrow();
    expect(() => purchaseCreateSchema.parse({ ...base, items: [{ bahan_id: 1, qty: 0, harga_satuan: 1 }] })).toThrow();
    expect(() => purchaseCreateSchema.parse({ ...base, items: [{ bahan_id: 1, qty: 1.2345, harga_satuan: 1 }] })).toThrow();
    expect(() => purchaseCreateSchema.parse({ ...base, items: [{ bahan_id: 1, qty: 1, harga_satuan: -1 }] })).toThrow();
    expect(() => purchaseCreateSchema.parse({ ...base, items: [{ bahan_id: 1, qty: 1, harga_satuan: 1.234 }] })).toThrow();
    expect(() =>
      purchaseCreateSchema.parse({ ...base, items: Array.from({ length: 101 }, (_, i) => ({ bahan_id: i + 1, qty: 1, harga_satuan: 1 })) }),
    ).toThrow();
    expect(() => purchaseUpdateSchema.parse({})).toThrow();
  });

  it('tanpa token → 401', async () => {
    await request(app).get('/api/v1/purchases').expect(401);
  });

  it('kasir baca → 200; kasir tulis → 403', async () => {
    await request(app).get('/api/v1/purchases').set('Authorization', `Bearer ${kasirToken}`).expect(200);
    await request(app)
      .post('/api/v1/purchases')
      .set('Authorization', `Bearer ${kasirToken}`)
      .send({ supplier_id: supId, tanggal: todayLocal(), items: [{ bahan_id: bahanAId, qty: 1, harga_satuan: 100 }] })
      .expect(403);
  });

  it('gudang buat draft → 201, total hitung server', async () => {
    const r = await request(app)
      .post('/api/v1/purchases')
      .set('Authorization', `Bearer ${gudangToken}`)
      .send({
        supplier_id: supId,
        tanggal: todayLocal(),
        items: [
          { bahan_id: bahanAId, qty: 10.5, harga_satuan: 12000.5 },
          { bahan_id: bahanBId, qty: 2, harga_satuan: 5000 },
        ],
        diskon: 1000,
        ongkir: 2000,
        pajak: 500,
        total: 1, // harus diabaikan: server hitung ulang
      });
    expect(r.status).toBe(201);
    // 10.5*12000.50=126005.25; 2*5000=10000; subtotal=136005.25; total=136005.25-1000+2000+500=137505.25
    expect(r.body.data.subtotal).toBe(136005.25);
    expect(r.body.data.total).toBe(137505.25);
    expect(r.body.data.status).toBe('draft');
    expect(r.body.data.nomor).toMatch(/^PO-/);
    expect(r.body.data.items).toHaveLength(2);
    track(r.body.data.id);
  });

  it('harga nol boleh; total negatif ditolak', async () => {
    const ok = await request(app)
      .post('/api/v1/purchases')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ supplier_id: supId, tanggal: todayLocal(), items: [{ bahan_id: bahanAId, qty: 1, harga_satuan: 0 }] });
    expect(ok.status).toBe(201);
    track(ok.body.data.id);
    const bad = await request(app)
      .post('/api/v1/purchases')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ supplier_id: supId, tanggal: todayLocal(), items: [{ bahan_id: bahanAId, qty: 1, harga_satuan: 100 }], diskon: 999999 });
    expect(bad.status).toBe(400);
  });

  it('supplier/bahan invalid → 404/409', async () => {
    const t = todayLocal();
    const miss = await request(app)
      .post('/api/v1/purchases')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ supplier_id: 999999999, tanggal: t, items: [{ bahan_id: bahanAId, qty: 1, harga_satuan: 1 }] });
    expect(miss.status).toBe(404);
    const missB = await request(app)
      .post('/api/v1/purchases')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ supplier_id: supId, tanggal: t, items: [{ bahan_id: 999999999, qty: 1, harga_satuan: 1 }] });
    expect(missB.status).toBe(404);
    await request(app).patch(`/api/v1/suppliers/${supInactId}`).set('Authorization', `Bearer ${adminToken}`).send({ is_active: false }).expect(200);
    const inact = await request(app)
      .post('/api/v1/purchases')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ supplier_id: supInactId, tanggal: t, items: [{ bahan_id: bahanAId, qty: 1, harga_satuan: 1 }] });
    expect(inact.status).toBe(409);
  });

  it('nomor unik saat request bersamaan', async () => {
    const t = todayLocal();
    const reqs = Array.from({ length: 5 }, () =>
      request(app)
        .post('/api/v1/purchases')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ supplier_id: supId, tanggal: t, items: [{ bahan_id: bahanAId, qty: 1, harga_satuan: 10 }] }),
    );
    const res = await Promise.all(reqs);
    for (const x of res) expect(x.status).toBe(201);
    const nomors = res.map((x) => x.body.data.nomor as string);
    expect(new Set(nomors).size).toBe(5);
    for (const x of res) track(x.body.data.id);
  });

  it('edit hanya draft + hitung ulang', async () => {
    const t = todayLocal();
    const c = await request(app)
      .post('/api/v1/purchases')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ supplier_id: supId, tanggal: t, items: [{ bahan_id: bahanAId, qty: 2, harga_satuan: 1000 }] });
    expect(c.status).toBe(201);
    const id = c.body.data.id as number;
    track(id);
    const p = await request(app)
      .patch(`/api/v1/purchases/${id}`)
      .set('Authorization', `Bearer ${gudangToken}`)
      .send({ items: [{ bahan_id: bahanAId, qty: 3, harga_satuan: 1000 }], ongkir: 500 });
    expect(p.status).toBe(200);
    expect(p.body.data.total).toBe(3500);
    await request(app).post(`/api/v1/purchases/${id}/order`).set('Authorization', `Bearer ${adminToken}`).expect(200);
    const after = await request(app)
      .patch(`/api/v1/purchases/${id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ongkir: 999 });
    expect(after.status).toBe(409);
  });

  it('order hanya draft + cek aktif', async () => {
    const t = todayLocal();
    const c = await request(app)
      .post('/api/v1/purchases')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ supplier_id: supId, tanggal: t, items: [{ bahan_id: bahanBId, qty: 1, harga_satuan: 50 }] });
    const id = c.body.data.id as number;
    track(id);
    await request(app).post(`/api/v1/purchases/${id}/order`).set('Authorization', `Bearer ${gudangToken}`).expect(200);
    await request(app).post(`/api/v1/purchases/${id}/order`).set('Authorization', `Bearer ${adminToken}`).expect(409);
    // Bahan nonaktif blokir order.
    const c2 = await request(app)
      .post('/api/v1/purchases')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ supplier_id: supId, tanggal: t, items: [{ bahan_id: bahanIId, qty: 1, harga_satuan: 50 }] });
    const id2 = c2.body.data.id as number;
    track(id2);
    await request(app).patch(`/api/v1/materials/${bahanIId}`).set('Authorization', `Bearer ${adminToken}`).send({ is_active: false }).expect(200);
    const ord = await request(app).post(`/api/v1/purchases/${id2}/order`).set('Authorization', `Bearer ${adminToken}`);
    expect(ord.status).toBe(409);
  });

  it('cancel hanya admin + status diizinkan', async () => {
    const t = todayLocal();
    const c = await request(app)
      .post('/api/v1/purchases')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ supplier_id: supId, tanggal: t, items: [{ bahan_id: bahanBId, qty: 1, harga_satuan: 50 }] });
    const id = c.body.data.id as number;
    track(id);
    await request(app).post(`/api/v1/purchases/${id}/order`).set('Authorization', `Bearer ${adminToken}`).expect(200);
    await request(app).post(`/api/v1/purchases/${id}/cancel`).set('Authorization', `Bearer ${gudangToken}`).expect(403);
    const ok = await request(app).post(`/api/v1/purchases/${id}/cancel`).set('Authorization', `Bearer ${adminToken}`);
    expect(ok.status).toBe(200);
    expect(ok.body.data.status).toBe('cancelled');
    await request(app).post(`/api/v1/purchases/${id}/cancel`).set('Authorization', `Bearer ${adminToken}`).expect(409);
    // Received tak bisa batal (insert langsung status received untuk guard).
    const [hr] = await pool.query('INSERT INTO purchases (nomor, supplier_id, tanggal, subtotal, diskon, ongkir, pajak, total, status, created_by) VALUES (?, ?, ?, 100, 0, 0, 0, 100, ?, NULL)', [
      `PO-RCV${ts}`,
      supId,
      t,
      'received',
    ]);
    const rid = Number((hr as { insertId: number }).insertId);
    track(rid);
    await request(app).post(`/api/v1/purchases/${rid}/cancel`).set('Authorization', `Bearer ${adminToken}`).expect(409);
  });

  it('list filter + detail 404/400 + delete 405', async () => {
    const l = await request(app).get('/api/v1/purchases?status=draft&limit=5').set('Authorization', `Bearer ${kasirToken}`).expect(200);
    expect(Array.isArray(l.body.data)).toBe(true);
    expect(l.body.meta.page).toBe(1);
    await request(app).get('/api/v1/purchases/999999999').set('Authorization', `Bearer ${adminToken}`).expect(404);
    await request(app).get('/api/v1/purchases/abc').set('Authorization', `Bearer ${adminToken}`).expect(400);
    const c = await request(app)
      .post('/api/v1/purchases')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ supplier_id: supId, tanggal: todayLocal(), items: [{ bahan_id: bahanAId, qty: 1, harga_satuan: 1 }] });
    track(c.body.data.id);
    await request(app).delete(`/api/v1/purchases/${c.body.data.id}`).set('Authorization', `Bearer ${adminToken}`).expect(405);
  });

  it('audit tercatat untuk mutasi', async () => {
    const c = await request(app)
      .post('/api/v1/purchases')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ supplier_id: supId, tanggal: todayLocal(), items: [{ bahan_id: bahanAId, qty: 1, harga_satuan: 5 }] });
    const id = c.body.data.id as number;
    track(id);
    await request(app).post(`/api/v1/purchases/${id}/order`).set('Authorization', `Bearer ${adminToken}`).expect(200);
    const [rows] = await pool.query('SELECT COUNT(*) AS c FROM audit_logs WHERE entity = ? AND ref_id = ?', ['purchases', id]);
    expect(Number((rows as Array<{ c: number }>)[0].c)).toBeGreaterThanOrEqual(2);
  });
});
