/**
 * Formes de données telles que servies par l'API aux surfaces terrain.
 * Volontairement souples (documents Mongo « lean ») : on ne dépend pas des
 * types Mongoose côté client.
 */

export interface Variant {
  key: string;
  name: string;
  price: number;
}

export interface OptionChoice {
  key: string;
  name: string;
  priceDelta: number;
}

export interface OptionGroup {
  key: string;
  name: string;
  type: 'single' | 'multi';
  min?: number;
  max?: number | null;
  choices: OptionChoice[];
  perVariant?: Record<string, { min?: number; max?: number; priceDelta?: number }> | null;
}

export interface MenuRemovable {
  key: string;
  label: string;
}

export interface MenuSupplement {
  key: string;
  label: string;
  priceCents: number;
  category?: string;
}

/** Groupe d'options réservé au serveur pour facturer les suppléments. */
export const SUPPLEMENT_GROUP = 'supplements';

export interface Product {
  _id: string;
  name: string;
  description?: string;
  price?: number;
  variants?: Variant[];
  optionGroups?: OptionGroup[];
  /**
   * Retraits proposés — dérivés de la RECETTE du produit côté serveur.
   * Un sandwich dont la fiche contient tomate propose « sans tomate », sans
   * que le gérant n'ait rien saisi. `key` part en commande, `label` s'affiche.
   */
  removables?: MenuRemovable[];
  /** Ingrédients ajoutables en supplément payant, prix résolu serveur. */
  supplements?: MenuSupplement[];
  tags?: string[];
  isNew?: boolean;
  outOfStock?: boolean;
  outOfStockSource?: 'manual' | 'ingredient' | null;
  active?: boolean;
}

export interface Category {
  _id: string;
  name: string;
  products: Product[];
}

export interface Menu {
  categories: Category[];
  uncategorized?: Product[];
}

export type OrderStatus = 'new' | 'preparing' | 'ready' | 'delivered' | 'cancelled';
export type OrderChannel = 'online' | 'pos' | 'phone';
export type OrderType = 'surplace' | 'emporter' | 'pickup';

export interface OrderLine {
  productId: string;
  name: string;
  variantKey?: string | null;
  variantName?: string | null;
  options: { groupKey: string; choiceKey: string; name: string; priceDelta: number }[];
  removed: string[];
  note?: string | null;
  qty: number;
  unitPrice: number;
  lineTotal: number;
}

export interface Order {
  _id: string;
  number: number;
  clientId: string;
  channel: OrderChannel;
  type: OrderType;
  lines: OrderLine[];
  totals: { subtotal: number; discount?: { amount: number; reason: string } | null; total: number };
  payment: { method: 'online' | 'counter'; status: 'pending' | 'paid' | 'refunded' };
  status: OrderStatus;
  statusHistory: { status: OrderStatus; at: string; by?: string }[];
  pickup?: { slot: string; customerName: string; customerPhone?: string | null } | null;
  note?: string | null;
  createdAt: string;
}

export interface TenantPublic {
  _id?: string;
  slug: string;
  name: string;
  logoUrl?: string | null;
  brandColor: string;
}

/**
 * Progression normale. `cancelled` en est exclu : ce n'est pas une étape plus
 * avancée que la livraison, c'est une sortie de route.
 */
export const STATUS_RANK: Record<OrderStatus, number> = {
  new: 0,
  preparing: 1,
  ready: 2,
  delivered: 3,
  cancelled: -1,
};

const TERMINAL: readonly OrderStatus[] = ['delivered', 'cancelled'];

export const isTerminalStatus = (status: OrderStatus): boolean => TERMINAL.includes(status);

/**
 * Réconciliation hors ligne : « le plus avancé gagne », à une exception près
 * qui compte en service — un état TERMINAL ne se laisse jamais écraser.
 *
 * Un rejeu d'annulation ne doit pas transformer en « annulée » une commande
 * déjà remise au client (le plat est parti, la caisse est faite), et une remise
 * rejouée ne ressuscite pas une commande annulée. Le premier terminal fait foi.
 */
export function mostAdvancedStatus(current: OrderStatus, incoming: OrderStatus): OrderStatus {
  if (current === incoming) return current;
  if (isTerminalStatus(current)) return current;
  if (isTerminalStatus(incoming)) return incoming;
  return STATUS_RANK[incoming] > STATUS_RANK[current] ? incoming : current;
}

export const NEXT_STATUS: Partial<Record<OrderStatus, OrderStatus>> = {
  new: 'preparing',
  preparing: 'ready',
  ready: 'delivered',
};
