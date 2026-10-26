import mysql from 'mysql2/promise';
import { env } from '../env.js';

/**
 * Migrasi F0–F1 + F2 S1 skema pembelian (header + item + batch + movement).
 * Idempoten (IF NOT EXISTS). TIDAK ada DROP/ALTER destruktif.
 * Membuat database bila belum ada (CREATE DATABASE IF NOT EXISTS).
 * Catatan S1: hanya skema. Stok + Average Cost belum berjalan
 * (baru aktif saat proses receive di S2).
 */
export async function migrate(): Promise<void> {
  const admin = await mysql.createConnection({
    host: env.db.host,
    port: env.db.port,
    user: env.db.user,
    password: env.db.password,
    charset: 'utf8mb4',
  });
  try {
    await admin.query(
      `CREATE DATABASE IF NOT EXISTS \`${env.db.database.replace(/`/g, '')}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    );
  } finally {
    await admin.end();
  }

  const conn = await mysql.createConnection({
    host: env.db.host,
    port: env.db.port,
    user: env.db.user,
    password: env.db.password,
    database: env.db.database,
    charset: 'utf8mb4',
  });
  try {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS users (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        email VARCHAR(190) NOT NULL UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        role ENUM('admin','gudang','produksi','kasir','keuangan') NOT NULL,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_users_role (role)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    await conn.query(`
      CREATE TABLE IF NOT EXISTS refresh_tokens (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        jti_hash CHAR(64) NOT NULL UNIQUE,
        family_id CHAR(64) NOT NULL,
        user_id BIGINT UNSIGNED NOT NULL,
        expires_at DATETIME NOT NULL,
        revoked TINYINT(1) NOT NULL DEFAULT 0,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_refresh_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
        INDEX idx_refresh_user (user_id),
        INDEX idx_refresh_family (family_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    await conn.query(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        tanggal DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        user_id BIGINT UNSIGNED NULL,
        aksi VARCHAR(100) NOT NULL,
        entity VARCHAR(100) NOT NULL,
        ref_id BIGINT UNSIGNED NULL,
        before_json JSON NULL,
        after_json JSON NULL,
        CONSTRAINT fk_audit_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL,
        INDEX idx_audit_entity (entity, ref_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    await conn.query(`
      CREATE TABLE IF NOT EXISTS products (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        sku VARCHAR(50) NOT NULL UNIQUE,
        nama VARCHAR(150) NOT NULL,
        kategori VARCHAR(100) NULL,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_products_nama (nama),
        INDEX idx_products_active (is_active)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    await conn.query(`
      CREATE TABLE IF NOT EXISTS suppliers (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        kode VARCHAR(50) NOT NULL UNIQUE,
        nama VARCHAR(150) NOT NULL,
        telepon VARCHAR(30) NULL,
        alamat VARCHAR(255) NULL,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_suppliers_nama (nama),
        INDEX idx_suppliers_active (is_active)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    await conn.query(`
      CREATE TABLE IF NOT EXISTS customers (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        kode VARCHAR(50) NOT NULL UNIQUE,
        nama VARCHAR(150) NOT NULL,
        telepon VARCHAR(30) NULL,
        alamat VARCHAR(255) NULL,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_customers_nama (nama),
        INDEX idx_customers_active (is_active)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    await conn.query(`
      CREATE TABLE IF NOT EXISTS bahan (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        kode VARCHAR(50) NOT NULL UNIQUE,
        nama VARCHAR(150) NOT NULL,
        jenis ENUM('kain','karet','benang') NOT NULL,
        satuan VARCHAR(10) NOT NULL DEFAULT 'kg',
        stok_minimum DECIMAL(14,3) NOT NULL DEFAULT 0,
        harga_rata2 DECIMAL(16,2) NOT NULL DEFAULT 0,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_bahan_nama (nama),
        INDEX idx_bahan_jenis (jenis),
        INDEX idx_bahan_active (is_active)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    await conn.query(`
      CREATE TABLE IF NOT EXISTS purchases (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        nomor VARCHAR(50) NOT NULL UNIQUE,
        supplier_id BIGINT UNSIGNED NOT NULL,
        tanggal DATE NOT NULL,
        subtotal DECIMAL(16,2) NOT NULL DEFAULT 0,
        diskon DECIMAL(16,2) NOT NULL DEFAULT 0,
        ongkir DECIMAL(16,2) NOT NULL DEFAULT 0,
        pajak DECIMAL(16,2) NOT NULL DEFAULT 0,
        total DECIMAL(16,2) NOT NULL DEFAULT 0,
        status ENUM('draft','ordered','partial','received','cancelled') NOT NULL DEFAULT 'draft',
        created_by BIGINT UNSIGNED NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT fk_purchases_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers (id) ON DELETE RESTRICT,
        CONSTRAINT fk_purchases_user FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
        INDEX idx_purchases_supplier (supplier_id),
        INDEX idx_purchases_tanggal_status (tanggal, status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    await conn.query(`
      CREATE TABLE IF NOT EXISTS purchase_items (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        purchase_id BIGINT UNSIGNED NOT NULL,
        bahan_id BIGINT UNSIGNED NOT NULL,
        qty DECIMAL(14,3) NOT NULL,
        harga_satuan DECIMAL(16,2) NOT NULL,
        subtotal DECIMAL(16,2) NOT NULL,
        CONSTRAINT fk_pitem_purchase FOREIGN KEY (purchase_id) REFERENCES purchases (id) ON DELETE RESTRICT,
        CONSTRAINT fk_pitem_bahan FOREIGN KEY (bahan_id) REFERENCES bahan (id) ON DELETE RESTRICT,
        UNIQUE KEY uq_pitem_purchase_bahan (purchase_id, bahan_id),
        INDEX idx_pitem_purchase (purchase_id),
        INDEX idx_pitem_bahan (bahan_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    await conn.query(`
      CREATE TABLE IF NOT EXISTS material_batches (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        bahan_id BIGINT UNSIGNED NOT NULL,
        purchase_item_id BIGINT UNSIGNED NOT NULL,
        receive_key VARCHAR(64) NOT NULL,
        qty_awal DECIMAL(14,3) NOT NULL,
        qty_sisa DECIMAL(14,3) NOT NULL,
        harga_satuan DECIMAL(16,2) NOT NULL,
        tanggal_masuk DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_mbatch_bahan FOREIGN KEY (bahan_id) REFERENCES bahan (id) ON DELETE RESTRICT,
        CONSTRAINT fk_mbatch_pitem FOREIGN KEY (purchase_item_id) REFERENCES purchase_items (id) ON DELETE RESTRICT,
        UNIQUE KEY uq_mbatch_receive_item (receive_key, purchase_item_id),
        INDEX idx_mbatch_bahan_tanggal (bahan_id, tanggal_masuk)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    await conn.query(`
      CREATE TABLE IF NOT EXISTS inventory_movements (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        tanggal DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        tipe ENUM('purchase_in','production_out','production_in','sales_out','return_in','return_out','adjustment','opname') NOT NULL,
        ref_type VARCHAR(50) NOT NULL,
        ref_id BIGINT UNSIGNED NULL,
        reverses_ref BIGINT UNSIGNED NULL,
        bahan_id BIGINT UNSIGNED NULL,
        product_id BIGINT UNSIGNED NULL,
        qty_masuk DECIMAL(14,3) NOT NULL DEFAULT 0,
        qty_keluar DECIMAL(14,3) NOT NULL DEFAULT 0,
        harga_satuan DECIMAL(16,2) NOT NULL DEFAULT 0,
        keterangan VARCHAR(255) NULL,
        created_by BIGINT UNSIGNED NULL,
        CONSTRAINT chk_mov_one_subject CHECK ((bahan_id IS NULL) <> (product_id IS NULL)),
        CONSTRAINT fk_mov_bahan FOREIGN KEY (bahan_id) REFERENCES bahan (id) ON DELETE RESTRICT,
        CONSTRAINT fk_mov_product FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE RESTRICT,
        CONSTRAINT fk_mov_user FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
        INDEX idx_mov_bahan_tanggal (bahan_id, tanggal),
        INDEX idx_mov_product_tanggal (product_id, tanggal),
        INDEX idx_mov_ref (ref_type, ref_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  } finally {
    await conn.end();
  }
}
