import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from '../src/app.js';
import { pingDb, pool } from '../src/db/pool.js';

const dbUp = await pingDb();

describe.skipIf(!dbUp)('suppliers F1-B (butuh DB)', () => {
  const app = createApp();
  const adminEmail = `f1badmin${Date.now()}@test.local`;
  const kasirEmail = `f1bkasir${Date.now()}@test.local`;
  const password = 'password-uji-aman-123';
  const kode = `SUP${Date.now()}`;
  let adminToken = '';
  let kasirToken = '';
  let supplierId = 0;

  beforeAll(async () => {
    const hash = await bcrypt.hash(password, 4);
    await pool.query("INSERT INTO users (name, email, password_hash, role) VALUES ('F1B Admin',?, ?, 'admin')", [adminEmail, hash]);
    await pool.query("INSERT INTO users (name, email, password_hash, role) VALUES ('F1B Kasir',?, ?, 'kasir')", [kasirEmail, hash]);
    adminToken = (await request(app).post('/api/v1/auth/login').send({ email: adminEmail, password })).body.accessToken;
    kasirToken = (await request(app).post('/api/v1/auth/login').send({ email: kasirEmail, password })).body.accessToken;
  });

  afterAll(async () => {
    await pool.query('DELETE FROM suppliers WHERE kode LIKE "SUPF1B%" OR kode LIKE ?', [`${kode}%`]);
    await pool.query('DELETE FROM users WHERE email IN (?, ?)', [adminEmail, kasirEmail]);
  });

  it('tanpa token → 401', async () => {
    await request(app).get('/api/v1/suppliers').expect(401);
  });

  it('kasir baca → 200; kasir tulis → 403', async () => {
    await request(app).get('/api/v1/suppliers').set('Authorization', `Bearer ${kasirToken}`).expect(200);
    await request(app)
      .post('/api/v1/suppliers')
      .set('Authorization', `Bearer ${kasirToken}`)
      .send({ kode: 'SUPF1BX', nama: 'X' })
      .expect(403);
  });

  it('admin buat → 201; baca daftar + detail', async () => {
    const c = await request(app)
      .post('/api/v1/suppliers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ kode, nama: 'PT Kain Maju', telepon: '021-123', alamat: 'Jakarta' });
    expect(c.status).toBe(201);
    expect(c.body.data.kode).toBe(kode);
    supplierId = c.body.data.id;
    const one = await request(app).get(`/api/v1/suppliers/${supplierId}`).set('Authorization', `Bearer ${adminToken}`).expect(200);
    expect(one.body.data.nama).toBe('PT Kain Maju');
  });

  it('edit → 200', async () => {
    const r = await request(app)
      .patch(`/api/v1/suppliers/${supplierId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ telepon: '021-999', alamat: 'Bandung' });
    expect(r.status).toBe(200);
    expect(r.body.data.telepon).toBe('021-999');
  });

  it('input invalid → 400', async () => {
    const r = await request(app)
      .post('/api/v1/suppliers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ kode: 'KODE BURUK!', nama: '' });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('duplikat kode → 409', async () => {
    const r = await request(app)
      .post('/api/v1/suppliers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ kode, nama: 'Duplikat' });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('CONFLICT');
  });

  it('cari + pagination + nonaktif tanpa hapus fisik', async () => {
    for (let i = 0; i < 3; i++) {
      await request(app)
        .post('/api/v1/suppliers')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ kode: `SUPF1B${Date.now()}${i}`, nama: `Supplier Cari ${i}` })
        .expect(201);
    }
    const s = await request(app).get('/api/v1/suppliers?q=Cari&limit=2&page=1').set('Authorization', `Bearer ${adminToken}`).expect(200);
    expect(s.body.data.length).toBeLessThanOrEqual(2);
    const off = await request(app)
      .patch(`/api/v1/suppliers/${supplierId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ is_active: false });
    expect(off.body.data.is_active).toBe(false);
    const del = await request(app).delete(`/api/v1/suppliers/${supplierId}`).set('Authorization', `Bearer ${adminToken}`);
    expect(del.status).toBe(405);
    // Data masih ada (nonaktif, bukan hapus):
    const still = await request(app).get(`/api/v1/suppliers/${supplierId}`).set('Authorization', `Bearer ${adminToken}`).expect(200);
    expect(still.body.data.is_active).toBe(false);
  });

  it('audit tercatat', async () => {
    const [rows] = await pool.query('SELECT COUNT(*) AS c FROM audit_logs WHERE entity = ? AND ref_id = ?', ['suppliers', supplierId]);
    expect(Number((rows as Array<{ c: number }>)[0].c)).toBeGreaterThanOrEqual(2);
  });

  it('error DB aman (id invalid → 400, bukan 500 bocor)', async () => {
    const r = await request(app).get('/api/v1/suppliers/abc').set('Authorization', `Bearer ${adminToken}`);
    expect(r.status).toBe(400);
  });
});
