import { Router, type NextFunction, type Request, type Response } from 'express';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { pool } from '../db/pool.js';
import { requireAuth, requireRole } from '../middlewares/auth.js';
import { supplierCreateSchema, supplierQuerySchema, supplierUpdateSchema } from '../validators/suppliers.js';

interface SupplierRow {
  id: number;
  kode: string;
  nama: string;
  telepon: string | null;
  alamat: string | null;
  is_active: number;
}

function toJson(row: SupplierRow) {
  return {
    id: row.id,
    kode: row.kode,
    nama: row.nama,
    telepon: row.telepon,
    alamat: row.alamat,
    is_active: Number(row.is_active) === 1,
  };
}

const COLS = 'id, kode, nama, telepon, alamat, is_active';

async function writeAudit(db: Pool, aksi: string, userId: number | null, refId: number | null): Promise<void> {
  await db.query('INSERT INTO audit_logs (user_id, aksi, entity, ref_id) VALUES (?, ?, ?, ?)', [
    userId,
    aksi,
    'suppliers',
    refId,
  ]);
}

function isDup(err: unknown): boolean {
  return (err as { code?: string }).code === 'ER_DUP_ENTRY';
}

export function createSuppliersRouter(db: Pool = pool): Router {
  const r = Router();
  r.use(requireAuth);

  // Baca: semua peran terautentikasi. Tulis: admin-only (konsisten F1-A).
  r.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const q = supplierQuerySchema.parse(req.query);
      const where: string[] = [];
      const params: unknown[] = [];
      if (q.q) {
        where.push('(kode LIKE ? OR nama LIKE ?)');
        params.push(`%${q.q}%`, `%${q.q}%`);
      }
      if (q.is_active !== undefined) {
        where.push('is_active = ?');
        params.push(Number(q.is_active));
      }
      const cond = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
      const [countRows] = await db.query<RowDataPacket[]>(`SELECT COUNT(*) AS total FROM suppliers ${cond}`, params);
      const total = Number(countRows[0].total);
      const offset = (q.page - 1) * q.limit;
      const [rows] = await db.query<RowDataPacket[]>(
        `SELECT ${COLS} FROM suppliers ${cond} ORDER BY id ASC LIMIT ? OFFSET ?`,
        [...params, q.limit, offset],
      );
      res.status(200).json({
        data: rows.map((x) => toJson(x as unknown as SupplierRow)),
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
      const [rows] = await db.query<RowDataPacket[]>(`SELECT ${COLS} FROM suppliers WHERE id = ? LIMIT 1`, [id]);
      if (!rows[0]) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Supplier tidak ditemukan' } });
        return;
      }
      res.status(200).json({ data: toJson(rows[0] as unknown as SupplierRow) });
    } catch (err) {
      next(err);
    }
  });

  r.post('/', requireRole('admin'), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const input = supplierCreateSchema.parse(req.body);
      try {
        const [result] = await db.query(
          'INSERT INTO suppliers (kode, nama, telepon, alamat, is_active) VALUES (?, ?, ?, ?, ?)',
          [input.kode, input.nama, input.telepon ?? null, input.alamat ?? null, input.is_active === false ? 0 : 1],
        );
        const insertId = Number((result as { insertId: number }).insertId);
        await writeAudit(db, 'supplier_create', req.user!.id, insertId);
        const [rows] = await db.query<RowDataPacket[]>(`SELECT ${COLS} FROM suppliers WHERE id = ? LIMIT 1`, [insertId]);
        res.status(201).json({ data: toJson(rows[0] as unknown as SupplierRow) });
      } catch (err) {
        if (isDup(err)) {
          res.status(409).json({ error: { code: 'CONFLICT', message: 'Kode supplier sudah dipakai' } });
          return;
        }
        throw err;
      }
    } catch (err) {
      next(err);
    }
  });

  r.patch('/:id', requireRole('admin'), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'ID tidak valid' } });
        return;
      }
      const input = supplierUpdateSchema.parse(req.body);
      const sets: string[] = [];
      const params: unknown[] = [];
      if (input.kode !== undefined) {
        sets.push('kode = ?');
        params.push(input.kode);
      }
      if (input.nama !== undefined) {
        sets.push('nama = ?');
        params.push(input.nama);
      }
      if (input.telepon !== undefined) {
        sets.push('telepon = ?');
        params.push(input.telepon);
      }
      if (input.alamat !== undefined) {
        sets.push('alamat = ?');
        params.push(input.alamat);
      }
      if (input.is_active !== undefined) {
        sets.push('is_active = ?');
        params.push(input.is_active ? 1 : 0);
      }
      try {
        const [result] = await db.query(`UPDATE suppliers SET ${sets.join(', ')} WHERE id = ?`, [...params, id]);
        if (Number((result as { affectedRows: number }).affectedRows) === 0) {
          res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Supplier tidak ditemukan' } });
          return;
        }
        await writeAudit(db, 'supplier_update', req.user!.id, id);
        const [rows] = await db.query<RowDataPacket[]>(`SELECT ${COLS} FROM suppliers WHERE id = ? LIMIT 1`, [id]);
        res.status(200).json({ data: toJson(rows[0] as unknown as SupplierRow) });
      } catch (err) {
        if (isDup(err)) {
          res.status(409).json({ error: { code: 'CONFLICT', message: 'Kode supplier sudah dipakai' } });
          return;
        }
        throw err;
      }
    } catch (err) {
      next(err);
    }
  });

  // Hapus fisik dilarang: supplier berelasi ke pembelian (F2).
  // Nonaktifkan via PATCH is_active=false.
  r.delete('/:id', requireRole('admin'), (_req: Request, res: Response) => {
    res.status(405).json({
      error: { code: 'METHOD_NOT_ALLOWED', message: 'Supplier tidak dapat dihapus; gunakan nonaktif (is_active=false)' },
    });
  });

  return r;
}
