import { Router, type NextFunction, type Request, type Response } from 'express';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { pool } from '../db/pool.js';
import { requireAuth, requireRole } from '../middlewares/auth.js';
import { productCreateSchema, productQuerySchema, productUpdateSchema } from '../validators/products.js';

interface ProductRow {
  id: number;
  sku: string;
  nama: string;
  kategori: string | null;
  is_active: number;
}

function toJson(row: ProductRow) {
  return {
    id: row.id,
    sku: row.sku,
    nama: row.nama,
    kategori: row.kategori,
    is_active: Number(row.is_active) === 1,
  };
}

async function writeAudit(db: Pool, aksi: string, userId: number | null, refId: number | null): Promise<void> {
  await db.query('INSERT INTO audit_logs (user_id, aksi, entity, ref_id) VALUES (?, ?, ?, ?)', [
    userId,
    aksi,
    'products',
    refId,
  ]);
}

function isDup(err: unknown): boolean {
  return (err as { code?: string }).code === 'ER_DUP_ENTRY';
}

export function createProductsRouter(db: Pool = pool): Router {
  const r = Router();
  r.use(requireAuth);

  // Daftar + cari + filter + pagination. Baca: semua peran terautentikasi.
  r.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const q = productQuerySchema.parse(req.query);
      const where: string[] = [];
      const params: unknown[] = [];
      if (q.q) {
        where.push('(sku LIKE ? OR nama LIKE ?)');
        params.push(`%${q.q}%`, `%${q.q}%`);
      }
      if (q.is_active !== undefined) {
        where.push('is_active = ?');
        params.push(Number(q.is_active));
      }
      const cond = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
      const [countRows] = await db.query<RowDataPacket[]>(`SELECT COUNT(*) AS total FROM products ${cond}`, params);
      const total = Number(countRows[0].total);
      const offset = (q.page - 1) * q.limit;
      const [rows] = await db.query<RowDataPacket[]>(
        `SELECT id, sku, nama, kategori, is_active FROM products ${cond} ORDER BY id ASC LIMIT ? OFFSET ?`,
        [...params, q.limit, offset],
      );
      res.status(200).json({
        data: rows.map((x) => toJson(x as unknown as ProductRow)),
        meta: { page: q.page, limit: q.limit, total, totalPages: Math.ceil(total / q.limit) },
      });
    } catch (err) {
      next(err);
    }
  });

  // Detail.
  r.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'ID tidak valid' } });
        return;
      }
      const [rows] = await db.query<RowDataPacket[]>('SELECT id, sku, nama, kategori, is_active FROM products WHERE id = ? LIMIT 1', [id]);
      if (!rows[0]) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Produk tidak ditemukan' } });
        return;
      }
      res.status(200).json({ data: toJson(rows[0] as unknown as ProductRow) });
    } catch (err) {
      next(err);
    }
  });

  // Tulis: admin only (keputusan konservatif F1-A; produksi/kasir baca saja).
  r.post('/', requireRole('admin'), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const input = productCreateSchema.parse(req.body);
      try {
        const [result] = await db.query(
          'INSERT INTO products (sku, nama, kategori, is_active) VALUES (?, ?, ?, ?)',
          [input.sku, input.nama, input.kategori ?? null, input.is_active === false ? 0 : 1],
        );
        const insertId = Number((result as { insertId: number }).insertId);
        await writeAudit(db, 'product_create', req.user!.id, insertId);
        const [rows] = await db.query<RowDataPacket[]>('SELECT id, sku, nama, kategori, is_active FROM products WHERE id = ? LIMIT 1', [insertId]);
        res.status(201).json({ data: toJson(rows[0] as unknown as ProductRow) });
      } catch (err) {
        if (isDup(err)) {
          res.status(409).json({ error: { code: 'CONFLICT', message: 'SKU sudah dipakai' } });
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
      const input = productUpdateSchema.parse(req.body);
      const sets: string[] = [];
      const params: unknown[] = [];
      if (input.sku !== undefined) {
        sets.push('sku = ?');
        params.push(input.sku);
      }
      if (input.nama !== undefined) {
        sets.push('nama = ?');
        params.push(input.nama);
      }
      if (input.kategori !== undefined) {
        sets.push('kategori = ?');
        params.push(input.kategori);
      }
      if (input.is_active !== undefined) {
        sets.push('is_active = ?');
        params.push(input.is_active ? 1 : 0);
      }
      try {
        const [result] = await db.query(`UPDATE products SET ${sets.join(', ')} WHERE id = ?`, [...params, id]);
        if (Number((result as { affectedRows: number }).affectedRows) === 0) {
          res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Produk tidak ditemukan' } });
          return;
        }
        await writeAudit(db, 'product_update', req.user!.id, id);
        const [rows] = await db.query<RowDataPacket[]>('SELECT id, sku, nama, kategori, is_active FROM products WHERE id = ? LIMIT 1', [id]);
        res.status(200).json({ data: toJson(rows[0] as unknown as ProductRow) });
      } catch (err) {
        if (isDup(err)) {
          res.status(409).json({ error: { code: 'CONFLICT', message: 'SKU sudah dipakai' } });
          return;
        }
        throw err;
      }
    } catch (err) {
      next(err);
    }
  });

  // Hapus fisik dilarang: produk berelasi ke produksi/penjualan (F3/F4).
  // Nonaktifkan via PATCH is_active=false.
  r.delete('/:id', requireRole('admin'), (_req: Request, res: Response) => {
    res.status(405).json({
      error: { code: 'METHOD_NOT_ALLOWED', message: 'Produk tidak dapat dihapus; gunakan nonaktif (is_active=false)' },
    });
  });

  return r;
}
