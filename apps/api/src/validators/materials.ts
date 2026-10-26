import { z } from 'zod';

const kodeRule = z
  .string()
  .trim()
  .min(1, 'Kode wajib diisi')
  .max(50, 'Kode maksimal 50 karakter')
  .regex(/^[A-Za-z0-9_-]+$/, 'Kode hanya huruf, angka, - dan _');

// CONFIRMED 2026-10-14: jenis = kain, karet, benang. Satuan = kg.
// Tidak mengarang takaran BOM per ukuran di sini.
export const MATERIAL_JENIS = ['kain', 'karet', 'benang'] as const;

export const materialCreateSchema = z.object({
  kode: kodeRule,
  nama: z.string().trim().min(1, 'Nama wajib diisi').max(150, 'Nama maksimal 150 karakter'),
  jenis: z.enum(MATERIAL_JENIS, { errorMap: () => ({ message: 'Jenis harus kain, karet, atau benang' }) }),
  satuan: z.literal('kg', { errorMap: () => ({ message: 'Satuan bahan harus kg' }) }).optional(),
  stok_minimum: z.coerce.number().min(0, 'Stok minimum >= 0').max(9999999999).optional(),
  is_active: z.boolean().optional(),
});

export const materialUpdateSchema = z
  .object({
    kode: kodeRule.optional(),
    nama: z.string().trim().min(1, 'Nama wajib diisi').max(150).optional(),
    jenis: z.enum(MATERIAL_JENIS).optional(),
    // Satuan terkunci kg; tolak nilai lain bila dikirim.
    satuan: z.literal('kg').optional(),
    stok_minimum: z.coerce.number().min(0).max(9999999999).optional(),
    is_active: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Minimal satu field diubah' });

export const materialQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  jenis: z.enum(MATERIAL_JENIS).optional(),
  is_active: z.enum(['0', '1']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type MaterialCreateInput = z.infer<typeof materialCreateSchema>;
export type MaterialUpdateInput = z.infer<typeof materialUpdateSchema>;
