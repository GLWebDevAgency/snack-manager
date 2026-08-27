import { z } from 'zod';

export * from './supply';
export * from './stats';
export * from './ordering';
export * from './screens';
export * from './devices';
export * from './crm';
export * from './production';
export * from './admin';
export * from './billing';
export * from './signals';
export * from './health';
export * from './planning';
export * from './platform';
export * from './ops';
export * from './tenant';
export * from './encaissement';

// ─────────────────────────────────────────────────────────────
// Énumérations métier
// ─────────────────────────────────────────────────────────────

export const ORDER_STATUSES = ['new', 'preparing', 'ready', 'delivered', 'cancelled'] as const;
export const OrderStatusSchema = z.enum(ORDER_STATUSES);
export type OrderStatus = z.infer<typeof OrderStatusSchema>;

/**
 * Progression normale d'une commande. `cancelled` n'y figure pas : ce n'est
 * pas une étape « plus avancée » que la livraison, c'est une sortie de route.
 */
export const ORDER_STATUS_RANK: Record<OrderStatus, number> = {
  new: 0,
  preparing: 1,
  ready: 2,
  delivered: 3,
  cancelled: -1,
};

/** États terminaux : une fois atteints, plus aucune transition n'est acceptée. */
export const TERMINAL_STATUSES: readonly OrderStatus[] = ['delivered', 'cancelled'];

export const isTerminalStatus = (status: OrderStatus): boolean =>
  TERMINAL_STATUSES.includes(status);

/**
 * Réconciliation hors ligne : deux appareils peuvent avoir fait avancer la même
 * commande sans se voir. La règle « le plus avancé gagne » a une exception qui
 * compte en service : un état TERMINAL ne se laisse jamais écraser.
 *
 * Concrètement, un rejeu d'annulation ne doit pas transformer en « annulée »
 * une commande déjà remise au client (le plat est parti, la caisse est faite),
 * et symétriquement une remise rejouée ne ressuscite pas une commande annulée.
 * Le premier état terminal atteint fait foi.
 */
export function mostAdvancedStatus(current: OrderStatus, incoming: OrderStatus): OrderStatus {
  if (current === incoming) return current;
  if (isTerminalStatus(current)) return current;
  if (isTerminalStatus(incoming)) return incoming;
  return ORDER_STATUS_RANK[incoming] > ORDER_STATUS_RANK[current] ? incoming : current;
}

export const ORDER_CHANNELS = ['online', 'pos', 'phone'] as const;
export const OrderChannelSchema = z.enum(ORDER_CHANNELS);
export type OrderChannel = z.infer<typeof OrderChannelSchema>;

export const ORDER_TYPES = ['surplace', 'emporter', 'pickup'] as const;
export const OrderTypeSchema = z.enum(ORDER_TYPES);
export type OrderType = z.infer<typeof OrderTypeSchema>;

export const PAYMENT_METHODS = ['online', 'counter'] as const;
export const PaymentMethodSchema = z.enum(PAYMENT_METHODS);
export type PaymentMethod = z.infer<typeof PaymentMethodSchema>;

export const PAYMENT_STATUSES = ['pending', 'paid', 'refunded'] as const;
export const PaymentStatusSchema = z.enum(PAYMENT_STATUSES);
export type PaymentStatus = z.infer<typeof PaymentStatusSchema>;

/**
 * Moyen de paiement RÉELLEMENT présenté, à distinguer de `method` :
 * `method` dit OÙ l'argent est encaissé (en ligne / au comptoir),
 * `tender` dit AVEC QUOI le client a payé. Sans cette distinction, une carte
 * bancaire passée à la caisse est indiscernable d'un « à encaisser au
 * retrait » — et la clôture de caisse (Z) devient fausse.
 *
 * `meal_voucher` : le titre-restaurant, papier ou carte (Edenred, Swile…),
 * encaissé sur le terminal TR que le restaurant possède déjà — la caisse ne
 * traite pas le titre, elle enregistre AVEC QUOI le déjeuner a été réglé.
 * Sans cette valeur, le midi d'un snack se ventilait en « carte » ou en
 * « à encaisser » : la télécollecte TR du soir ne se recoupait avec rien.
 *
 * `null` = pas encore encaissé (commande à régler à la remise).
 */
