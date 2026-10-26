import { Router, type Request, type Response, type NextFunction } from 'express';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { pool } from '../db/pool.js';
import { env } from '../env.js';
import { loginSchema } from '../validators/auth.js';
import { verifyPassword } from '../utils/password.js';
import { newFamilyId, sha256Hex, signAccessToken, signRefreshToken, verifyRefreshToken } from '../utils/jwt.js';
import { requireAuth } from '../middlewares/auth.js';
import { loginLimiter } from '../middlewares/rateLimit.js';
import { isRole, type SafeUser } from '../types.js';

const REFRESH_COOKIE = 'loomy_refresh';
const GENERIC_FAIL = 'Email atau password salah';

function refreshCookieOptions(maxAgeMs: number, req: Request) {
  // Secure hanya bila HTTPS/prod; SameSite strict sesuai planning.
  const secure = env.isProd || req.protocol === 'https';
  return { httpOnly: true, secure, sameSite: 'strict' as const, path: '/api/v1/auth', maxAge: maxAgeMs };
}

/** B1: atribut clear harus cocok dengan set (path/sameSite/secure) agar browser benar menghapus. */
function clearRefreshCookie(res: Response, req: Request): void {
  const secure = env.isProd || req.protocol === 'https';
  res.clearCookie(REFRESH_COOKIE, {
    httpOnly: true,
    secure,
    sameSite: 'strict' as const,
    path: '/api/v1/auth',
  });
}

function toSafeUser(row: RowDataPacket): SafeUser {
  const role = row.role;
  if (!isRole(role)) throw new Error('role invalid');
  return { id: Number(row.id), name: String(row.name), email: String(row.email), role };
}

async function writeAudit(
  db: Pool,
  aksi: string,
  entity: string,
  userId: number | null,
  refId: number | null,
): Promise<void> {
  await db.query('INSERT INTO audit_logs (user_id, aksi, entity, ref_id) VALUES (?, ?, ?, ?)', [
    userId,
    aksi,
    entity,
    refId,
  ]);
}

export function createAuthRouter(db: Pool = pool): Router {
  const r = Router();

  r.post('/login', loginLimiter, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const input = loginSchema.parse(req.body);
      const [rows] = await db.query<RowDataPacket[]>(
        'SELECT id, name, email, password_hash, role, is_active FROM users WHERE email = ? LIMIT 1',
        [input.email],
      );
      const row = rows[0];
      const hash: string = row ? String(row.password_hash) : '';
      const ok = await verifyPassword(input.password, hash);
      if (!row || !ok || Number(row.is_active) !== 1) {
        res.status(401).json({ error: { code: 'INVALID_CREDENTIALS', message: GENERIC_FAIL } });
        return;
      }
      const user = toSafeUser(row);
      const familyId = newFamilyId();
      const { token: refreshToken, jti } = signRefreshToken(user.id);
      const expiresAt = new Date(Date.now() + env.refreshTtlDays * 24 * 3600 * 1000);
      await db.query(
        'INSERT INTO refresh_tokens (jti_hash, family_id, user_id, expires_at) VALUES (?, ?, ?, ?)',
        [sha256Hex(jti), familyId, user.id, expiresAt],
      );
      await writeAudit(db, 'login', 'auth', user.id, null);
      res.cookie(REFRESH_COOKIE, refreshToken, refreshCookieOptions(env.refreshTtlDays * 24 * 3600 * 1000, req));
      res.status(200).json({ accessToken: signAccessToken(user.id, user.role), user });
    } catch (err) {
      next(err);
    }
  });

  r.post('/refresh', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const presented: string | undefined = req.cookies?.[REFRESH_COOKIE];
      if (!presented) {
        res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Refresh token tidak ada' } });
        return;
      }
      let sub = '';
      let jti = '';
      try {
        const claims = verifyRefreshToken(presented);
        sub = claims.sub;
        jti = claims.jti;
      } catch {
        res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Refresh token tidak valid' } });
        return;
      }
      const [rows] = await db.query<RowDataPacket[]>(
        'SELECT id, jti_hash, family_id, user_id, expires_at, revoked FROM refresh_tokens WHERE jti_hash = ? LIMIT 1',
        [sha256Hex(jti)],
      );
      const rec = rows[0];
      if (!rec) {
        res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Refresh token tidak dikenal' } });
        return;
      }
      // Reuse terdeteksi: token sudah dipakai/dicabut → cabut seluruh family.
      if (Number(rec.revoked) === 1 || new Date(rec.expires_at).getTime() < Date.now()) {
        await db.query('UPDATE refresh_tokens SET revoked = 1 WHERE family_id = ?', [String(rec.family_id)]);
        await writeAudit(db, 'refresh_reuse_detected', 'auth', Number(rec.user_id), null);
        clearRefreshCookie(res, req);
        res.status(401).json({ error: { code: 'SESSION_REVOKED', message: 'Sesi dicabut, silakan login ulang' } });
        return;
      }
      // Rotasi normal: cabut jti lama, terbitkan jti baru dalam family yang sama.
      await db.query('UPDATE refresh_tokens SET revoked = 1 WHERE id = ?', [Number(rec.id)]);
      const { token: nextRefresh, jti: nextJti } = signRefreshToken(Number(rec.user_id));
      const expiresAt = new Date(Date.now() + env.refreshTtlDays * 24 * 3600 * 1000);
      await db.query(
        'INSERT INTO refresh_tokens (jti_hash, family_id, user_id, expires_at) VALUES (?, ?, ?, ?)',
        [sha256Hex(nextJti), String(rec.family_id), Number(rec.user_id), expiresAt],
      );
      const [urows] = await db.query<RowDataPacket[]>(
        'SELECT id, name, email, role, is_active FROM users WHERE id = ? LIMIT 1',
        [Number(rec.user_id)],
      );
      const urow = urows[0];
      if (!urow || Number(urow.is_active) !== 1 || !isRole(urow.role)) {
        res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Akun tidak aktif' } });
        return;
      }
      const user = toSafeUser(urow as RowDataPacket);
      void sub;
      res.cookie(REFRESH_COOKIE, nextRefresh, refreshCookieOptions(env.refreshTtlDays * 24 * 3600 * 1000, req));
      res.status(200).json({ accessToken: signAccessToken(user.id, user.role), user });
    } catch (err) {
      next(err);
    }
  });

  r.post('/logout', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const presented: string | undefined = req.cookies?.[REFRESH_COOKIE];
      if (presented) {
        try {
          const { jti } = verifyRefreshToken(presented);
          const [rows] = await db.query<RowDataPacket[]>(
            'SELECT user_id FROM refresh_tokens WHERE jti_hash = ? LIMIT 1',
            [sha256Hex(jti)],
          );
          await db.query('UPDATE refresh_tokens SET revoked = 1 WHERE jti_hash = ?', [sha256Hex(jti)]);
          if (rows[0]) await writeAudit(db, 'logout', 'auth', Number(rows[0].user_id), null);
        } catch {
          // Token rusak tetap dianggap logout di sisi klien.
        }
      }
      clearRefreshCookie(res, req);
      res.status(200).json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  r.get('/me', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const [rows] = await db.query<RowDataPacket[]>(
        'SELECT id, name, email, role, is_active FROM users WHERE id = ? LIMIT 1',
        [req.user!.id],
      );
      const row = rows[0];
      if (!row || Number(row.is_active) !== 1) {
        res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Akun tidak aktif' } });
        return;
      }
      res.status(200).json({ user: toSafeUser(row) });
    } catch (err) {
      next(err);
    }
  });

  return r;
}
