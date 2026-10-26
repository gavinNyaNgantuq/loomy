import { describe, expect, it } from 'vitest';
import { loginSchema } from '../src/validators/auth.js';

describe('loginSchema (F0)', () => {
  it('menerima email+password valid', () => {
    const out = loginSchema.parse({ email: 'Admin@Loomy.local', password: 'rahasia123' });
    expect(out.email).toBe('admin@loomy.local');
  });
  it('menolak email invalid', () => {
    expect(() => loginSchema.parse({ email: 'bukan-email', password: 'x' })).toThrow();
  });
  it('menolak password kosong', () => {
    expect(() => loginSchema.parse({ email: 'a@b.co', password: '' })).toThrow();
  });
});
