import mysql from 'mysql2/promise';
import { env } from '../env.js';

export const pool = mysql.createPool({
  host: env.db.host,
  port: env.db.port,
  user: env.db.user,
  password: env.db.password,
  database: env.db.database,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: 'utf8mb4',
});

/** Ping DB dengan timeout. Resolve true bila up, false bila down. Tidak throw. */
export async function pingDb(timeoutMs = 2000): Promise<boolean> {
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.query({ sql: 'SELECT 1', timeout: timeoutMs });
    return true;
  } catch {
    return false;
  } finally {
    if (conn) conn.release();
  }
}

export async function closePool(): Promise<void> {
  await pool.end();
}
