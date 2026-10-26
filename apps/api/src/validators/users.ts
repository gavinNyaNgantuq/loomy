import { z } from 'zod';
import { ROLES } from '../types.js';

export const userCreateSchema = z.object({
  name: z.string().trim().min(1, 'Nama wajib diisi').max(100, 'Nama maksimal 100 karakter'),
  email: z.string().trim().toLowerCase().email('Email tidak valid').max(190),
  password: z.string().min(8, 'Password minimal 8 karakter').max(200),
  role: z.enum(ROLES),
});

export const userUpdateSchema = z
  .object({
    name: z.string().trim().min(1, 'Nama wajib diisi').max(100).optional(),
    role: z.enum(ROLES).optional(),
    is_active: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Minimal satu field diubah' });

export const userQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  is_active: z.enum(['0', '1']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type UserCreateInput = z.infer<typeof userCreateSchema>;
export type UserUpdateInput = z.infer<typeof userUpdateSchema>;
