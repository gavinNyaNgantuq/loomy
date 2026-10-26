import { describe, expect, it } from 'vitest';
import { sha256Hex, signAccessToken, signRefreshToken, verifyAccessToken, verifyRefreshToken } from '../src/utils/jwt.js';

describe('jwt (F0)', () => {
  it('access token sign/verify membawa sub+role', () => {
    const t = signAccessToken(7, 'kasir');
    const c = verifyAccessToken(t);
    expect(c.sub).toBe('7');
    expect(c.role).toBe('kasir');
  });
  it('refresh token membawa jti unik', () => {
    const a = signRefreshToken(7);
    const b = signRefreshToken(7);
    expect(a.jti).not.toBe(b.jti);
    expect(verifyRefreshToken(a.token).jti).toBe(a.jti);
  });
  it('token rusak ditolak', () => {
    expect(() => verifyAccessToken('rusak')).toThrow();
  });
  it('sha256 stabil 64 hex', () => {
    expect(sha256Hex('abc')).toMatch(/^[0-9a-f]{64}$/);
  });
});
