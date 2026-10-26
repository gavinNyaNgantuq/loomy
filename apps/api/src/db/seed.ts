import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import { env } from '../env.js';
import { migrate } from './migrate.js';

/**
 * Seed aman F0: membuat SATU akun admin bila belum ada.
 * Kredensial hanya dari ENV (SEED_ADMIN_EMAIL/SEED_ADMIN_PASSWORD).
 * Idempoten: bila email sudah ada, tidak mengubah apa pun.
 * Tidak pernah mencetak password.
 */
async function main(): Promise<void> {
  const email = env.seedAdminEmail.trim().toLowerCase();
  const password = env.seedAdminPassword;
  if (!email || !password) {
    console.error('seed: SEED_ADMIN_EMAIL dan SEED_ADMIN_PASSWORD wajib diisi via ENV');
    process.exit(1);
  }
  if (password.length < 12) {
    console.error('seed: SEED_ADMIN_PASSWORD minimal 12 karakter');
    process.exit(1);
  }
  await migrate();
  const conn = await mysql.createConnection({
    host: env.db.host,
    port: env.db.port,
    user: env.db.user,
    password: env.db.password,
    database: env.db.database,
    charset: 'utf8mb4',
  });
  try {
    const [rows] = await conn.query('SELECT id FROM users WHERE email = ? LIMIT 1', [email]);
    if (Array.isArray(rows) && rows.length > 0) {
      console.log(`seed: akun ${email} sudah ada, tidak diubah`);
      return;
    }
    const hash = await bcrypt.hash(password, env.bcryptRounds);
    await conn.query('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)', [
      'Administrator',
      email,
      hash,
      'admin',
    ]);
    console.log(`seed: akun admin ${email} dibuat`);
  } finally {
    await conn.end();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('seed: gagal:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
