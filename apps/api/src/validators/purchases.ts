import { z } from 'zod';

export const PURCHASE_STATUS = ['draft', 'ordered', 'partial', 'received', 'cancelled'] as const;
export type PurchaseStatus = (typeof PURCHASE_STATUS)[number];

// Batas kolom: qty DECIMAL(14,3), uang DECIMAL(16,2). Validasi desimal via string
// agar tak kena artefak float (contoh 1.2345*1000).
function decimalPlaces(v: number): number {
  const s = String(v);
  if (!Number.isFinite(v) || s.includes('e') || s.includes('E')) return 99;
  const i = s.indexOf('.');
  return i < 0 ? 0 : s.length - i - 1;
}

const qtyRule = z
  .coerce
  .number()
  .gt(0, 'Qty harus > 0')
  .max(99999999999.999, 'Qty terlalu besar')
  .refine((v) => decimalPlaces(v) <= 3, { message: 'Qty maksimal 3 desimal' });

const priceRule = z
  .coerce
  .number()
  .min(0, 'Harga minimal 0')
  .max(99999999999999.99, 'Harga terlalu besar')
  .refine((v) => decimalPlaces(v) <= 2, { message: 'Harga maksimal 2 desimal' });

const moneyOpt = z
  .coerce
  .number()
  .min(0, 'Nilai minimal 0')
  .max(99999999999999.99, 'Nilai terlalu besar')
  .refine((v) => decimalPlaces(v) <= 2, { message: 'Nilai maksimal 2 desimal' })
  .optional();

function isRealDate(ymd: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

export function todayLocal(): string {
  const n = new Date();
  const y = n.getFullYear();
  const mo = String(n.getMonth() + 1).padStart(2, '0');
  const d = String(n.getDate()).padStart(2, '0');
  return `${y}-${mo}-${d}`;
}

// PO hanya boleh bertanggal hari ini atau sebelumnya (final S2 Tahap 0).
const poDateRule = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Tanggal format YYYY-MM-DD')
  .refine(isRealDate, { message: 'Tanggal tidak valid' })
  .refine((v) => v <= todayLocal(), { message: 'Tanggal PO maksimal hari ini' });

const itemSchema = z.object({
  bahan_id: z.coerce.number().int('bahan_id harus integer').min(1, 'bahan_id tidak valid'),
  qty: qtyRule,
  harga_satuan: priceRule,
});

function uniqueBahan(items: Array<{ bahan_id: number }>): boolean {
  const seen = new Set<number>();
  for (const it of items) {
    if (seen.has(it.bahan_id)) return false;
    seen.add(it.bahan_id);
  }
  return true;
}

// Batas 100 item per PO (disetujui audit Tahap 0).
const itemsRule = z
  .array(itemSchema)
  .min(1, 'Minimal 1 item')
  .max(100, 'Maksimal 100 item')
  .refine(uniqueBahan, { message: 'bahan_id duplikat dalam satu PO' });

export const purchaseCreateSchema = z.object({
  supplier_id: z.coerce.number().int('supplier_id harus integer').min(1, 'supplier_id tidak valid'),
  tanggal: poDateRule,
  items: itemsRule,
  diskon: moneyOpt,
  ongkir: moneyOpt,
  pajak: moneyOpt,
});

export const purchaseUpdateSchema = z
  .object({
    supplier_id: z.coerce.number().int('supplier_id harus integer').min(1, 'supplier_id tidak valid').optional(),
    tanggal: poDateRule.optional(),
    items: itemsRule.optional(),
    diskon: moneyOpt,
    ongkir: moneyOpt,
    pajak: moneyOpt,
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Minimal satu field diubah' });

export const purchaseQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(PURCHASE_STATUS).optional(),
  supplier_id: z.coerce.number().int().min(1).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type PurchaseCreateInput = z.infer<typeof purchaseCreateSchema>;
export type PurchaseUpdateInput = z.infer<typeof purchaseUpdateSchema>;
