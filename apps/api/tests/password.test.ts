import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../src/utils/password.js';

describe('password hashing (F0)', () => {
  it('hash lalu verifikasi cocok', async () => {
    const hash = await hashPassword('password-minimal-12');
    expect(hash).not.toContain('password-minimal-12');
    expect(await verifyPassword('password-minimal-12', hash)).toBe(true);
  });
  it('password salah ditolak', async () => {
    const hash = await hashPassword('password-minimal-12');
    expect(await verifyPassword('salah', hash)).toBe(false);
  });
});
