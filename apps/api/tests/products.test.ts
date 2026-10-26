import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from '../src/app.js';
import { pingDb, pool } from '../src/db/pool.js';

const dbUp = await pingDb();

describe.skipIf(!dbUp)('products F1-A (butuh DB)', () => {
  const app = createApp();
  const adminEmail = `f1admin${Date.now()}@test.local`;
  const kasirEmail = `f1kasir${Date.now()}@test.local`;
  const password = 'password-uji-aman-123';
  const sku = `SKU${Date.now()}`;
  let adminToken = '';
  let kasirToken = '';
  let productId = 0;

  beforeAll(async () => {
    const hash = await bcrypt.hash(password, 4);
    await pool.query("INSERT INTO users (name, email, password_hash, role) VALUES ('F1 Admin',?, ?, 'admin')", [adminEmail, hash]);
    await pool.query("INSERT INTO users (name, email, password_hash, role) VALUES ('F1 Kasir',?, ?, 'kasir')", [kasirEmail, hash]);
    adminToken = (await request(app).post('/api/v1/auth/login').send({ email: adminEmail, password })).body.accessToken;
    kasirToken = (await request(app).post('/api/v1/auth/login').send({ email: kasirEmail, password })).body.accessToken;
  });

  afterAll(async () => {
    await pool.query('DELETE FROM products WHERE sku LIKE "SKUF1%" OR sku LIKE ?', [`${sku}%`]);
    await pool.query('DELETE FROM users WHERE email IN (?, ?)', [adminEmail, kasirEmail]);
  });

  it('tanpa token → 401', async () => {
    await request(app).get('/api/v1/products').expect(401);
  });

  it('kasir baca → 200; kasir tulis → 403', async () => {
    await request(app).get('/api/v1/products').set('Authorization', `Bearer ${kasirToken}`).expect(200);
    await request(app)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${kasirToken}`)
      .send({ sku: 'SKUF1X', nama: 'X' })
      .expect(403);
  });

  it('admin buat → 201; baca daftar + detail', async () => {
    const c = await request(app)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ sku, nama: 'Kemeja Loomy', kategori: 'Atasan' });
    expect(c.status).toBe(201);
    expect(c.body.data.sku).toBe(sku);
    productId = c.body.data.id;
    const list = await request(app).get('/api/v1/products').set('Authorization', `Bearer ${adminToken}`).expect(200);
    expect(list.body.meta.total).toBeGreaterThanOrEqual(1);
    const one = await request(app).get(`/api/v1/products/${productId}`).set('Authorization', `Bearer ${adminToken}`).expect(200);
    expect(one.body.data.nama).toBe('Kemeja Loomy');
  });

  it('input invalid → 400', async () => {
    const r = await request(app)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ sku: 'SKU BURUK!', nama: '' });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('duplikat SKU → 409', async () => {
    const r = await request(app)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ sku, nama: 'Duplikat' });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('CONFLICT');
  });

  it('cari + pagination + nonaktif', async () => {
    for (let i = 0; i < 3; i++) {
      await request(app)
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ sku: `SKUF1${Date.now()}${i}`, nama: `Item Cari ${i}` })
        .expect(201);
    }
    const s = await request(app).get('/api/v1/products?q=Cari&limit=2&page=1').set('Authorization', `Bearer ${adminToken}`).expect(200);
    expect(s.body.data.length).toBeLessThanOrEqual(2);
    expect(s.body.meta.totalPages).toBeGreaterThanOrEqual(1);
    const off = await request(app)
      .patch(`/api/v1/products/${productId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ is_active: false });
    expect(off.status).toBe(200);
    expect(off.body.data.is_active).toBe(false);
    const inactive = await request(app).get('/api/v1/products?is_active=0').set('Authorization', `Bearer ${adminToken}`).expect(200);
    expect(inactive.body.data.some((p: { id: number }) => p.id === productId)).toBe(true);
  });

  it('hapus fisik → 405', async () => {
    const r = await request(app).delete(`/api/v1/products/${productId}`).set('Authorization', `Bearer ${adminToken}`);
    expect(r.status).toBe(405);
    expect(r.body.error.code).toBe('METHOD_NOT_ALLOWED');
  });

  it('audit tercatat', async () => {
    const [rows] = await pool.query('SELECT COUNT(*) AS c FROM audit_logs WHERE entity = ? AND ref_id = ?', ['products', productId]);
    expect(Number((rows as Array<{ c: number }>)[0].c)).toBeGreaterThanOrEqual(2);
  });
});
