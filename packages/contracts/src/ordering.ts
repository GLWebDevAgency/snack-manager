import { z } from 'zod';
// ⚠️ `import type` uniquement : `index.ts` réexporte ce fichier, un import de
// valeurs créerait un cycle CommonJS (constantes non initialisées au chargement).
import type {
  OrderChannel,
  OrderStatus,
  OrderType,
  PaymentMethod,
  PaymentStatus,
  PaymentTender,
} from './index';

// ─────────────────────────────────────────────────────────────
// Commande en ligne — créneaux de retrait, paiement, impression
// Rappel : tous les montants sont en CENTIMES (int).
// ─────────────────────────────────────────────────────────────

/** Fuseau de référence des restaurants (heures murales des `hours`). */
export const RESTAURANT_TZ = 'Europe/Paris';

/** Délai de préparation minimum, en minutes, avant le premier créneau proposé. */
export const SLOT_LEAD_TIME_MIN = 20;

/** Nombre de jours explorés pour trouver la prochaine date d'ouverture. */
export const NEXT_OPEN_LOOKAHEAD_DAYS = 14;

// ─── Créneaux ───

/** `?date=AAAA-MM-JJ` — absent ⇒ aujourd'hui (heure du restaurant). */
export const SlotsQuerySchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date attendue au format AAAA-MM-JJ')
    .optional(),
});
export type SlotsQuery = z.infer<typeof SlotsQuerySchema>;

export const SLOT_SERVICES = ['lunch', 'dinner'] as const;
export const SlotServiceSchema = z.enum(SLOT_SERVICES);
export type SlotService = z.infer<typeof SlotServiceSchema>;

export const SLOT_SERVICE_LABELS: Record<SlotService, string> = {
  lunch: 'Midi',
  dinner: 'Soir',
};

/** Affluence d'un créneau (pastille de la maquette : vert / accent / complet). */
export const SLOT_LOADS = ['calm', 'busy', 'full'] as const;
export const SlotLoadSchema = z.enum(SLOT_LOADS);
export type SlotLoad = z.infer<typeof SlotLoadSchema>;

export const SLOT_LOAD_LABELS: Record<SlotLoad, string> = {
  calm: 'Tranquille',
  busy: 'Créneau chargé',
  full: 'Complet',
};

export const PickupSlotSchema = z.object({
  /** Instant absolu (ISO 8601 UTC) — à renvoyer tel quel dans `pickup.slot`. */
  iso: z.string(),
  /** Heure murale du restaurant, « 19:30 ». */
  label: z.string(),
  service: SlotServiceSchema,
  /** Places restantes sur le créneau (jamais négatif). */
  remaining: z.number().int().nonnegative(),
  full: z.boolean(),
  load: SlotLoadSchema,
});
export type PickupSlot = z.infer<typeof PickupSlotSchema>;

export const SlotsResponseSchema = z.object({
  /** Date demandée, AAAA-MM-JJ (heure du restaurant). */
  date: z.string(),
  timezone: z.string(),
  intervalMin: z.number().int().positive(),
  capacity: z.number().int().positive(),
  leadTimeMin: z.number().int().nonnegative(),
  slots: z.array(PickupSlotSchema),
  /** `true` dès qu'aucun créneau n'est proposable pour la date demandée. */
  closedToday: z.boolean(),
  /** Prochaine date d'ouverture (AAAA-MM-JJ) — renseignée si `closedToday`. */
  nextOpenDate: z.string().nullable(),
  /** Motif de la fermeture exceptionnelle, si c'est elle qui ferme la journée. */
  closureReason: z.string().nullable(),
  /** Commande en ligne suspendue par le gérant (le menu reste consultable). */
  paused: z.boolean(),
});
export type SlotsResponse = z.infer<typeof SlotsResponseSchema>;

// ─── Paiement en ligne (Stripe, optionnel) ───

/** Montant minimum accepté par Stripe en EUR (centimes). */
export const STRIPE_MIN_AMOUNT_CENTS = 50;

export const PaymentIntentReadySchema = z.object({
  clientSecret: z.string(),
  /** `null` si `STRIPE_PUBLISHABLE_KEY` n'est pas configurée côté serveur. */
  publishableKey: z.string().nullable(),
  paymentIntentId: z.string(),
  /**
   * LE COMPTE DU RESTAURANT — et sans lui, rien ne marche.
   *
   * En charges directes, l'intention de paiement naît sur le compte du
   * restaurant : elle n'existe PAS sur celui de la plateforme. Un navigateur
   * qui initialiserait Stripe.js sans ce compte présenterait un
   * `client_secret` que Stripe refuserait — le client verrait son paiement
   * échouer au dernier clic, sans explication.
   *
   * Il voyage donc jusqu'au front, qui le passe à `loadStripe`. Ce n'est pas
   * un secret : un identifiant `acct_…` est public par construction.
   */
  stripeAccount: z.string(),
  amount: z.number().int(), // centimes
  currency: z.literal('eur'),
  unavailable: z.literal(false),
});
export type PaymentIntentReady = z.infer<typeof PaymentIntentReadySchema>;