export const PAYMENT_TENDERS = ['cash', 'card', 'meal_voucher', 'online'] as const;
export const PaymentTenderSchema = z.enum(PAYMENT_TENDERS);
export type PaymentTender = z.infer<typeof PaymentTenderSchema>;

/**
 * Jeton de suivi public : chaîne aléatoire URL-safe accompagnant l'ObjectId
 * sur les routes `/public/orders/:id…`. Un ObjectId Mongo est partiellement
 * prévisible (horodatage + compteur machine) : il ne peut pas servir seul de
 * secret pour exposer le nom et le téléphone d'un client.
 *
 * 24 octets aléatoires → 32 caractères base64url, sans remplissage.
 */
export const TRACKING_TOKEN_BYTES = 24;
export const TRACKING_TOKEN_LENGTH = 32;

export const STAFF_ROLES = ['gerant', 'caisse', 'cuisine'] as const;
export const StaffRoleSchema = z.enum(STAFF_ROLES);
export type StaffRole = z.infer<typeof StaffRoleSchema>;

/**
 * CE QU'UN ÉQUIPIER PEUT ACCORDER DE REMISE, PAR RÔLE.
 *
 * `POST /orders/:id/discount` re-demandait le PIN — traçabilité NF525 — et
 * s'arrêtait là : n'importe quel PIN actif du restaurant faisait l'affaire,
 * cuisine comprise, et le seul plafond était le sous-total. Un équipier pouvait
 * donc offrir la commande entière, avec son propre code, sans qu'aucun écran ne
 * le signale au gérant.
 *
 * Re-saisir un code prouve QUI agit, jamais que cette personne en a le droit.
 * Les deux contrôles sont distincts et il manquait le second.
 *
 * `null` = pas de plafond : le gérant assume les gestes commerciaux, c'est son
 * métier. La cuisine ne touche pas aux montants — elle prépare. La caisse
 * arrange un client mécontent à hauteur d'un plat, au-delà elle appelle le
 * gérant, ce qui est exactement la conversation qu'on veut provoquer.
 */
export const REMISE_PLAFOND_CENTS: Record<StaffRole, number | null> = {
  gerant: null,
  caisse: 1_500,
  cuisine: 0,
};

/** Le plafond en toutes lettres — pour l'écran qui demande le PIN. */
export const plafondRemiseLabel = (role: StaffRole): string => {
  const cents = REMISE_PLAFOND_CENTS[role];
  if (cents === null) return 'sans plafond';
  if (cents === 0) return 'aucune remise autorisée';
  return `${(cents / 100).toFixed(2).replace('.', ',')} € maximum`;
};

export const USER_ROLES = ['owner', 'sm_admin'] as const;
export const UserRoleSchema = z.enum(USER_ROLES);
export type UserRole = z.infer<typeof UserRoleSchema>;

export const PLANS = ['essentiel', 'complet', 'boost'] as const;
export const PlanSchema = z.enum(PLANS);
export type Plan = z.infer<typeof PlanSchema>;

// ─────────────────────────────────────────────────────────────
// Menu — prix TOUJOURS en centimes (int)
// ─────────────────────────────────────────────────────────────

export const VariantSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  price: z.number().int().nonnegative(),
});
export type Variant = z.infer<typeof VariantSchema>;

export const OptionChoiceSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  priceDelta: z.number().int().default(0),
});
export type OptionChoice = z.infer<typeof OptionChoiceSchema>;

/** Règle spécifique à une variante (ex. nb de viandes lié à la taille du tacos). */
export const PerVariantRuleSchema = z.object({
  min: z.number().int().nonnegative().optional(),
  max: z.number().int().nonnegative().optional(),
  priceDelta: z.number().int().optional(),
});
export type PerVariantRule = z.infer<typeof PerVariantRuleSchema>;

