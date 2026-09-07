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
// ⚠️ `import type` uniquement, même raison : `marque.ts` est réexporté par `index.ts`.
import type { Brand } from './marque';
// ⚠️ `import type` uniquement, même raison : `mediatheque.ts` l'est aussi.
import type { MediaVue } from './mediatheque';
import type { MenuRemovable, MenuSupplement } from './supply';
import { FulfillmentSchema } from './delivery';
import type { OrderDelivery, PublicDeliverySettings } from './delivery';

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
  fulfillment: FulfillmentSchema.optional(),
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
  /**
   * Ce refus vaut-il pour TOUJOURS, ou seulement pour maintenant ?
   *
   * Le tunnel les confondait et éteignait le paiement par carte pour toute la
   * visite dès le premier refus. Or les causes n'ont rien de commun : un
   * restaurant sans compte Stripe ne pourra jamais encaisser en ligne
   * (permanent), tandis qu'un 500 de Stripe, une coupure réseau ou un panier
   * sous cinquante centimes se réessaient — le dernier change même dès que le
   * client ajoute un article.
   *
   * Absent, vaut « passager » : devant un refus qu'on ne sait pas qualifier,
   * réessayer coûte moins cher que priver le restaurant d'un paiement.
   */
  permanent: z.boolean().optional(),
});
export type PaymentIntentUnavailable = z.infer<typeof PaymentIntentUnavailableSchema>;

export const PaymentIntentResponseSchema = z.union([
  PaymentIntentReadySchema,
  PaymentIntentUnavailableSchema,
]);
export type PaymentIntentResponse = z.infer<typeof PaymentIntentResponseSchema>;

export const PAYMENT_UNAVAILABLE_REASON = 'Paiement en ligne non configuré';

/** A confirmed change of collection method, NEVER a payment receipt. */
export const CounterPaymentResponseSchema = z.object({
  _id: z.string(),
  payment: z.object({ method: z.literal('counter'), status: z.literal('pending') }),
});
export type CounterPaymentResponse = z.infer<typeof CounterPaymentResponseSchema>;

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
  delivery: 'Livraison',
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
  deliveryFee?: number;
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
  delivery?: OrderDelivery | null;
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
  fulfillment?: 'pickup' | 'delivery';
  delivery?: { dispatchedAt: string | null; deliveredAt: string | null; estimatedMinutes: number } | null;
  payment?: { status: PaymentStatus; method: PaymentMethod; refundedCents: number; pendingRefundCents: number };
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
  /** Objets dérivés de la recette ; chaînes acceptées pour les anciennes réponses en cache. */
  removables: MenuRemovable[] | string[];
  /** Même catalogue tarifé que la caisse, exposé hors du groupe réservé. */
  supplements?: MenuSupplement[];
  tags: string[];
  isNew: boolean;
  outOfStock: boolean;
  /**
   * DÉRIVÉ de `medias[0]`, jamais la colonne lue — voir `photoUrlDe`. Repli sur
   * la chaîne héritée des dix-neuf photos du pilote tant qu'elles n'ont pas été
   * reprises. Prêt à peindre : l'usage « carte » est déjà résolu ici.
   */
  photoUrl: string | null;
  /**
   * Les identifiants des médias du produit, dans l'ordre — le premier est la
   * photo principale. Le détail vit UNE FOIS dans `PublicSiteResponse.medias`,
   * jamais recopié par produit : trois produits qui partagent le cliché du
   * panneau mural ne doivent pas le faire voyager trois fois.
   */
  medias: string[];
}

export interface PublicSiteCategory {
  /** Sélection manuelle commune TV / vitrine, dans l'ordre choisi. */
  featuredProductIds?: string[];
  /** Distingue une sélection vidée volontairement du menu jamais configuré. */
  featuredConfigured?: boolean;
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
  websiteUrl?: string | null;
  /** Le masque d'identité — toujours présent côté API (repli Nuit sinon). */
  brand: Brand;
  logoUrl: string | null;
  brandColor: string;
  address: string;
  phones: string[];
  hours: PublicSiteHours[];
}