/**
 * Stripe absent / non configuré : la commande reste valide, le client paie au
 * comptoir. Ce n'est jamais une erreur HTTP — l'app ne doit pas se bloquer.
 */
export const PaymentIntentUnavailableSchema = z.object({
  unavailable: z.literal(true),
  reason: z.string(),
});
export type PaymentIntentUnavailable = z.infer<typeof PaymentIntentUnavailableSchema>;

export const PaymentIntentResponseSchema = z.union([
  PaymentIntentReadySchema,
  PaymentIntentUnavailableSchema,
]);
export type PaymentIntentResponse = z.infer<typeof PaymentIntentResponseSchema>;

export const PAYMENT_UNAVAILABLE_REASON = 'Paiement en ligne non configuré';

// ─── Ticket imprimable ───

/** Largeurs usuelles : 32 = papier 58 mm, 42/48 = papier 80 mm. */
export const TicketQuerySchema = z.object({
  width: z.coerce.number().int().min(24).max(64).optional(),
  /** `none` pour enchaîner plusieurs tickets sur un même flux. */
  cut: z.enum(['partial', 'full', 'none']).optional(),
  /** `kitchen` = bon cuisine (pas de prix) · `customer` = ticket client complet. */
  variant: z.enum(['customer', 'kitchen']).optional(),
});
export type TicketQuery = z.infer<typeof TicketQuerySchema>;

// ─── Accès public à une commande : `?t=<trackingToken>` ───

/**
 * Jeton de suivi porté par l'URL. Typé `string` explicitement : Express
 * interprète `?t[$ne]=x` comme un objet, qui deviendrait un opérateur Mongo
 * si on le passait tel quel au filtre.
 */
export const TrackingTokenQuerySchema = z.object({
  t: z.string().min(1).max(128).optional(),
});
export type TrackingTokenQuery = z.infer<typeof TrackingTokenQuerySchema>;

/** Options de rendu du ticket + jeton de suivi (routes `/ticket` et `/escpos`). */
export const TicketRequestQuerySchema = TicketQuerySchema.extend(
  TrackingTokenQuerySchema.shape,
);
export type TicketRequestQuery = z.infer<typeof TicketRequestQuerySchema>;

export const ORDER_TYPE_LABELS: Record<OrderType, string> = {
  surplace: 'Sur place',
  emporter: 'À emporter',
  pickup: 'Retrait',
};

export const ORDER_CHANNEL_LABELS: Record<OrderChannel, string> = {
  online: 'En ligne',
  pos: 'Caisse',
  phone: 'Téléphone',
};

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  online: 'Payé en ligne',
  counter: 'À régler au comptoir',
};

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  pending: 'En attente',
  paid: 'Réglé',
  refunded: 'Remboursé',
};

/** Libellés du moyen réellement encaissé — ceux du Z de fin de service. */
export const PAYMENT_TENDER_LABELS: Record<PaymentTender, string> = {
  cash: 'Espèces',
  card: 'Carte bancaire',
  meal_voucher: 'Titre-restaurant',
  online: 'En ligne',
};

/** Ligne « à encaisser » du Z : une commande partie sans tender. */
export const PAYMENT_DUE_LABEL = 'À encaisser au retrait';

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  new: 'Reçue',
  preparing: 'En préparation',
  ready: 'Prête',
  delivered: 'Remise',
  cancelled: 'Annulée',
};

export interface TicketOption {
  name: string;
  /** Centimes, déjà inclus dans `unitPrice`. */
  priceDelta: number;
}

export interface TicketLine {
  qty: number;
  name: string;
  variantName: string | null;
  options: TicketOption[];
  /** Modificateurs « sans X ». */
  removed: string[];
  note: string | null;
  unitPrice: number; // centimes
  lineTotal: number; // centimes
}

export interface TicketHeader {
  tenantName: string;
  slug: string;
  address: string;
  phones: string[];
}

export interface TicketPickup {
  slotIso: string;
  /** Heure murale du restaurant, « 19:30 ». */
  slotLabel: string;
  customerName: string;
  customerPhone: string | null;
}

export interface TicketTotals {
  subtotal: number; // centimes
  discount: { amount: number; reason: string } | null;
  total: number; // centimes
}

export interface TicketPayment {
  method: PaymentMethod;
  methodLabel: string;
  /** Moyen réellement encaissé — `null` tant que rien n'a été perçu. */
  tender: PaymentTender | null;
  tenderLabel: string | null;
  status: PaymentStatus;
  statusLabel: string;
  paid: boolean;
  /** Espèces reçues et rendu monnaie, en centimes (`null` hors paiement espèces). */
  cashReceived: number | null;
  changeGiven: number | null;
}

