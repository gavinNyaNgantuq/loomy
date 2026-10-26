import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from '../src/app.js';
import { pingDb, pool } from '../src/db/pool.js';

/**
 * Tes integrasi F0 — BUTUH MySQL hidup.
 * Bila DB down, seluruh suite di-skip dan dilaporkan sebagai BLOCKED,
 * bukan diklaim lolos.
 */
const dbUp = await pingDb();

describe.skipIf(!dbUp)('auth integration (F0, butuh DB)', () => {
  const app = createApp();
  const adminEmail = `f0admin${Date.now()}@test.local`;
  const kasirEmail = `f0kasir${Date.now()}@test.local`;
  const password = 'password-uji-aman-123';

  beforeAll(async () => {
    const hash = await bcrypt.hash(password, 4);
    await pool.query("INSERT INTO users (name, email, password_hash, role) VALUES ('T Admin','" + adminEmail + "',?, 'admin')", [hash]);
    await pool.query("INSERT INTO users (name, email, password_hash, role) VALUES ('T Kasir','" + kasirEmail + "',?, 'kasir')", [hash]);
  });

  it('login sukses → 200 + accessToken + cookie refresh', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({ email: adminEmail, password });
    expect(res.status).toBe(200);
    expect(typeof res.body.accessToken).toBe('string');
    expect(res.body.user.email).toBe(adminEmail);
    const setCookie = res.headers['set-cookie'];
    const cookieStr = Array.isArray(setCookie) ? setCookie.join(';') : (setCookie ?? '');
    expect(cookieStr).toContain('loomy_refresh');
  });

  it('kredensial salah → 401 tanpa enumerasi', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({ email: adminEmail, password: 'salah-salah' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('tanpa token → 401', async () => {
    const res = await request(app).get('/api/v1/admin/ping');
    expect(res.status).toBe(401);
  });

  it('kasir ke endpoint admin → 403', async () => {
    const login = await request(app).post('/api/v1/auth/login').send({ email: kasirEmail, password });
    const res = await request(app).get('/api/v1/admin/ping').set('Authorization', `Bearer ${login.body.accessToken}`);
    expect(res.status).toBe(403);
  });

  it('admin ke endpoint admin → 200', async () => {
    const login = await request(app).post('/api/v1/auth/login').send({ email: adminEmail, password });
    const res = await request(app).get('/api/v1/admin/ping').set('Authorization', `Bearer ${login.body.accessToken}`);
    expect(res.status).toBe(200);
  });

  it('refresh reuse → family dicabut; logout mencabut token', async () => {
    const login = await request(app).post('/api/v1/auth/login').send({ email: adminEmail, password });
    expect(login.status).toBe(200);
    const jar = (res: { headers: Record<string, unknown> }): string => {
      const raw = res.headers['set-cookie'];
      const arr = Array.isArray(raw) ? raw : [String(raw)];
      const hit = arr.find((c) => c.startsWith('loomy_refresh='));
      return hit ? hit.split(';')[0] : '';
    };
    const v1 = jar(login);
    expect(v1).toContain('loomy_refresh=');
    const r1 = await request(app).post('/api/v1/auth/refresh').set('Cookie', v1);
    expect(r1.status).toBe(200);
    const v2 = jar(r1);
    // Pakai ulang token lama → reuse terdeteksi, family dicabut:
    const reuse = await request(app).post('/api/v1/auth/refresh').set('Cookie', v1);
    expect(reuse.status).toBe(401);
    expect(reuse.body.error.code).toBe('SESSION_REVOKED');
    // Token baru pun ikut mati karena family dicabut:
    const r3 = await request(app).post('/api/v1/auth/refresh').set('Cookie', v2);
    expect(r3.status).toBe(401);
  });

  it('logout mencabut refresh token', async () => {
    const agent = request.agent(app);
    await agent.post('/api/v1/auth/login').send({ email: adminEmail, password }).expect(200);
    const r1 = await agent.post('/api/v1/auth/refresh');
    expect(r1.status).toBe(200);
    await agent.post('/api/v1/auth/logout').expect(200);
    const r2 = await agent.post('/api/v1/auth/refresh');
    expect(r2.status).toBe(401);
  });

  it('logout menghapus cookie dengan atribut cocok (B1)', async () => {
    const login = await request(app).post('/api/v1/auth/login').send({ email: adminEmail, password });
    expect(login.status).toBe(200);
    const setCookies = (login.headers['set-cookie'] ?? []) as unknown as string[];
    const setHit = setCookies.find((c) => c.startsWith('loomy_refresh='));
    expect(setHit).toBeDefined();
    expect(setHit).toContain('Path=/api/v1/auth');
    expect(setHit).toContain('SameSite=Strict');
    expect(setHit).toContain('HttpOnly');
    const value = (setHit as string).split(';')[0];
    const out = await request(app).post('/api/v1/auth/logout').set('Cookie', value);
    expect(out.status).toBe(200);
    const cleared = ((out.headers['set-cookie'] ?? []) as unknown as string[]).find((c) =>
      c.startsWith('loomy_refresh='),
    );
    expect(cleared).toBeDefined();
    // Cookie dihapus (expired) dengan Path + SameSite yang sama agar browser menerimanya:
    expect(cleared).toContain('Path=/api/v1/auth');
    expect(cleared).toContain('SameSite=Strict');
    expect(cleared).toMatch(/Expires=Thu, 01 Jan 1970/i);
  });

  afterAll(async () => {
    // Bersihkan akun uji yang dibuat suite ini (data uji, bukan data bisnis).
    await pool.query('DELETE FROM users WHERE email IN (?, ?)', [adminEmail, kasirEmail]);
  });
});

describe('auth integration gate', () => {
  it('melaporkan status DB secara jujur', () => {
    if (!dbUp) console.log('BLOCKED: MySQL down — suite integrasi di-skip, bukan lolos');
    expect(true).toBe(true);
  });
});
