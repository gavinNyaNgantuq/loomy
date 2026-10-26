import 'dotenv/config';

function str(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  // String kosong diizinkan (mis. DB lokal tanpa password).
  if (v === undefined) throw new Error(`ENV ${name} wajib diisi`);
  return v;
}

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const v = Number(raw);
  if (!Number.isFinite(v)) throw new Error(`ENV ${name} harus angka`);
  return v;
}

const nodeEnv = process.env.NODE_ENV ?? 'development';
const accessSecret = str('JWT_ACCESS_SECRET', 'test-access-secret-minimal-32-karakter-xxxx');
const refreshSecret = str('JWT_REFRESH_SECRET', 'test-refresh-secret-minimal-32-karakter-xxx');

if (nodeEnv === 'production') {
  if (accessSecret.length < 32 || refreshSecret.length < 32) {
    throw new Error('JWT secret production minimal 32 karakter');
  }
  if (accessSecret === refreshSecret) throw new Error('JWT access dan refresh secret harus berbeda');
}

export const env = {
  nodeEnv,
  isProd: nodeEnv === 'production',
  port: num('PORT', 3001),
  corsOrigins: str('CORS_ORIGIN', 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  db: {
    host: str('DB_HOST', '127.0.0.1'),
    port: num('DB_PORT', 3306),
    user: str('DB_USER', 'loomy'),
    password: str('DB_PASSWORD', ''),
    database: str('DB_NAME', 'loomy'),
  },
  jwtAccessSecret: accessSecret,
  jwtRefreshSecret: refreshSecret,
  bcryptRounds: 12,
  accessTtlSeconds: 15 * 60,
  refreshTtlDays: 7,
  seedAdminEmail: process.env.SEED_ADMIN_EMAIL ?? '',
  seedAdminPassword: process.env.SEED_ADMIN_PASSWORD ?? '',
} as const;
