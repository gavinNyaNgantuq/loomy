import { z } from 'zod';

const skuRule = z
  .string()
  .trim()
  .min(1, 'SKU wajib diisi')
  .max(50, 'SKU maksimal 50 karakter')
  .regex(/^[A-Za-z0-9_-]+$/, 'SKU hanya huruf, angka, - dan _');

export const productCreateSchema = z.object({
  sku: skuRule,
  nama: z.string().trim().min(1, 'Nama wajib diisi').max(150, 'Nama maksimal 150 karakter'),
  kategori: z.string().trim().max(100, 'Kategori maksimal 100 karakter').nullish(),
  is_active: z.boolean().optional(),
});

export const productUpdateSchema = z
  .object({
    sku: skuRule.optional(),
    nama: z.string().trim().min(1, 'Nama wajib diisi').max(150).optional(),
    kategori: z.string().trim().max(100).nullish(),
    is_active: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Minimal satu field diubah' });

export const productQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  is_active: z.enum(['0', '1']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type ProductCreateInput = z.infer<typeof productCreateSchema>;
export type ProductUpdateInput = z.infer<typeof productUpdateSchema>;