export interface PublicSiteResponse {
  tenant: PublicSiteTenant;
  menu: {
    categories: PublicSiteCategory[];
    /** Intention globale, conservée même si sa catégorie est momentanément masquée. */
    featuredConfigured?: boolean;
  };
  /**
   * La médiathèque du restaurant, à plat et une seule fois : point d'intérêt,
   * texte alternatif et les quatre adresses d'usage de chaque photo. Les
   * produits n'en portent que les identifiants.
   */
  medias: MediaVue[];
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
  delivery?: PublicDeliverySettings;
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
 * ═══ LE REGISTRE DU RESTAURANT — CE QU'IL COUVRE, ET POURQUOI PAS TOUT ═══
 *
 * Les actions du journal d'audit (collection `auditlogs`). À ne pas confondre
 * avec `ADMIN_LOG_ACTIONS` (admin.ts), qui trace ce que fait l'ÉQUIPE SNACK
 * MANAGER sur les comptes de ses clients. Ici, c'est le registre du
 * RESTAURATEUR : ce que son équipe et lui font dans leur propre établissement.
 *
 * ─── LA RÈGLE DE PÉRIMÈTRE ───
 *
 * Est journalisé CE QUI TOUCHE À L'ARGENT OU À LA DISPONIBILITÉ. Rien d'autre.
 *
 * Un journal exhaustif n'est pas un meilleur journal : tracer chaque frappe de
 * clavier (un nom de produit corrigé, une photo remplacée, une catégorie
 * réordonnée) gonfle la collection de lignes que personne ne lira jamais et
 * NOIE celles qui se défendent en contrôle. Le registre du CRM tient la même
 * discipline — dix-huit gestes nommés, pas un champ modifié.
 *
 * Concrètement, une action entre ici si elle change :
 *   · un PRIX payé par le client (produit, variante, supplément) ;
 *   · CE QUI EST VENDABLE à l'instant (rupture, article créé ou retiré) ;
 *   · le STOCK, qui est de l'argent en réserve (mouvement, correction) ;
 *   · CE QUE VOIT LE CLIENT et qui engage le restaurant (identité, horaires,
 *     pause de la commande en ligne, masque, logo, identité de facturation).
 *
 * ─── CE QUI EN EST ÉCARTÉ, ET POUR QUELLE RAISON ───
 *
 *   · Nom, description, photo, ordre d'affichage d'un produit ou d'une
 *     catégorie ; création et renommage d'une catégorie. Aucune conséquence
 *     sur l'argent ni sur la disponibilité — c'est de la mise en page.
 *   · Fiche d'un ingrédient hors stock et hors prix de supplément (libellé,
 *     catégorie, seuil d'alerte, allergènes, marques). Même raison. Les
 *     ALLERGÈNES sont un sujet de sécurité alimentaire et non d'argent : s'ils
 *     doivent être tracés un jour, ce sera sous une action à eux, avec la
 *     rétention et l'écran qui vont avec — pas glissés ici par commodité.
 *   · Fournisseurs, articles fournisseurs et PRIX D'ACHAT. Ils ont DÉJÀ leur
 *     registre dédié, `supplier_price_history` (PostgreSQL, @sm/supply) :
 *     doubler la trace, c'est fabriquer deux registres qui finiront par se
 *     contredire, et le jour du litige on ne saura pas lequel croire.
 *   · Recettes et nomenclatures d'options (BOM). Elles ne déplacent aucun
 *     stock et ne changent aucun prix de vente au moment où on les écrit :
 *     elles changent le coût matière AFFICHÉ. Le geste qui compte — le prix de
 *     vente qui en découle — est journalisé, lui.
 *   · La CONSULTATION d'un écran. Le CRM trace ses consultations parce que
 *     nous regardons le dossier d'un tiers ; un gérant qui ouvre sa propre
 *     caisse ne rend de comptes à personne, et une ligne par ouverture d'écran
 *     rendrait ce registre illisible en une matinée.
 *   · Le changement de FORMULE. Il n'existe pas de route par laquelle un
 *     restaurateur change la sienne : c'est un geste d'équipe SM, déjà tracé
 *     sous `tenant.plan_change` dans le journal d'administration. L'inventer
 *     ici créerait une action que rien n'écrit.
 */
export const TENANT_AUDIT_ACTIONS = [
  // ─── Commandes : l'argent qui sort de la recette du jour ───
  'order.cancel',
  'order.collect',
  'order.assign',
  'order.discount',
  'order.dispatch',
  /**
   * DÉCLARÉE, JAMAIS ÉCRITE À CE JOUR — et c'est dit plutôt que caché.
   *
   * Aucune route de remboursement n'existe encore dans l'API : le libellé est
   * conservé parce qu'il sera exact le jour où elle naîtra, et parce qu'une
   * ligne posée à la main en base doit se lire en français à l'écran. Le test
   * de couverture (`audit.test.ts`) la nomme explicitement pour qu'elle ne
   * passe pas pour un oubli.
   */
  'order.refund',

  // ─── Prix de vente ───
  /**
   * Prix d'un produit, d'une variante, ou d'un SUPPLÉMENT payant. Les trois
   * sont le même fait pour le client : ce qu'il paie a changé. Trois actions
   * distinctes obligeraient l'écran à raconter trois fois la même histoire.
   */
  'price.change',

  // ─── Ce qui est vendable ───
  'product.create',
  'product.delete',
  /** Rupture ou retour d'un produit, posée à la main depuis la caisse ou le KDS. */
  'product.stock',
  /**
   * Une catégorie supprimée détache ses produits (`categoryId: null`) : ils
   * disparaissent des écrans qui présentent la carte par catégorie. C'est une
   * mise hors service en masse, pas une retouche de mise en page — d'où la
   * différence de traitement avec sa création et son renommage.
   */
  'category.delete',

  // ─── Le stock, c'est-à-dire l'argent en réserve ───
  /** Achat, perte, inventaire — le geste déclaré, par `POST /supply/movements`. */
  'stock.movement',
  /**
   * Le stock corrigé depuis l'ÉDITEUR d'ingrédient, hors mouvement.
   *
   * C'était le seul chemin par lequel une quantité changeait sans laisser la
   * moindre trace, ni dans `stock_movements` ni ailleurs : une perte pouvait
   * s'effacer d'un `PATCH`. Il porte donc sa propre action — confondre une
   * correction de fiche avec un mouvement déclaré ferait mentir l'inventaire.
   */
  'stock.adjust',
  /** Rupture d'ingrédient : elle coupe d'un geste tous les produits qui en dépendent. */
  'ingredient.out',
  /** Sortie du catalogue (suppression douce) — le stock qu'il portait cesse d'être suivi. */
  'ingredient.delete',

  // ─── Ce que voit le client, et ce qui engage le restaurant ───
  'tenant.identity',
  'tenant.hours',
  'tenant.settings',
  'tenant.brand',
  'tenant.logo',
  /** Raison sociale, SIRET, TVA : ce qui s'imprime sur les factures qu'il émet. */
  'tenant.billing_identity',
] as const;

export type TenantAuditAction = (typeof TENANT_AUDIT_ACTIONS)[number];

/**
 * Rédigés — jamais un code machine devant un gérant.
 *
 * `Record<TenantAuditAction, string>` et non `Record<string, string>` : une
 * action ajoutée à la liste ci-dessus sans libellé ne compile plus. La version
 * permissive laissait au contraire s'afficher `product.stock` en toutes
 * lettres dans le registre d'un restaurateur.
 */
export const AUDIT_ACTION_LABELS: Record<TenantAuditAction, string> = {
  'order.cancel': 'Annulation de commande',
  'order.collect': 'Encaissement de commande',
  'order.assign': 'Affectation de livraison',
  'order.discount': 'Remise',
  'order.dispatch': 'Départ en livraison',
  'order.refund': 'Remboursement',
  'price.change': 'Changement de prix',
  'product.create': 'Produit ajouté à la carte',
  'product.delete': 'Produit retiré de la carte',
  'product.stock': 'Rupture ou retour d’un produit',
  'category.delete': 'Catégorie supprimée',
  'stock.movement': 'Mouvement de stock',
  'stock.adjust': 'Stock corrigé à la main',
  'ingredient.out': 'Rupture d’ingrédient',
  'ingredient.delete': 'Ingrédient retiré du catalogue',
  'tenant.identity': 'Identité de l’enseigne',
  'tenant.hours': 'Horaires et fermetures',
  'tenant.settings': 'Réglages du service',
  'tenant.brand': 'Masque d’identité',
  'tenant.logo': 'Logo',
  'tenant.billing_identity': 'Identité de facturation',
};

/**
 * ═══ PAR QUEL MOYEN L'AUTEUR A OUVERT SA SESSION ═══
 *
 * « Qui » ne suffit pas à relire un geste six mois plus tard : le même nom
 * peut agir depuis le back-office avec son mot de passe ou depuis la tablette
 * du comptoir avec un code à quatre chiffres, et les deux n'engagent pas la
 * même chose. Le moyen dit AUSSI dans quel référentiel lire `id` :
 * `password` → un compte (`users`), `pin` → un membre d'équipe (`staff`).
 *
 * ─── LA PLACE DÉJÀ RÉSERVÉE, SANS RIEN CONSTRUIRE ───
 *
 * `connector` existe ici et n'est écrit par AUCUN code aujourd'hui : il n'y a
 * ni clé de connecteur, ni route qui en accepte une, et ce chantier n'en
 * ajoute pas. Il est déclaré pour que le jour où un assistant agira au nom
 * d'un restaurant, la ligne de journal se pose SANS MIGRATION — l'auteur est
 * stocké en TEXTE (et non en `ObjectId`), précisément pour qu'un identifiant
 * de clé, qui n'aura pas cette forme, y tienne. Le champ `name` nommera alors
 * l'assistant, `role` le titre sous lequel il a agi.
 */
export const AUDIT_AUTHOR_MEANS = ['password', 'pin', 'connector', 'delivery_access'] as const;
export type AuditAuthorMeans = (typeof AUDIT_AUTHOR_MEANS)[number];

export const AUDIT_AUTHOR_MEANS_LABELS: Record<AuditAuthorMeans, string> = {
  password: 'depuis le back-office',
  pin: 'au code, sur tablette',
  connector: 'par un assistant connecté',
  delivery_access: 'depuis l’accès livreur',
};

/**
 * L'AUTEUR D'UN GESTE, tel qu'il est ÉCRIT dans la ligne.
 *
 * `name` et `role` sont DÉNORMALISÉS, exactement pour la raison qui vaut
 * `actorEmail` au journal d'administration : un registre qui se relit à
 * travers une jointure CHANGE DE CONTENU le jour où un équipier est renommé,
 * change de rôle ou quitte le restaurant. Ce qui est écrit reste écrit.
 */
export type AuditAuthor = {
  /** `users._id`, `staff._id`, `delivery_operators._id`, ou une clé de connecteur. */
  id: string;
  /** Le nom AU MOMENT DU GESTE. Peut être vide : un compte historique n'en porte pas. */
  name: string;
  /** À quel titre — `owner`, `gerant`, `caisse`, `cuisine`… */
  role: string;
  means: AuditAuthorMeans;
};

/** Une ligne du journal telle que l'écran du gérant la lit. */
export type AuditEntryView = {
  _id: string;
  at: string;
  action: string;
  /** Rédigé — jamais un code machine devant un gérant. */
  actionLabel: string;
  /**
   * L'équipier dont le PIN a validé le geste — '' pour un geste sans PIN.
   *
   * CONSERVÉ malgré `author` : les lignes écrites avant ce champ n'ont que
   * `staffId`, et un registre append-only ne se réécrit pas pour rattraper une
   * évolution de forme. L'écran affiche `author` quand il existe, ce nom
   * sinon.
   */
  staffName: string;
  /** `null` sur les lignes antérieures au champ — voir `staffName`. */
  author: AuditAuthor | null;
  meta: Record<string, unknown>;
};
