import { describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import { requireAuth, requireRole } from '../src/middlewares/auth.js';
import { signAccessToken } from '../src/utils/jwt.js';

function mockRes() {
  const res = {} as Response;
  res.status = vi.fn().mockReturnValue(res) as unknown as Response['status'];
  res.json = vi.fn().mockReturnValue(res) as unknown as Response['json'];
  return res;
}

describe('auth middleware (F0)', () => {
  it('tanpa header → 401', () => {
    const req = { headers: {} } as Request;
    const res = mockRes();
    const next = vi.fn();
    requireAuth(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
  it('token valid → next + req.user', () => {
    const req = { headers: { authorization: `Bearer ${signAccessToken(3, 'admin')}` } } as Request;
    const res = mockRes();
    const next = vi.fn();
    requireAuth(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.user).toMatchObject({ id: 3, role: 'admin' });
  });
  it('role tidak cocok → 403', () => {
    const req = { user: { id: 3, role: 'kasir' } } as unknown as Request;
    const res = mockRes();
    const next = vi.fn();
    requireRole('admin')(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
  it('role cocok → next', () => {
    const req = { user: { id: 3, role: 'admin' } } as unknown as Request;
    const res = mockRes();
    const next = vi.fn();
    requireRole('admin')(req, res, next);
    expect(next).toHaveBeenCalled();
  });
});
