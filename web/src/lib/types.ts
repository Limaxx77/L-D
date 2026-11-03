export type ProductKind = 'PASTEL' | 'DRINK' | 'OTHER';

export interface ProductOption {
  id: string;
  label: string;
  brand: string | null;
  flavor: string | null;
  size: string | null;
  priceCents: number | null;
  available: boolean;
}

export interface Product {
  id: string;
  kind: ProductKind;
  categoryId: string;
  name: string;
  description: string;
  priceCents: number;
  promoPriceCents: number | null;
  available: boolean;
  stockQty: number | null;
  imageUrl: string | null;
  options: ProductOption[];
}

export interface Combo {
  id: string;
  name: string;
  description: string;
  priceCents: number;
  pastelQty: number;
  drinkQty: number;
  featured: boolean;
  available: boolean;
  dailyLimit: number | null;
  remainingToday: number | null;
  imageUrl: string | null;
  regularCents: number;
  savingsCents: number;
}

export interface Menu {
  categories: { id: string; name: string; slug: string }[];
  products: Product[];
  combos: Combo[];
}

export interface Selection {
  productId: string;
  optionId?: string | null;
  quantity: number;
}

export type CartLineInput =
  | { type: 'product'; productId: string; optionId?: string | null; quantity: number; notes?: string | null }
  | { type: 'combo'; comboId: string; quantity: number; pastels: Selection[]; drinks: Selection[]; notes?: string | null };

export interface CartLine {
  key: string;
  input: CartLineInput;
  name: string;
  description?: string;
  unitPriceCents: number; // apenas exibição; o servidor recalcula
  imageUrl?: string | null;
}

export interface HourRange {
  weekday: number;
  opensAt: string;
  closesAt: string;
}

export interface StoreInfo {
  store: {
    name: string;
    tagline: string;
    whatsapp: string;
    address: string;
    instagram: string;
    facebook: string;
    logoUrl: string | null;
    bannerUrl: string | null;
    timezone: string;
  };
  delivery: {
    enabled: boolean;
    pickupEnabled: boolean;
    minOrderCents: number | null;
    freeDeliveryAboveCents: number | null;
    allowOutsideArea: boolean;
    outsideAreaFeeCents: number | null;
    defaultPrepMinutes: number;
    areas: { id: string; neighborhood: string; feeCents: number; minOrderCents: number | null }[];
  };
  payment: {
    methods: Record<string, boolean>;
    pixKey: string;
    pixKeyType: string;
    pixHolderName: string;
    pixInstructions: string;
  };
  hours: HourRange[];
  open: { open: boolean; reason: 'OPEN' | 'CLOSED' | 'PAUSED'; pausedUntil?: string | null };
  acceptOutsideHours: boolean;
  acceptScheduled: boolean;
  closedMessage: string;
}

export interface Quote {
  lines: { name: string; description: string | null; quantity: number; unitPriceCents: number; unitRegularCents: number; totalCents: number; savingsCents: number }[];
  grossCents: number;
  savingsCents: number;
  itemsTotalCents: number;
  discountCents: number;
  couponError: string | null;
  deliveryFeeCents: number;
  deliveryError: string | null;
  totalCents: number;
}

export type OrderStatus =
  | 'AWAITING_ACCEPT'
  | 'ACCEPTED'
  | 'PREPARING'
  | 'READY'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'PICKED_UP'
  | 'SERVED'
  | 'CANCELED';

export interface PublicOrder {
  number: number;
  publicToken: string;
  type: 'DELIVERY' | 'PICKUP' | 'TABLE';
  status: OrderStatus;
  statusLabel: string;
  customerName: string;
  items: { id: string; name: string; description: string | null; quantity: number; unitPriceCents: number; totalCents: number; notes: string | null; canceled: boolean }[];
  grossCents: number;
  comboSavingsCents: number;
  itemsTotalCents: number;
  discountCents: number;
  couponCode: string | null;
  deliveryFeeCents: number;
  totalCents: number;
  paymentMethod: string;
  paymentStatus: string;
  changeForCents: number | null;
  estimatedMinutes: number | null;
  acceptedAt: string | null;
  scheduledFor: string | null;
  cancelReason: string | null;
  createdAt: string;
  address: { street: string; number: string; neighborhood: string; complement: string | null } | null;
  history: { status: OrderStatus; label: string; at: string }[];
}
