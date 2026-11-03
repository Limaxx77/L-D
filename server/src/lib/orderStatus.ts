import type { OrderStatus, OrderType, RoleKey } from '@prisma/client';

export const FLOWS: Record<OrderType, OrderStatus[]> = {
  DELIVERY: ['AWAITING_ACCEPT', 'ACCEPTED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY', 'DELIVERED'],
  PICKUP: ['AWAITING_ACCEPT', 'ACCEPTED', 'PREPARING', 'READY', 'PICKED_UP'],
  TABLE: ['AWAITING_ACCEPT', 'ACCEPTED', 'PREPARING', 'READY', 'SERVED'],
};

export const FINAL_STATUSES: OrderStatus[] = ['DELIVERED', 'PICKED_UP', 'SERVED', 'CANCELED'];

export function statusLabel(type: OrderType, status: OrderStatus): string {
  switch (status) {
    case 'AWAITING_ACCEPT':
      return 'Aguardando aceite';
    case 'ACCEPTED':
      return 'Aceito';
    case 'PREPARING':
      return 'Em preparação';
    case 'READY':
      return type === 'PICKUP' ? 'Pronto para retirada' : 'Pronto';
    case 'OUT_FOR_DELIVERY':
      return 'Saiu para entrega';
    case 'DELIVERED':
      return 'Entregue';
    case 'PICKED_UP':
      return 'Retirado';
    case 'SERVED':
      return 'Entregue na mesa';
    case 'CANCELED':
      return 'Cancelado';
  }
}

export function nextStatus(type: OrderType, status: OrderStatus): OrderStatus | null {
  const flow = FLOWS[type];
  const i = flow.indexOf(status);
  return i >= 0 && i < flow.length - 1 ? flow[i + 1] : null;
}

/**
 * Verifica se um papel pode mover o pedido de `from` para `to` pelo fluxo normal.
 * Aceite e cancelamento têm rotas próprias (exigem prazo/motivo).
 */
export function canAdvance(role: RoleKey, type: OrderType, from: OrderStatus, to: OrderStatus): boolean {
  const flow = FLOWS[type];
  const i = flow.indexOf(from);
  const j = flow.indexOf(to);
  if (i < 1 || j <= i) return false; // AWAITING_ACCEPT só sai via aceite
  if (role === 'ADMIN' || role === 'ATTENDANT') return true;
  if (role === 'KITCHEN') return j === i + 1 && (to === 'PREPARING' || to === 'READY');
  if (role === 'COURIER') return type === 'DELIVERY' && j === i + 1 && (to === 'OUT_FOR_DELIVERY' || to === 'DELIVERED');
  return false;
}

/** Evento de notificação ao cliente correspondente a cada status. */
export function notificationEvent(status: OrderStatus): string | null {
  const map: Partial<Record<OrderStatus, string>> = {
    AWAITING_ACCEPT: 'ORDER_RECEIVED',
    ACCEPTED: 'ORDER_ACCEPTED',
    PREPARING: 'ORDER_PREPARING',
    READY: 'ORDER_READY',
    OUT_FOR_DELIVERY: 'ORDER_OUT_FOR_DELIVERY',
    DELIVERED: 'ORDER_DELIVERED',
    PICKED_UP: 'ORDER_DELIVERED',
    CANCELED: 'ORDER_CANCELED',
  };
  return map[status] ?? null;
}
