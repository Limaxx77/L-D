import type { RoleKey } from '@prisma/client';

/** Permissões verificadas no backend (a interface apenas reflete estas regras). */
export const PERMISSIONS = {
  'dashboard.view': ['ADMIN', 'ATTENDANT'],
  'orders.view': ['ADMIN', 'ATTENDANT', 'KITCHEN'],
  'orders.manage': ['ADMIN', 'ATTENDANT'],
  'orders.advance': ['ADMIN', 'ATTENDANT', 'KITCHEN', 'COURIER'],
  'deliveries.own': ['COURIER'],
  'tables.manage': ['ADMIN', 'ATTENDANT'],
  'tables.configure': ['ADMIN'],
  'tables.forceClose': ['ADMIN'],
  'payments.manage': ['ADMIN', 'ATTENDANT'],
  'catalog.manage': ['ADMIN'],
  'customers.view': ['ADMIN', 'ATTENDANT'],
  'finance.view': ['ADMIN'],
  'settings.manage': ['ADMIN'],
  'integrations.manage': ['ADMIN'],
  'users.manage': ['ADMIN'],
  'audit.view': ['ADMIN'],
} as const satisfies Record<string, readonly RoleKey[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: RoleKey, perm: Permission): boolean {
  return (PERMISSIONS[perm] as readonly RoleKey[]).includes(role);
}

export function permissionsFor(role: RoleKey): Permission[] {
  return (Object.keys(PERMISSIONS) as Permission[]).filter((p) => can(role, p));
}

export const ROLE_INFO: Record<RoleKey, { name: string; description: string }> = {
  ADMIN: { name: 'Administrador', description: 'Acesso completo ao sistema.' },
  ATTENDANT: { name: 'Atendente', description: 'Gerencia mesas, pedidos e pagamentos autorizados.' },
  KITCHEN: { name: 'Cozinha', description: 'Visualiza pedidos e altera status de preparação.' },
  COURIER: { name: 'Entregador', description: 'Visualiza somente as entregas atribuídas e atualiza seu status.' },
};
