import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../env.js';
import type { Role } from '../types.js';

export interface AccessClaims {
  sub: string;
  role: Role;
}

export function signAccessToken(userId: number, role: Role): string {
  const payload: AccessClaims = { sub: String(userId), role };
  return jwt.sign(payload, env.jwtAccessSecret, { expiresIn: env.accessTtlSeconds });
}

export function verifyAccessToken(token: string): AccessClaims {
  return jwt.verify(token, env.jwtAccessSecret) as AccessClaims;
}

export interface RefreshPair {
  token: string;
  jti: string;
}

export function signRefreshToken(userId: number): RefreshPair {
  const jti = crypto.randomUUID();
  const token = jwt.sign({ sub: String(userId), jti }, env.jwtRefreshSecret, {
    expiresIn: `${env.refreshTtlDays}d`,
  });
  return { token, jti };
}

export function verifyRefreshToken(token: string): { sub: string; jti: string } {
  return jwt.verify(token, env.jwtRefreshSecret) as { sub: string; jti: string };
}

export function sha256Hex(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

export function newFamilyId(): string {
  return crypto.randomUUID().replace(/-/g, '');
}
