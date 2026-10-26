import { describe, expect, it } from 'vitest';
import { materialCreateSchema, materialUpdateSchema } from '../src/validators/materials.js';

describe('materialCreateSchema (F1-B bahan)', () => {
  it('menerima kain kg valid', () => {
    const out = materialCreateSchema.parse({ kode: 'KAIN-01', nama: 'Kain Katun', jenis: 'kain' });
    expect(out.kode).toBe('KAIN-01');
    expect(out.jenis).toBe('kain');
  });
  it('menerima karet, benang, stok_minimum', () => {
    expect(materialCreateSchema.parse({ kode: 'KRT-1', nama: 'Karet', jenis: 'karet' }).jenis).toBe('karet');
    expect(materialCreateSchema.parse({ kode: 'BNG-1', nama: 'Benang', jenis: 'benang' }).jenis).toBe('benang');
    const out = materialCreateSchema.parse({ kode: 'KAIN-2', nama: 'Kain', jenis: 'kain', stok_minimum: 5 });
    expect(out.stok_minimum).toBe(5);
  });
  it('menolak jenis di luar kain/karet/benang', () => {
    expect(() => materialCreateSchema.parse({ kode: 'X-1', nama: 'X', jenis: 'plastik' })).toThrow();
  });
  it('menolak satuan selain kg', () => {
    expect(() => materialCreateSchema.parse({ kode: 'X-1', nama: 'X', jenis: 'kain', satuan: 'meter' })).toThrow();
  });
  it('menolak kode kosong dan stok negatif', () => {
    expect(() => materialCreateSchema.parse({ kode: '', nama: 'X', jenis: 'kain' })).toThrow();
    expect(() => materialCreateSchema.parse({ kode: 'X-1', nama: 'X', jenis: 'kain', stok_minimum: -1 })).toThrow();
  });
  it('update menolak body kosong', () => {
    expect(() => materialUpdateSchema.parse({})).toThrow();
  });
});
