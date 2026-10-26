import { Router, type NextFunction, type Request, type Response } from 'express';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { pool } from '../db/pool.js';
import { requireAuth, requireRole } from '../middlewares/auth.js';
import { userCreateSchema, userQuerySchema, userUpdateSchema } from '../validators/users.js';
import { hashPassword } from '../utils/password.js';
import { isRole, type Role, type SafeUser } from '../types.js';

const COLS = 'id, name, email, role, is_active';

function toJson(row: { id: number; name: string; email: string; role: Role; is_active: number }): SafeUser & { is_active: boolean } {
  if (!isRole(row.role)) throw new Error('role invalid');
  return { id: Number(row.id), name: String(row.name), email: String(row.email), role: row.role, is_active: Number(row.is_active) === 1 };
}

async function writeAudit(db: Pool, aksi: string, userId: number | null, refId: number | null): Promise<void> {
  await db.query('INSERT INTO audit_logs (user_id, aksi, entity, ref_id) VALUES (?, ?, ?, ?)', [
    userId,
    aksi,
    'users',
    refId,
  ]);
}

function isDup(err: unknown): boolean {
  return (err as { code?: string }).code === 'ER_DUP_ENTRY';
}

/** True bila target admin aktif terakhir — operasi yang menghilangkannya dilarang. */
export async function isLastActiveAdmin(db: Pool, targetId: number): Promise<boolean> {
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND is_active = 1 AND id <> ?",
    [targetId],
  );
  const [self] = await db.query<RowDataPacket[]>('SELECT role, is_active FROM users WHERE id = ? LIMIT 1', [targetId]);
  if (!self[0] || self[0].role !== 'admin' || Number(self[0].is_active) !== 1) return false;
  return Number(rows[0].c) === 0;
}

export function createUsersRouter(db: Pool = pool): Router {
  const r = Router();
  // Kelola user: admin-only penuh (baca maupun tulis).
  r.use(requireAuth, requireRole('admin'));

  r.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const q = userQuerySchema.parse(req.query);
      const where: string[] = [];
      const params: unknown[] = [];
      if (q.q) {
        where.push('(name LIKE ? OR email LIKE ?)');
        params.push(`%${q.q}%`, `%${q.q}%`);
      }
      if (q.is_active !== undefined) {
        where.push('is_active = ?');
        params.push(Number(q.is_active));
      }
      const cond = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
      const [countRows] = await db.query<RowDataPacket[]>(`SELECT COUNT(*) AS total FROM users ${cond}`, params);
      const total = Number(countRows[0].total);
      const offset = (q.page - 1) * q.limit;
      const [rows] = await db.query<RowDataPacket[]>(
        `SELECT ${COLS} FROM users ${cond} ORDER BY id ASC LIMIT ? OFFSET ?`,
        [...params, q.limit, offset],
      );
      res.status(200).json({
        data: rows.map((x) => toJson(x as unknown as { id: number; name: string; email: string; role: Role; is_active: number })),
        meta: { page: q.page, limit: q.limit, total, totalPages: Math.ceil(total / q.limit) },
      });
    } catch (err) {
      next(err);
    }
  });

  r.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'ID tidak valid' } });
        return;
      }
      const [rows] = await db.query<RowDataPacket[]>(`SELECT ${COLS} FROM users WHERE id = ? LIMIT 1`, [id]);
      if (!rows[0]) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User tidak ditemukan' } });
        return;
      }
      res.status(200).json({ data: toJson(rows[0] as unknown as { id: number; name: string; email: string; role: Role; is_active: number }) });
    } catch (err) {
      next(err);
    }
  });

  r.post('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const input = userCreateSchema.parse(req.body);
      try {
        const password_hash = await hashPassword(input.password);
        const [result] = await db.query('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)', [
          input.name,
          input.email,
          password_hash,
          input.role,
        ]);
        const insertId = Number((result as { insertId: number }).insertId);
        await writeAudit(db, 'user_create', req.user!.id, insertId);
        const [rows] = await db.query<RowDataPacket[]>(`SELECT ${COLS} FROM users WHERE id = ? LIMIT 1`, [insertId]);
        res.status(201).json({ data: toJson(rows[0] as unknown as { id: number; name: string; email: string; role: Role; is_active: number }) });
      } catch (err) {
        if (isDup(err)) {
          res.status(409).json({ error: { code: 'CONFLICT', message: 'Email sudah dipakai' } });
          return;
        }
        throw err;
      }
    } catch (err) {
      next(err);
    }
  });

  r.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'ID tidak valid' } });
        return;
      }
      const input = userUpdateSchema.parse(req.body);
      // Larang ubah role diri sendiri (anti self-promotion/demotion via request).
      if (id === req.user!.id && input.role !== undefined) {
        res.status(403).json({ error: { code: 'SELF_ROLE_CHANGE', message: 'Role akun sendiri tidak dapat diubah' } });
        return;
      }
      // Larang nonaktifkan diri sendiri.
      if (id === req.user!.id && input.is_active === false) {
        res.status(403).json({ error: { code: 'SELF_DEACTIVATE', message: 'Akun sendiri tidak dapat dinonaktifkan' } });
        return;
      }
      // Larang hilangkan admin aktif terakhir (via nonaktif atau pindah role).
      if ((input.is_active === false || (input.role !== undefined && input.role !== 'admin')) && (await isLastActiveAdmin(db, id))) {
        res.status(409).json({ error: { code: 'LAST_ADMIN', message: 'Operasi ditolak: minimal satu admin aktif harus tersisa' } });
        return;
      }
      const sets: string[] = [];
      const params: unknown[] = [];
      if (input.name !== undefined) {
        sets.push('name = ?');
        params.push(input.name);
      }
      if (input.role !== undefined) {
        sets.push('role = ?');
        params.push(input.role);
      }
      if (input.is_active !== undefined) {
        sets.push('is_active = ?');
        params.push(input.is_active ? 1 : 0);
      }
      const [result] = await db.query(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, [...params, id]);
      if (Number((result as { affectedRows: number }).affectedRows) === 0) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User tidak ditemukan' } });
        return;
      }
      await writeAudit(db, 'user_update', req.user!.id, id);
      const [rows] = await db.query<RowDataPacket[]>(`SELECT ${COLS} FROM users WHERE id = ? LIMIT 1`, [id]);
      res.status(200).json({ data: toJson(rows[0] as unknown as { id: number; name: string; email: string; role: Role; is_active: number }) });
    } catch (err) {
      next(err);
    }
  });

  // Hapus fisik user dilarang (referensi created_by/audit di seluruh modul).
  r.delete('/:id', (_req: Request, res: Response) => {
    res.status(405).json({
      error: { code: 'METHOD_NOT_ALLOWED', message: 'User tidak dapat dihapus; gunakan nonaktif (is_active=false)' },
    });
  });

  return r;
}