/** Représentation imprimable d'une commande (source du rendu ESC/POS). */
export interface OrderTicket {
  orderId: string;
  /** Numéro de retrait — séquence journalière, celui crié au comptoir. */
  pickupNumber: number;
  header: TicketHeader;
  createdAt: string;
  printedAt: string;
  channel: OrderChannel;
  channelLabel: string;
  type: OrderType;
  typeLabel: string;
  status: OrderStatus;
  statusLabel: string;
  pickup: TicketPickup | null;
  lines: TicketLine[];
  totals: TicketTotals;
  payment: TicketPayment;
  /** Instructions cuisine saisies par le client. */
  note: string | null;
}

// ─── Suivi public (page `/t/[id]?t=…`) ───

export interface OrderTrackingStep {
  status: OrderStatus;
  /** ISO 8601. */
  at: string;
}

/**
 * Projection MINIMALE renvoyée par `GET /public/orders/:id?t=<trackingToken>`.
 *
 * Volontairement sans nom ni téléphone : le client qui suit sa commande n'a
 * besoin que de son numéro de retrait et de l'avancement en cuisine. Le détail
 * nominatif reste sur `/ticket`, derrière le même jeton.
 */
export interface OrderTracking {
  _id: string;
  /** Numéro de retrait crié au comptoir. */
  number: number;
  status: OrderStatus;
  statusHistory: OrderTrackingStep[];
  /** ISO 8601 du créneau de retrait, `null` en vente directe. */
  pickupSlot: string | null;
}

// ─── Page publique du restaurant (un seul appel) ───

export interface PublicSiteVariant {
  key: string;
  name: string;
  price: number; // centimes
}

export interface PublicSiteProduct {
  _id: string;
  name: string;
  description: string;
  price: number; // centimes — ignoré si `variants` non vide
  variants: PublicSiteVariant[];
  /** Groupes d'options bruts (mêmes objets que `GET /public/tenants/:slug/menu`). */
  optionGroups: unknown[];
  removables: string[];
  tags: string[];
  isNew: boolean;
  outOfStock: boolean;
  photoUrl: string | null;
}

export interface PublicSiteCategory {
  _id: string;
  name: string;
  products: PublicSiteProduct[];
}

export interface PublicSiteReview {
  _id: string;
  author: string;
  rating: number;
  text: string;
  createdAt: string | null;
  reply: { text: string; at: string | null } | null;
}

export interface PublicSiteHours {
  day: number; // ISO : 1 = lundi … 7 = dimanche
  lunch: { open: string; close: string } | null;
  dinner: { open: string; close: string } | null;
}

export interface PublicSiteTenant {
  slug: string;
  name: string;
  logoUrl: string | null;
  brandColor: string;
  address: string;
  phones: string[];
  hours: PublicSiteHours[];
}

export interface PublicSiteResponse {
  tenant: PublicSiteTenant;
  menu: { categories: PublicSiteCategory[] };
  /** Créneaux du jour (même calcul que `GET /public/tenants/:slug/slots`). */
  slots: SlotsResponse;
  reviews: {
    /** Note moyenne sur 5, une décimale (0 si aucun avis). */
    avg: number;
    count: number;
    latest: PublicSiteReview[];
  };
  ordering: {
    paused: boolean;
    /** Message de pause affiché au client (null si la commande est ouverte). */
    message: string | null;
  };
  /** Le restaurant sert-il à cet instant précis. */
  openNow: boolean;
  /** Horaires du jour demandé, `null` si le restaurant ne sert pas ce jour-là. */
  todayHours: PublicSiteHours | null;
  timezone: string;
}

// ─────────────────────────────────────────────────────────────
// Journal NF525 — les gestes sensibles, lisibles
// ─────────────────────────────────────────────────────────────

/**
 * Les actions du journal d'audit (collection `auditlogs`). Écrit depuis le
 * premier jour, LISIBLE nulle part jusqu'au 24/08/2026 : un journal de
 * traçabilité qu'aucun écran ne sait montrer ne protège personne au contrôle
 * (diagnostic quatre casquettes, P3). `price.change` entre au journal le même
 * jour — l'en-tête du module l'annonçait sans que personne ne l'écrive.
 */
export const AUDIT_ACTION_LABELS: Record<string, string> = {
  'order.cancel': 'Annulation de commande',
  'order.discount': 'Remise',
  'order.refund': 'Remboursement',
  'price.change': 'Changement de prix',
};

/** Une ligne du journal telle que l'écran du gérant la lit. */
export type AuditEntryView = {
  _id: string;
  at: string;
  action: string;
  /** Rédigé — jamais un code machine devant un gérant. */
  actionLabel: string;
  /** L'équipier dont le PIN a validé le geste — '' pour un geste sans PIN. */
  staffName: string;
  meta: Record<string, unknown>;
};
