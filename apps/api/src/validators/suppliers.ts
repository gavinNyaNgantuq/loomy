import { z } from 'zod';

const kodeRule = z
  .string()
  .trim()
  .min(1, 'Kode wajib diisi')
  .max(50, 'Kode maksimal 50 karakter')
  .regex(/^[A-Za-z0-9_-]+$/, 'Kode hanya huruf, angka, - dan _');

export const supplierCreateSchema = z.object({
  kode: kodeRule,
  nama: z.string().trim().min(1, 'Nama wajib diisi').max(150, 'Nama maksimal 150 karakter'),
  telepon: z.string().trim().max(30, 'Telepon maksimal 30 karakter').nullish(),
  alamat: z.string().trim().max(255, 'Alamat maksimal 255 karakter').nullish(),
  is_active: z.boolean().optional(),
});

export const supplierUpdateSchema = z
  .object({
    kode: kodeRule.optional(),
    nama: z.string().trim().min(1, 'Nama wajib diisi').max(150).optional(),
    telepon: z.string().trim().max(30).nullish(),
    alamat: z.string().trim().max(255).nullish(),
    is_active: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Minimal satu field diubah' });

export const supplierQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  is_active: z.enum(['0', '1']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type SupplierCreateInput = z.infer<typeof supplierCreateSchema>;
export type SupplierUpdateInput = z.infer<typeof supplierUpdateSchema>;
