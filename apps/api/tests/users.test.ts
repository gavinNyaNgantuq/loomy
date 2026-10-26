import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from '../src/app.js';
import { pingDb, pool } from '../src/db/pool.js';

const dbUp = await pingDb();

describe.skipIf(!dbUp)('users F1-D (butuh DB)', () => {
  const app = createApp();
  const adminEmail = `f1dadmin${Date.now()}@test.local`;
  const kasirEmail = `f1dkasir${Date.now()}@test.local`;
  const password = 'password-uji-aman-123';
  let adminToken = '';
  let kasirToken = '';
  let adminId = 0;
  let targetId = 0;
  const targetEmail = `f1dtarget${Date.now()}@test.local`;

  beforeAll(async () => {
    const hash = await bcrypt.hash(password, 4);
    await pool.query("INSERT INTO users (name, email, password_hash, role) VALUES ('F1D Admin',?, ?, 'admin')", [adminEmail, hash]);
    await pool.query("INSERT INTO users (name, email, password_hash, role) VALUES ('F1D Kasir',?, ?, 'kasir')", [kasirEmail, hash]);
    const a = await request(app).post('/api/v1/auth/login').send({ email: adminEmail, password });
    adminToken = a.body.accessToken;
    adminId = a.body.user.id;
    kasirToken = (await request(app).post('/api/v1/auth/login').send({ email: kasirEmail, password })).body.accessToken;
  });

  afterAll(async () => {
    await pool.query('DELETE FROM users WHERE email LIKE ? OR email IN (?, ?)', ['f1dtarget%@test.local', adminEmail, kasirEmail]);
  });

  it('tanpa token → 401', async () => {
    await request(app).get('/api/v1/users').expect(401);
  });

  it('kasir baca maupun tulis → 403', async () => {
    await request(app).get('/api/v1/users').set('Authorization', `Bearer ${kasirToken}`).expect(403);
    await request(app)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${kasirToken}`)
      .send({ name: 'X', email: 'x@t.co', password: 'password-123', role: 'kasir' })
      .expect(403);
  });

  it('admin list → 200 tanpa hash/token', async () => {
    const r = await request(app).get('/api/v1/users').set('Authorization', `Bearer ${adminToken}`).expect(200);
    expect(r.body.meta.total).toBeGreaterThanOrEqual(2);
    const raw = JSON.stringify(r.body);
    expect(raw).not.toContain('password_hash');
    expect(raw).not.toContain('accessToken');
    expect(raw).not.toContain('refresh');
  });

  it('buat user → 201, lalu login dengan kredensial itu', async () => {
    const c = await request(app)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Target Gudang', email: targetEmail, password: 'gudang-aman-123', role: 'gudang' });
    expect(c.status).toBe(201);
    expect(c.body.data.role).toBe('gudang');
    expect(JSON.stringify(c.body)).not.toContain('password_hash');
    targetId = c.body.data.id;
    const login = await request(app).post('/api/v1/auth/login').send({ email: targetEmail, password: 'gudang-aman-123' });
    expect(login.status).toBe(200);
  });

  it('edit nama + role → 200', async () => {
    const r = await request(app)
      .patch(`/api/v1/users/${targetId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Target Produksi', role: 'produksi' });
    expect(r.status).toBe(200);
    expect(r.body.data.name).toBe('Target Produksi');
    expect(r.body.data.role).toBe('produksi');
  });

  it('input invalid + role asing → 400', async () => {
    const r1 = await request(app)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: '', email: 'bukan-email', password: 'pendek', role: 'kasir' });
    expect(r1.status).toBe(400);
    const r2 = await request(app)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'X', email: 'x2@t.co', password: 'password-123', role: 'superadmin' });
    expect(r2.status).toBe(400);
  });

  it('email duplikat → 409', async () => {
    const r = await request(app)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Dup', email: targetEmail, password: 'password-123', role: 'kasir' });
    expect(r.status).toBe(409);
  });

  it('admin tak bisa ubah role sendiri / nonaktifkan diri', async () => {
    const r1 = await request(app)
      .patch(`/api/v1/users/${adminId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role: 'kasir' });
    expect(r1.status).toBe(403);
    expect(r1.body.error.code).toBe('SELF_ROLE_CHANGE');
    const r2 = await request(app)
      .patch(`/api/v1/users/${adminId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ is_active: false });
    expect(r2.status).toBe(403);
  });

  it('nonaktifkan target (bukan hapus) → row tetap ada', async () => {
    const r = await request(app)
      .patch(`/api/v1/users/${targetId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ is_active: false });
    expect(r.status).toBe(200);
    expect(r.body.data.is_active).toBe(false);
    const del = await request(app).delete(`/api/v1/users/${targetId}`).set('Authorization', `Bearer ${adminToken}`);
    expect(del.status).toBe(405);
    const still = await request(app).get(`/api/v1/users/${targetId}`).set('Authorization', `Bearer ${adminToken}`).expect(200);
    expect(still.body.data.is_active).toBe(false);
  });

  it('audit tercatat', async () => {
    const [rows] = await pool.query('SELECT COUNT(*) AS c FROM audit_logs WHERE entity = ? AND ref_id = ?', ['users', targetId]);
    expect(Number((rows as Array<{ c: number }>)[0].c)).toBeGreaterThanOrEqual(2);
  });
});

describe('last admin guard (unit, tanpa DB)', () => {
  it('admin aktif terakhir → true; bukan admin → false', async () => {
    const { isLastActiveAdmin } = await import('../src/routes/users.js');
    const stubLast = { query: async (sql: string) => (sql.includes('COUNT') ? [[{ c: 0 }]] : [[{ role: 'admin', is_active: 1 }]]) };
    expect(await isLastActiveAdmin(stubLast as never, 9)).toBe(true);
    const stubOther = { query: async (sql: string) => (sql.includes('COUNT') ? [[{ c: 2 }]] : [[{ role: 'admin', is_active: 1 }]]) };
    expect(await isLastActiveAdmin(stubOther as never, 9)).toBe(false);
    const stubNonAdmin = { query: async (sql: string) => (sql.includes('COUNT') ? [[{ c: 0 }]] : [[{ role: 'kasir', is_active: 1 }]]) };
    expect(await isLastActiveAdmin(stubNonAdmin as never, 9)).toBe(false);
  });
});

describe.skipIf(!dbUp)('nonaktifkan admin ekstra → 200 (bukan terakhir)', () => {
  it('guard tidak false-positive', async () => {
    const app = createApp();
    const pw = 'password-uji-aman-123';
    const hash = await bcrypt.hash(pw, 4);
    const boss = `f1dboss${Date.now()}@test.local`;
    const extra = `f1dextra${Date.now()}@test.local`;
    await pool.query("INSERT INTO users (name, email, password_hash, role) VALUES ('Boss',?, ?, 'admin')", [boss, hash]);
    await pool.query("INSERT INTO users (name, email, password_hash, role) VALUES ('Extra',?, ?, 'admin')", [extra, hash]);
    try {
      const t = (await request(app).post('/api/v1/auth/login').send({ email: boss, password: pw })).body.accessToken;
      const [ex] = await pool.query('SELECT id FROM users WHERE email = ? LIMIT 1', [extra]);
      const exId = Number((ex as Array<{ id: number }>)[0].id);
      // Seed admin + boss masih aktif → nonaktifkan extra harus 200:
      const r = await request(app).patch(`/api/v1/users/${exId}`).set('Authorization', `Bearer ${t}`).send({ is_active: false });
      expect(r.status).toBe(200);
    } finally {
      await pool.query('DELETE FROM users WHERE email IN (?, ?)', [boss, extra]);
    }
  });
});