export const OptionGroupSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  type: z.enum(['single', 'multi']),
  min: z.number().int().nonnegative().default(0),
  max: z.number().int().positive().optional(),
  choices: z.array(OptionChoiceSchema).min(1),
  perVariant: z.record(z.string(), PerVariantRuleSchema).optional(),
});
export type OptionGroup = z.infer<typeof OptionGroupSchema>;

export const ProductCreateSchema = z.object({
  categoryId: z.string().min(1),
  name: z.string().min(1),
  description: z.string().default(''),
  price: z.number().int().nonnegative().default(0),
  variants: z.array(VariantSchema).default([]),
  optionGroups: z.array(OptionGroupSchema).default([]),
  removables: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  isNew: z.boolean().default(false),
  photoUrl: z.string().optional(),
  order: z.number().int().default(0),
  active: z.boolean().default(true),
});
export type ProductCreate = z.infer<typeof ProductCreateSchema>;

/**
 * Mise à jour PARTIELLE — surtout pas `ProductCreateSchema.partial()`.
 *
 * `.partial()` rend les champs facultatifs mais CONSERVE leurs `.default()` :
 * un `PATCH { tags: ['midi'] }` ressortait de la validation avec
 * `price: 0, variants: [], optionGroups: []…` et écrasait silencieusement le
 * produit. Un gérant qui renommait un plat perdait son prix et ses options.
 * Bug réel, constaté en production sur trois produits.
 *
 * Ici, aucun champ ne porte de valeur par défaut : ce qui n'est pas transmis
 * n'est pas modifié.
 */
export const ProductUpdateSchema = z.object({
  categoryId: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  price: z.number().int().nonnegative().optional(),
  variants: z.array(VariantSchema).optional(),
  optionGroups: z.array(OptionGroupSchema).optional(),
  removables: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  isNew: z.boolean().optional(),
  photoUrl: z.string().optional(),
  order: z.number().int().optional(),
  active: z.boolean().optional(),
});
export type ProductUpdate = z.infer<typeof ProductUpdateSchema>;

export const CategoryCreateSchema = z.object({
  name: z.string().min(1),
  order: z.number().int().default(0),
  active: z.boolean().default(true),
});
export type CategoryCreate = z.infer<typeof CategoryCreateSchema>;

/** Même piège que pour les produits : pas de `.partial()`, pas de défauts. */
export const CategoryUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  order: z.number().int().optional(),
  active: z.boolean().optional(),
});

/** Drag & drop : liste complète des ids de catégories dans le nouvel ordre. */
export const ReorderSchema = z.object({ ids: z.array(z.string()).min(1) });

// ─────────────────────────────────────────────────────────────
// Commandes — le client n'envoie JAMAIS de prix : l'API résout
// noms et montants depuis le menu au moment de la création.
// ─────────────────────────────────────────────────────────────

export const OrderLineInputSchema = z.object({
  productId: z.string().min(1),
  variantKey: z.string().optional(),
  options: z
    .array(z.object({ groupKey: z.string(), choiceKey: z.string() }))
    .default([]),
  removed: z.array(z.string()).default([]),
  note: z.string().max(200).optional(),
  qty: z.number().int().positive().default(1),
});
export type OrderLineInput = z.infer<typeof OrderLineInputSchema>;

/**
 * Paiement transmis à la création.
 *
 * `changeGiven` est accepté — la file offline du POS rejoue le corps qu'elle a
 * persisté — mais TOUJOURS recalculé côté serveur à partir de `cashReceived`
 * et du total résolu depuis le menu : aucun montant venu du client ne fait foi.
 */
export const CreateOrderPaymentSchema = z.object({
  method: PaymentMethodSchema,
  /** Moyen réellement présenté. Absent/`null` = pas encore encaissé. */
  tender: PaymentTenderSchema.nullish(),
  /** Espèces posées sur le comptoir, en centimes. */
  cashReceived: z.number().int().nonnegative().optional(),
  /** Indicatif : le serveur recalcule le rendu monnaie. */
  changeGiven: z.number().int().nonnegative().optional(),
});
export type CreateOrderPayment = z.infer<typeof CreateOrderPaymentSchema>;

