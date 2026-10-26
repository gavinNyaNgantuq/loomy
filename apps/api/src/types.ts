export const ROLES = ['admin', 'gudang', 'produksi', 'kasir', 'keuangan'] as const;
export type Role = (typeof ROLES)[number];

export interface SafeUser {
  id: number;
  name: string;
  email: string;
  role: Role;
}

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}
