import { randomBytes } from 'node:crypto';
import { Router, type NextFunction, type Request, type Response } from 'express';
import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { pool } from '../db/pool.js';
import { requireAuth, requireRole } from '../middlewares/auth.js';
import { purchaseCreateSchema, purchaseQuerySchema, purchaseUpdateSchema } from '../validators/purchases.js';

interface PurchaseRow {
  id: number;
  nomor: string;
  supplier_id: number;
  tanggal: string;
  subtotal: string | number;
  diskon: string | number;
  ongkir: string | number;
  pajak: string | number;
  total: string | number;
  status: string;
  created_by: number | null;
}

interface ItemRow {
  id: number;
  bahan_id: number;
  qty: string | number;
  harga_satuan: string | number;
  subtotal: string | number;
  bahan_kode?: string;
  bahan_nama?: string;
}

// ---- Uang aman tanpa float: sen (1/100) dan mil (1/1000) integer ----
function toCents(n: number): number {
  return Math.round(n * 100);
}
function toMillis(n: number): number {
  return Math.round(n * 1000);
}
function lineSubtotalCents(qty: number, price: number): number {
  return Math.round((toMillis(qty) * toCents(price)) / 1000);
}
function centsToMoney(cents: number): string {
  return (cents / 100).toFixed(2);
}
function millisToQty(millis: number): string {
  return (millis / 1000).toFixed(3);
}

function toJsonPO(row: PurchaseRow, items: ItemRow[] = [], supplier?: { kode: string; nama: string } | null) {
  return {
    id: row.id,
    nomor: row.nomor,
    supplier_id: row.supplier_id,
    supplier: supplier ?? undefined,
    tanggal: dateOnly(row.tanggal),
    subtotal: Number(row.subtotal),
    diskon: Number(row.diskon),
    ongkir: Number(row.ongkir),
    pajak: Number(row.pajak),
    total: Number(row.total),
    status: row.status,
    created_by: row.created_by,
    items: items.map((it) => ({
      id: it.id,
      bahan_id: it.bahan_id,
      bahan_kode: it.bahan_kode,
      bahan_nama: it.bahan_nama,
      qty: Number(it.qty),
      harga_satuan: Number(it.harga_satuan),
      subtotal: Number(it.subtotal),
    })),
  };
}

async function writeAudit(
  db: Pool | PoolConnection,
  aksi: string,
  userId: number | null,
  refId: number | null,
): Promise<void> {
  await db.query('INSERT INTO audit_logs (user_id, aksi, entity, ref_id) VALUES (?, ?, ?, ?)', [
    userId,
    aksi,
    'purchases',
    refId,
  ]);
}

function isDup(err: unknown): boolean {
  return (err as { code?: string }).code === 'ER_DUP_ENTRY';
}

