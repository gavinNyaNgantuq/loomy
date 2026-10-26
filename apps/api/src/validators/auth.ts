import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Email tidak valid').max(190),
  password: z.string().min(1, 'Password wajib diisi').max(200),
});

export type LoginInput = z.infer<typeof loginSchema>;