export const CreateOrderSchema = z.object({
  /** Clé d'idempotence générée par l'appareil — le rejeu offline ne crée jamais de doublon. */
  clientId: z.uuid(),
  channel: OrderChannelSchema,
  type: OrderTypeSchema,
  lines: z.array(OrderLineInputSchema).min(1),
  payment: CreateOrderPaymentSchema,
  pickup: z
    .object({
      slot: z.iso.datetime(),
      customerName: z.string().min(1),
      customerPhone: z.string().optional(),
    })
    .optional(),
  note: z.string().max(500).optional(),
  /**
   * Le code promo saisi par le client, ou absent.
   *
   * Il manquait au corps de commande, et c'est la moitié du défaut : le
   * back-office savait créer un code, l'activer et l'imprimer sur des flyers —
   * aucune surface ne savait le RECEVOIR. Le restaurateur ne l'apprenait pas
   * d'une erreur, il l'apprenait d'un client au téléphone.
   *
   * Le montant, lui, n'est jamais transmis : comme les prix, il est résolu par
   * le serveur contre la promotion en base. Un client qui enverrait sa propre
   * remise n'obtient rien.
   */
  promoCode: z.string().trim().min(1).max(24).optional(),
});
export type CreateOrder = z.infer<typeof CreateOrderSchema>;

/**
 * Les deux gestes qui MINORENT la recette — et qui n'étaient pas validés.
 *
 * Le corps arrivait en `@Body()` nu, sans schéma : `amount` pouvait être un
 * flottant, une chaîne, ou manquer ; `reason` était facultative alors que
 * NF525 exige qu'une minoration de recette soit motivée. Le domaine réclamait
 * bien un motif — le service ne passait simplement pas par lui.
 */
export const OrderCancelSchema = z.object({
  pin: z.string().regex(/^\d{4,6}$/, 'Code à 4 à 6 chiffres'),
  reason: z.string().trim().min(3, 'Motif obligatoire').max(200),
});
export type OrderCancel = z.infer<typeof OrderCancelSchema>;

export const OrderDiscountSchema = z.object({
  pin: z.string().regex(/^\d{4,6}$/, 'Code à 4 à 6 chiffres'),
  /** En CENTIMES, entier et positif — jamais des euros, jamais un flottant. */
  amount: z.number().int().positive('Montant de remise invalide'),
  reason: z.string().trim().min(3, 'Motif obligatoire').max(200),
});
export type OrderDiscount = z.infer<typeof OrderDiscountSchema>;

export const UpdateOrderStatusSchema = z.object({ status: OrderStatusSchema });

// ─────────────────────────────────────────────────────────────
// Auth
// ─────────────────────────────────────────────────────────────

export const LoginSchema = z.object({
  email: z.email(),
  password: z.string().min(8),
});
export type Login = z.infer<typeof LoginSchema>;

export const PinLoginSchema = z.object({
  tenantSlug: z.string().min(1),
  pin: z.string().regex(/^\d{4,6}$/),
});
export type PinLogin = z.infer<typeof PinLoginSchema>;

export interface JwtPayload {
  sub: string;
  tenantId: string | null;
  role: UserRole | StaffRole;
  kind: 'user' | 'staff';
}

// ─────────────────────────────────────────────────────────────
// Temps réel (WebSocket) — rooms par tenantId
// ─────────────────────────────────────────────────────────────

export const WS_EVENTS = {
  orderCreated: 'order.created',
  orderUpdated: 'order.updated',
  menuUpdated: 'menu.updated',
} as const;
export type WsEvent = (typeof WS_EVENTS)[keyof typeof WS_EVENTS];

/** Canal Redis pub/sub par tenant. */
export const ordersChannel = (tenantId: string) => `tenant:${tenantId}:orders`;