function dateOnly(v: unknown): string {
  if (v instanceof Date) {
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, '0');
    const d = String(v.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return String(v).slice(0, 10);
}

// Nomor teknis server: PO-YYYYMMDD-XXXXXX (unik, pola aman, maks 50).
// Unik dijamin UNIQUE(nomor) + retry saat collision bersamaan.
function genNomor(): string {
  const d = new Date();
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const rand = randomBytes(3).toString('hex').toUpperCase();
  return `PO-${y}${mo}${day}-${rand}`;
}

async function getSupplier(db: Pool | PoolConnection, id: number) {
  const [rows] = await db.query<RowDataPacket[]>('SELECT id, kode, nama, is_active FROM suppliers WHERE id = ? LIMIT 1', [id]);
  return rows[0] as RowDataPacket | undefined;
}

async function getBahanMap(db: Pool | PoolConnection, ids: number[]) {
  if (ids.length === 0) return new Map<number, RowDataPacket>();
  const [rows] = await db.query<RowDataPacket[]>(`SELECT id, kode, nama, is_active FROM bahan WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
  const m = new Map<number, RowDataPacket>();
  for (const r of rows) m.set(Number(r.id), r);
  return m;
}

async function getPO(db: Pool | PoolConnection, id: number) {
  const [rows] = await db.query<RowDataPacket[]>('SELECT * FROM purchases WHERE id = ? LIMIT 1', [id]);
  return rows[0] as RowDataPacket | undefined;
}

async function getItems(db: Pool | PoolConnection, purchaseId: number) {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT pi.id, pi.bahan_id, pi.qty, pi.harga_satuan, pi.subtotal,
            b.kode AS bahan_kode, b.nama AS bahan_nama
       FROM purchase_items pi JOIN bahan b ON b.id = pi.bahan_id
      WHERE pi.purchase_id = ? ORDER BY pi.id ASC`,
    [purchaseId],
  );
  return rows as RowDataPacket[];
}

async function fail(conn: PoolConnection, status: number, code: string, message: string, res: Response): Promise<void> {
  try {
    await conn.rollback();
  } catch {
    // abaikan
  }
  conn.release();
  res.status(status).json({ error: { code, message } });
}

export function createPurchasesRouter(db: Pool = pool): Router {
  const r = Router();
  r.use(requireAuth);

  // Baca: semua peran terautentikasi.
  r.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const q = purchaseQuerySchema.parse(req.query);
      const where: string[] = [];
      const params: unknown[] = [];
      if (q.q) {
        where.push('p.nomor LIKE ?');
        params.push(`%${q.q}%`);
      }
      if (q.status) {
        where.push('p.status = ?');
        params.push(q.status);
      }
      if (q.supplier_id !== undefined) {
        where.push('p.supplier_id = ?');
        params.push(q.supplier_id);
      }
      const cond = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
      const [countRows] = await db.query<RowDataPacket[]>(`SELECT COUNT(*) AS total FROM purchases p ${cond}`, params);
      const total = Number(countRows[0].total);
      const offset = (q.page - 1) * q.limit;
      const [rows] = await db.query<RowDataPacket[]>(
        `SELECT p.*, s.kode AS supplier_kode, s.nama AS supplier_nama,
                (SELECT COUNT(*) FROM purchase_items pi WHERE pi.purchase_id = p.id) AS item_count
           FROM purchases p LEFT JOIN suppliers s ON s.id = p.supplier_id
           ${cond} ORDER BY p.id DESC LIMIT ? OFFSET ?`,
        [...params, q.limit, offset],
      );
      res.status(200).json({
        data: rows.map((x) => ({
          id: Number(x.id),
          nomor: String(x.nomor),
          supplier_id: Number(x.supplier_id),
          supplier_kode: x.supplier_kode ? String(x.supplier_kode) : null,
          supplier_nama: x.supplier_nama ? String(x.supplier_nama) : null,
          tanggal: dateOnly(x.tanggal),
          subtotal: Number(x.subtotal),
          diskon: Number(x.diskon),
          ongkir: Number(x.ongkir),
          pajak: Number(x.pajak),
          total: Number(x.total),
          status: String(x.status),
          created_by: x.created_by === null ? null : Number(x.created_by),
          item_count: Number(x.item_count),
        })),
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
      const po = await getPO(db, id);
      if (!po) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'PO tidak ditemukan' } });
        return;
      }
      const items = await getItems(db, id);
      const sup = await getSupplier(db, Number(po.supplier_id));
      res.status(200).json({
        data: toJsonPO(
          po as unknown as PurchaseRow,
          items as unknown as ItemRow[],
          sup ? { kode: String(sup.kode), nama: String(sup.nama) } : null,
        ),
      });
    } catch (err) {
      next(err);
    }
  });

  // Tulis: admin + gudang (matriks awal S2). Cancel: admin saja.
  r.post('/', requireRole('admin', 'gudang'), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const input = purchaseCreateSchema.parse(req.body);
      const sup = await getSupplier(db, input.supplier_id);
      if (!sup) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Supplier tidak ditemukan' } });
        return;
      }
      if (Number(sup.is_active) !== 1) {
        res.status(409).json({ error: { code: 'CONFLICT', message: 'Supplier nonaktif' } });
        return;
      }
      const bahanIds = [...new Set(input.items.map((i) => i.bahan_id))];
      const bmap = await getBahanMap(db, bahanIds);
      for (const bid of bahanIds) {
        const b = bmap.get(bid);
        if (!b) {
          res.status(404).json({ error: { code: 'NOT_FOUND', message: `Bahan ${bid} tidak ditemukan` } });
          return;
        }
        if (Number(b.is_active) !== 1) {
          res.status(409).json({ error: { code: 'CONFLICT', message: `Bahan ${String(b.kode)} nonaktif` } });
          return;
        }
      }

      // Hitung server-side integer aman.
      const lines = input.items.map((it) => {
        const sub = lineSubtotalCents(it.qty, it.harga_satuan);
        return { bahan_id: it.bahan_id, qtyMillis: toMillis(it.qty), priceCents: toCents(it.harga_satuan), subCents: sub };
      });
      const subtotalCents = lines.reduce((a, l) => a + l.subCents, 0);
      const diskonCents = toCents(input.diskon ?? 0);
      const ongkirCents = toCents(input.ongkir ?? 0);
      const pajakCents = toCents(input.pajak ?? 0);
      const totalCents = subtotalCents - diskonCents + ongkirCents + pajakCents;
      if (totalCents < 0) {
        res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Total tidak boleh negatif' } });
        return;
      }

      // Insert atomik header + item + audit. Retry nomor saat collision bersamaan.
      let poId = 0;
      let nomor = '';
      let conflict = false;
      for (let attempt = 0; attempt < 5; attempt++) {
        nomor = genNomor();
        const conn = await db.getConnection();
        try {
          await conn.beginTransaction();
          const [hr] = await conn.query<ResultSetHeader>(
            `INSERT INTO purchases (nomor, supplier_id, tanggal, subtotal, diskon, ongkir, pajak, total, status, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?)`,
            [
              nomor,
              input.supplier_id,
              input.tanggal,
              centsToMoney(subtotalCents),
              centsToMoney(diskonCents),
              centsToMoney(ongkirCents),
              centsToMoney(pajakCents),
              centsToMoney(totalCents),
              req.user!.id,
            ],
          );
          poId = hr.insertId;
          for (const l of lines) {
            await conn.query(
              'INSERT INTO purchase_items (purchase_id, bahan_id, qty, harga_satuan, subtotal) VALUES (?, ?, ?, ?, ?)',
              [poId, l.bahan_id, millisToQty(l.qtyMillis), centsToMoney(l.priceCents), centsToMoney(l.subCents)],
            );
          }
          await writeAudit(conn, 'purchase_create', req.user!.id, poId);
          await conn.commit();
          conn.release();
          conflict = false;
          break;
        } catch (err) {
          try {
            await conn.rollback();
          } catch {
            // abaikan
          }
          conn.release();
          if (isDup(err)) {
            conflict = true;
            continue;
          }
          throw err;
        }
      }
      if (poId === 0) {
        if (conflict) {
          res.status(409).json({ error: { code: 'CONFLICT', message: 'Nomor PO bentrok, coba lagi' } });
        } else {
          res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Kesalahan server' } });
        }
        return;
      }
      const po = await getPO(db, poId);
      const items = await getItems(db, poId);
      res.status(201).json({ data: toJsonPO(po as unknown as PurchaseRow, items as unknown as ItemRow[], { kode: String(sup.kode), nama: String(sup.nama) }) });
    } catch (err) {
      next(err);
    }
  });

  r.patch('/:id', requireRole('admin', 'gudang'), async (req: Request, res: Response, next: NextFunction) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'ID tidak valid' } });
      return;
    }
    let input: ReturnType<typeof purchaseUpdateSchema.parse>;
    try {
      input = purchaseUpdateSchema.parse(req.body);
    } catch (err) {
      next(err);
      return;
    }
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      const [poRows] = await conn.query<RowDataPacket[]>('SELECT * FROM purchases WHERE id = ? FOR UPDATE', [id]);
      const po = poRows[0];
      if (!po) {
        await fail(conn, 404, 'NOT_FOUND', 'PO tidak ditemukan', res);
        return;
      }
      if (String(po.status) !== 'draft') {
        await fail(conn, 409, 'CONFLICT', 'Hanya draft dapat diedit', res);
        return;
      }
      if (input.items !== undefined) {
        const [itemRows] = await conn.query<RowDataPacket[]>('SELECT id FROM purchase_items WHERE purchase_id = ?', [id]);
        if (itemRows.length > 0) {
          const ids = itemRows.map((x) => Number(x.id));
          const [brows] = await conn.query<RowDataPacket[]>(
            `SELECT COUNT(*) AS c FROM material_batches WHERE purchase_item_id IN (${ids.map(() => '?').join(',')})`,
            ids,
          );
          if (Number(brows[0].c) > 0) {
            await fail(conn, 409, 'CONFLICT', 'PO sudah ada penerimaan, tak dapat diedit', res);
            return;
          }
        }
      }

      let supplierId = Number(po.supplier_id);
      let tanggal = dateOnly(po.tanggal);
      let diskonCents = toCents(Number(po.diskon));
      let ongkirCents = toCents(Number(po.ongkir));
      let pajakCents = toCents(Number(po.pajak));
      let lines: Array<{ bahan_id: number; qtyMillis: number; priceCents: number; subCents: number }>;

      if (input.supplier_id !== undefined) {
        const [srows] = await conn.query<RowDataPacket[]>('SELECT id, is_active FROM suppliers WHERE id = ? LIMIT 1', [input.supplier_id]);
        if (!srows[0]) {
          await fail(conn, 404, 'NOT_FOUND', 'Supplier tidak ditemukan', res);
          return;
        }
        if (Number(srows[0].is_active) !== 1) {
          await fail(conn, 409, 'CONFLICT', 'Supplier nonaktif', res);
          return;
        }
        supplierId = input.supplier_id;
      }
      if (input.tanggal !== undefined) tanggal = input.tanggal;
      if (input.diskon !== undefined) diskonCents = toCents(input.diskon);
      if (input.ongkir !== undefined) ongkirCents = toCents(input.ongkir);
      if (input.pajak !== undefined) pajakCents = toCents(input.pajak);
      if (input.items !== undefined) {
        const bahanIds = [...new Set(input.items.map((i) => i.bahan_id))];
        const bmap = await getBahanMap(conn, bahanIds);
        for (const bid of bahanIds) {
          const b = bmap.get(bid);
          if (!b) {
            await fail(conn, 404, 'NOT_FOUND', `Bahan ${bid} tidak ditemukan`, res);
            return;
          }
          if (Number(b.is_active) !== 1) {
            await fail(conn, 409, 'CONFLICT', `Bahan ${String(b.kode)} nonaktif`, res);
            return;
          }
        }
        lines = input.items.map((it) => ({
          bahan_id: it.bahan_id,
          qtyMillis: toMillis(it.qty),
          priceCents: toCents(it.harga_satuan),
          subCents: lineSubtotalCents(it.qty, it.harga_satuan),
        }));
      } else {
        const [cur] = await conn.query<RowDataPacket[]>('SELECT bahan_id, qty, harga_satuan FROM purchase_items WHERE purchase_id = ?', [id]);
        lines = cur.map((x) => ({
          bahan_id: Number(x.bahan_id),
          qtyMillis: toMillis(Number(x.qty)),
          priceCents: toCents(Number(x.harga_satuan)),
          subCents: lineSubtotalCents(Number(x.qty), Number(x.harga_satuan)),
        }));
      }

      const subtotalCents = lines.reduce((a, l) => a + l.subCents, 0);
      const totalCents = subtotalCents - diskonCents + ongkirCents + pajakCents;
      if (totalCents < 0) {
        await fail(conn, 400, 'VALIDATION_ERROR', 'Total tidak boleh negatif', res);
        return;
      }
      await conn.query(
        'UPDATE purchases SET supplier_id = ?, tanggal = ?, subtotal = ?, diskon = ?, ongkir = ?, pajak = ?, total = ? WHERE id = ?',
        [supplierId, tanggal, centsToMoney(subtotalCents), centsToMoney(diskonCents), centsToMoney(ongkirCents), centsToMoney(pajakCents), centsToMoney(totalCents), id],
      );
      if (input.items !== undefined) {
        await conn.query('DELETE FROM purchase_items WHERE purchase_id = ?', [id]);
        for (const l of lines) {
          await conn.query(
            'INSERT INTO purchase_items (purchase_id, bahan_id, qty, harga_satuan, subtotal) VALUES (?, ?, ?, ?, ?)',
            [id, l.bahan_id, millisToQty(l.qtyMillis), centsToMoney(l.priceCents), centsToMoney(l.subCents)],
          );
        }
      }
      await writeAudit(conn, 'purchase_update', req.user!.id, id);
      await conn.commit();
      conn.release();
    } catch (err) {
      try {
        await conn.rollback();
      } catch {
        // abaikan
      }
      conn.release();
      next(err);
      return;
    }
    try {
      const po = await getPO(db, id);
      const items = await getItems(db, id);
      const sup = po ? await getSupplier(db, Number((po as RowDataPacket).supplier_id)) : undefined;
      res.status(200).json({
        data: toJsonPO(
          po as unknown as PurchaseRow,
          items as unknown as ItemRow[],
          sup ? { kode: String(sup.kode), nama: String(sup.nama) } : null,
        ),
      });
    } catch (err) {
      next(err);
    }
  });

  r.post('/:id/order', requireRole('admin', 'gudang'), async (req: Request, res: Response, next: NextFunction) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'ID tidak valid' } });
      return;
    }
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      const [poRows] = await conn.query<RowDataPacket[]>('SELECT * FROM purchases WHERE id = ? FOR UPDATE', [id]);
      const po = poRows[0];
      if (!po) {
        await fail(conn, 404, 'NOT_FOUND', 'PO tidak ditemukan', res);
        return;
      }
      if (String(po.status) !== 'draft') {
        await fail(conn, 409, 'CONFLICT', 'Hanya draft dapat diorder', res);
        return;
      }
      const [srows] = await conn.query<RowDataPacket[]>('SELECT id, is_active FROM suppliers WHERE id = ? LIMIT 1', [Number(po.supplier_id)]);
      if (!srows[0]) {
        await fail(conn, 404, 'NOT_FOUND', 'Supplier tidak ditemukan', res);
        return;
      }
      if (Number(srows[0].is_active) !== 1) {
        await fail(conn, 409, 'CONFLICT', 'Supplier nonaktif', res);
        return;
      }
      const [irows] = await conn.query<RowDataPacket[]>('SELECT bahan_id FROM purchase_items WHERE purchase_id = ?', [id]);
      if (irows.length === 0) {
        await fail(conn, 409, 'CONFLICT', 'PO tanpa item tak dapat diorder', res);
        return;
      }
      const bmap = await getBahanMap(conn, [...new Set(irows.map((x) => Number(x.bahan_id)))]);
      for (const x of irows) {
        const b = bmap.get(Number(x.bahan_id));
        if (!b) {
          await fail(conn, 404, 'NOT_FOUND', `Bahan ${Number(x.bahan_id)} tidak ditemukan`, res);
          return;
        }
        if (Number(b.is_active) !== 1) {
          await fail(conn, 409, 'CONFLICT', `Bahan ${String(b.kode)} nonaktif`, res);
          return;
        }
      }
      await conn.query("UPDATE purchases SET status = 'ordered' WHERE id = ?", [id]);
      await writeAudit(conn, 'purchase_order', req.user!.id, id);
      await conn.commit();
      conn.release();
    } catch (err) {
      try {
        await conn.rollback();
      } catch {
        // abaikan
      }
      conn.release();
      next(err);
      return;
    }
    try {
      const po = await getPO(db, id);
      const items = await getItems(db, id);
      const sup = po ? await getSupplier(db, Number((po as RowDataPacket).supplier_id)) : undefined;
      res.status(200).json({
        data: toJsonPO(
          po as unknown as PurchaseRow,
          items as unknown as ItemRow[],
          sup ? { kode: String(sup.kode), nama: String(sup.nama) } : null,
        ),
      });
    } catch (err) {
      next(err);
    }
  });

  r.post('/:id/cancel', requireRole('admin'), async (req: Request, res: Response, next: NextFunction) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'ID tidak valid' } });
      return;
    }
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      const [poRows] = await conn.query<RowDataPacket[]>('SELECT * FROM purchases WHERE id = ? FOR UPDATE', [id]);
      const po = poRows[0];
      if (!po) {
        await fail(conn, 404, 'NOT_FOUND', 'PO tidak ditemukan', res);
        return;
      }
      const st = String(po.status);
      // Final: draft/ordered/partial boleh batal. Received tak bisa. Cancelled tak bisa ulang.
      if (st !== 'draft' && st !== 'ordered' && st !== 'partial') {
        await fail(conn, 409, 'CONFLICT', 'Status PO tak dapat dibatalkan', res);
        return;
      }
      // Cancel partial pertahankan stok terima: Tahap 1 tanpa movement, hanya flag status.
      await conn.query("UPDATE purchases SET status = 'cancelled' WHERE id = ?", [id]);
      await writeAudit(conn, 'purchase_cancel', req.user!.id, id);
      await conn.commit();
      conn.release();
    } catch (err) {
      try {
        await conn.rollback();
      } catch {
        // abaikan
      }
      conn.release();
      next(err);
      return;
    }
    try {
      const po = await getPO(db, id);
      const items = await getItems(db, id);
      const sup = po ? await getSupplier(db, Number((po as RowDataPacket).supplier_id)) : undefined;
      res.status(200).json({
        data: toJsonPO(
          po as unknown as PurchaseRow,
          items as unknown as ItemRow[],
          sup ? { kode: String(sup.kode), nama: String(sup.nama) } : null,
        ),
      });
    } catch (err) {
      next(err);
    }
  });

  // Hapus fisik dilarang: PO punya jejak audit + relasi item.
  // Batalkan via POST /:id/cancel.
  r.delete('/:id', requireRole('admin'), (_req: Request, res: Response) => {
    res.status(405).json({
      error: { code: 'METHOD_NOT_ALLOWED', message: 'PO tidak dapat dihapus; gunakan batal (cancel)' },
    });
  });

  return r;
}
