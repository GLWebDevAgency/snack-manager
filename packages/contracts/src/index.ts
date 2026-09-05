import { z } from 'zod';
// `JwtPayload` et `AuthMe` (plus bas) nomment `UserRole` : `export *` republie
// sans lier le nom localement, il faut donc l'importer en plus.
import { type UserRole } from './comptes';

export * from './comptes';
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
export * from './security';
export * from './loyalty';
export * from './loyalty-public';
export * from './marque';
export * from './capacites';
export * from './mediatheque';
export * from './mediatheque-octets';
export * from './menu-legacy-options';

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

/*
 * `USER_ROLES` A DÉMÉNAGÉ DANS `./comptes` — et n'est pas seulement déplacé.
 *
 * Un restaurant n'a plus un compte mais plusieurs (`owner`, `cogerant`,
 * `comptable`), et le modèle qui va avec — subsomption des rôles, plafond par
 * formule, projection des réponses — ne tenait pas dans trois lignes au milieu
 * des énumérations de commande. `export * from './comptes'` (avec les autres
 * en tête de fichier) le republie : tout appelant de `@sm/contracts` continue
 * d'importer `USER_ROLES`, `UserRoleSchema` et `UserRole` sans rien changer.
 */

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

export const OptionGroupSchema = z
  .object({
    key: z.string().min(1),
    name: z.string().min(1),
    type: z.enum(['single', 'multi']),
    min: z.number().int().nonnegative().default(0),
    max: z.number().int().positive().optional(),
    choices: z.array(OptionChoiceSchema).min(1),
    perVariant: z.record(z.string(), PerVariantRuleSchema).optional(),
  })
  /**
   * UN GROUPE « UN SEUL » VAUT UN, PARTOUT.
   *
   * `type: 'single'` sans `max` était lu de trois façons : la page de commande
   * en ligne n'autorisait qu'un choix, la caisse et l'API en acceptaient une
   * infinité. L'éditeur y menait tout droit — son champ « Maximum » annonce
   * « Vide = autant qu'on veut », ce qui est faux pour un groupe « un seul ».
   *
   * Le maximum se DÉDUIT donc du type plutôt que de rester au bon vouloir de
   * chaque lecteur. Un `max` explicite plus grand que 1 sur un groupe « un
   * seul » est une contradiction, pas une préférence : il est refusé.
   */
  .transform((g) => (g.type === 'single' && g.max === undefined ? { ...g, max: 1 } : g))
  .superRefine((g, ctx) => {
    if (g.type === 'single' && g.max !== undefined && g.max > 1) {
      ctx.addIssue({
        code: 'custom',
        path: ['max'],
        message: 'Un groupe « un seul choix » ne peut pas accepter plus d’un choix',
      });
    }
    // `min > max` rend le produit INVENDABLE : la commande exige plus de choix
    // que le groupe n'en autorise, et refuse chaque tentative. Aucun écran ne
    // prévenait — les deux champs étaient validés séparément.
    if (g.max !== undefined && g.min > g.max) {
      ctx.addIssue({
        code: 'custom',
        path: ['min'],
        message: `Minimum (${g.min}) supérieur au maximum (${g.max}) — le produit serait invendable`,
      });
    }
    if (g.max !== undefined && g.max > g.choices.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['max'],
        message: `Maximum (${g.max}) supérieur au nombre de choix (${g.choices.length})`,
      });
    }
  });
export type OptionGroup = z.infer<typeof OptionGroupSchema>;

/**
 * ─── `photoUrl` N'EST PLUS ÉCRIVABLE, ET C'EST UNE CORRECTION DE SÉCURITÉ ───
 *
 * Le champ était une CHAÎNE LIBRE : ni URL, ni protocole, ni origine vérifiés.
 * Il finissait pourtant en `src` sur la vitrine du restaurant, sur son tableau
 * de menu, dans ses données structurées et sur la tablette de sa caisse —
 * c'est-à-dire au même endroit que les images de masque, auxquelles une liste
 * blanche d'origines s'applique depuis le 01/09/2026 (`origines-images.ts`).
 * Un `owner` pouvait donc faire télécharger l'image de son choix, depuis
 * l'hôte de son choix, par tous ses clients : la garde posée sur les URL de
 * masque ne gardait rien tant que celle-ci restait ouverte.
 *
 * Une photo de plat passe désormais par la MÉDIATHÈQUE (`mediatheque.ts`) :
 * un fichier déposé sur sa propre route, stocké chez nous, servi par nous, et
 * `photoUrl` devient un champ plat DÉRIVÉ de la première référence — comme
 * `logoUrl` l'est de `brand.logo`. Le champ reste en base et reste LU en repli
 * (les dix-neuf photos du pilote), il n'est simplement plus reçu d'un client.
 *
 * Zod ignore les clés inconnues : un ancien appelant qui l'envoie encore n'est
 * pas mis en erreur, sa valeur est écartée. C'est le bon comportement — le
 * seul appelant qui l'écrivait était un script de peuplement.
 */
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
  // `photoUrl` absent, comme à la création — voir la note ci-dessus. La photo
  // se choisit par `PUT /products/:id/medias`, jamais par un champ de texte.
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
  /**
   * Les retraits « sans oignons » — BORNÉS, comme la note deux lignes plus bas.
   *
   * C'était un tableau sans longueur de chaînes sans longueur, recopié tel quel
   * sur la commande et imprimé tel quel sur le ticket cuisine. Un appel direct
   * envoyait donc mille lignes de mille caractères vers l'imprimante du
   * comptoir — et la note, elle, était plafonnée à deux cents caractères depuis
   * toujours dans le même schéma.
   */
  removed: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
  note: z.string().max(200).optional(),
  /**
   * Un plafond haut, mais un plafond.
   *
   * Sans lui, un appel anonyme posait `qty: 1000000` sur un tacos à 8,90 € et
   * créait une commande à 8 900 000 € qui partait en cuisine. Cinquante est
   * au-delà de toute commande de comptoir réelle et en deçà de l'absurde ; une
   * commande de groupe se saisit en plusieurs lignes.
   */
  qty: z.number().int().positive().max(50).default(1),
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
  /**
   * Carte présentée avant l'encaissement au comptoir.
   *
   * Le serveur la fige sur la vente : le crédit ne peut ainsi pas être
   * détourné après coup vers une autre carte à partir de la liste des tickets.
   * Ce champ n'existe volontairement pas dans le contrat public.
   */
  loyaltyMemberId: z.uuid().optional(),
  /**
   * Intention de gain embarquée dans LA MÊME écriture durable que la vente.
   * Le serveur la traite après livraison ; aucun second outbox local ne peut
   * donc être perdu entre deux écritures lors d'un crash de tablette.
   */
  loyaltyEarnOperationId: z.uuid().optional(),
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
}).superRefine((order, ctx) => {
  const hasMember = order.loyaltyMemberId !== undefined;
  const hasOperation = order.loyaltyEarnOperationId !== undefined;
  if (hasMember !== hasOperation) {
    ctx.addIssue({
      code: 'custom',
      path: hasMember ? ['loyaltyEarnOperationId'] : ['loyaltyMemberId'],
      message: 'La carte et son intention de gain sont indissociables',
    });
  }
  if (hasMember && order.channel !== 'pos') {
    ctx.addIssue({
      code: 'custom',
      path: ['channel'],
      message: 'La fidélité du pilote exige une vente au comptoir authentifiée',
    });
  }
});
export type CreateOrder = z.infer<typeof CreateOrderSchema>;

/**
 * État public, sans identifiant membre ni détail technique, du gain porté
 * par une vente POS. `processing` reste rejouable : il ne signifie jamais que
 * les points sont acquis avant la validation du ledger PostgreSQL.
 */
export const OrderLoyaltyEarnStateSchema = z.enum([
  'none',
  'pending',
  'processing',
  'completed',
  'failed',
  'cancelled',
]);
export type OrderLoyaltyEarnState = z.infer<typeof OrderLoyaltyEarnStateSchema>;

export const OrderLoyaltyEarnStatusSchema = z.object({
  state: OrderLoyaltyEarnStateSchema,
  attempts: z.number().int().nonnegative(),
  /** Code fermé et non sensible ; jamais le message brut d'une dépendance. */
  errorCode: z.string().regex(/^[a-z0-9_]{1,64}$/).nullable(),
});
export type OrderLoyaltyEarnStatus = z.infer<typeof OrderLoyaltyEarnStatusSchema>;

/**
 * Contrat de la commande PUBLIQUE, volontairement distinct de celui du POS.
 *
 * Le navigateur ne choisit ni le canal, ni le type, ni un moyen effectivement
 * encaisse, ni un statut. Ces faits sont poses par l'API. Reutiliser le DTO du
 * poste authentifie permettait notamment d'omettre le retrait et d'injecter
 * des tickets `surplace` directement dans la cuisine.
 */
export const CreatePublicOrderSchema = z
  .object({
    clientId: z.uuid(),
    lines: z.array(OrderLineInputSchema.strict()).min(1).max(50),
    payment: z
      .object({
        /** Intention du client ; le statut reste toujours calcule serveur. */
        method: PaymentMethodSchema,
      })
      .strict(),
    pickup: z
      .object({
        slot: z.iso.datetime(),
        customerName: z.string().trim().min(2).max(80),
        customerPhone: z.string().trim().min(6).max(32),
      })
      .strict(),
    note: z.string().trim().max(500).optional(),
    promoCode: z.string().trim().min(1).max(24).optional(),
    /** Jeton Cloudflare Turnstile : 2 048 caracteres maximum selon Siteverify. */
    turnstileToken: z.string().min(1).max(2_048),
  })
  .strict();
export type CreatePublicOrder = z.infer<typeof CreatePublicOrderSchema>;

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

/**
 * L'AVANCEMENT D'UNE COMMANDE — et « annulée » n'en est pas un.
 *
 * Le schéma acceptait les cinq statuts, `cancelled` compris. Or la règle
 * d'écriture compare les rangs, et `cancelled` vaut −1 : la demande était
 * acceptée, puis JETÉE en silence, l'API rendant la commande inchangée avec un
 * 200. L'équipe croyait avoir annulé.
 *
 * Annuler passe par `POST /orders/:id/cancel`, qui exige un motif et un code —
 * une annulation sort une commande de la recette du jour, elle ne se fait pas
 * d'un glissement d'écran. Le refus le dit plutôt que de laisser deviner.
 */
export const UpdateOrderStatusSchema = z.object({
  status: OrderStatusSchema.refine((s) => s !== 'cancelled', {
    message: 'Une annulation passe par « Annuler la commande » — avec un motif et un code.',
  }),
});

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
  /** Émis automatiquement par JwtService ; utilisé pour fermer le temps réel à échéance. */
  iat?: number;
  /** Émis automatiquement par JwtService ; exprimé en secondes Unix. */
  exp?: number;
  /**
   * Version de sécurité d'un compte email/mot de passe. Elle reste optionnelle
   * dans le type pour décoder les anciens JWT, mais l'autorité serveur refuse
   * désormais toute session `user` qui ne la porte pas.
   */
  userSessionVersion?: string;
  /**
   * Une session PIN est liée à la personne ET à la tablette qui l'a ouverte.
   * Les champs restent optionnels dans le type pour décoder proprement les
   * anciens jetons ; l'autorisation serveur refuse toutefois un JWT staff qui
   * ne les porte pas et demande une nouvelle saisie du PIN.
   */
  staffSessionVersion?: string;
  deviceId?: string;
  deviceSessionVersion?: string;
}

/**
 * QUI est devant l'écran — la PERSONNE, pas son restaurant.
 *
 * Réponse de `GET /auth/me`. Elle existe parce qu'aucune route ne la rendait :
 * `GET /tenants/me` rend l'ÉTABLISSEMENT, et les deux back-offices affichaient
 * donc une identité ÉCRITE EN DUR en pied de barre — « Le Gérant » côté
 * restaurant, « Admin SM » côté équipe. Le jeton porte bien `sub`, `role` et
 * `kind`, jamais le nom : il fallait aller le lire.
 *
 * ─── POURQUOI ELLE RESTE SÉPARÉE DE L'ÉTABLISSEMENT ───
 *
 * Une personne et un restaurant n'ont ni le même cycle de vie, ni le même
 * public. `GET /tenants/me` est lu par toutes les tablettes du comptoir ; y
 * greffer l'identité du porteur du jeton mêlerait deux natures de données dans
 * une réponse partagée, et la prochaine personne ajoutée au restaurant
 * obligerait à choisir laquelle des deux ce « me » désigne.
 *
 * ─── C'EST ICI QUE LES PERMISSIONS VIENDRONT ───
 *
 * Le chantier « plusieurs comptes par restaurant » ajoutera des rôles plus
 * fins et des permissions. Elles se poseront SUR CETTE RÉPONSE — c'est le seul
 * endroit qui répond déjà « qui es-tu », et l'écran qui peint une barre de
 * navigation demande ensuite « qu'as-tu le droit d'ouvrir ». Aucun champ de
 * permission n'existe aujourd'hui, volontairement : en inventer un maintenant
 * figerait une forme avant d'avoir le besoin. Le rôle reste, comme partout,
 * un indice d'affichage — l'autorité est `@Roles(...)` côté API.
 */
export type AuthMe = {
  /** Identifiant du compte (`users`) ou du membre d'équipe (`staff`). */
  id: string;
  /** Le nom affiché. Peut être vide : un compte historique n'en porte pas. */
  nom: string;
  role: UserRole | StaffRole;
  /**
   * COMMENT la session a été ouverte — le `kind` du jeton.
   * `user` : e-mail et mot de passe. `staff` : code sur tablette appairée.
   */
  genre: 'user' | 'staff';
  /** `null` pour une session `staff` : un porteur de code n'a pas d'e-mail. */
  email: string | null;
  /** `null` pour l'équipe Snack Manager (`sm_admin`), qui n'a pas de restaurant. */
  tenantId: string | null;
};

/**
 * POSER SON PROPRE NOM — corps de `PATCH /auth/me`.
 *
 * `users.name` n'était écrit qu'UNE fois, à la conversion d'un lead, depuis un
 * champ facultatif de la modale du CRM. Aucune route ne le mettait à jour :
 * les deux seules écritures de la collection touchent la version de session et
 * l'empreinte du mot de passe. Laissé vide à la signature, il l'était pour
 * toujours — et depuis que le pied des deux barres affiche l'identité de la
 * personne connectée, il s'y lisait comme un tiret que rien ne permettait de
 * remplir.
 *
 * ─── LE SUJET VIENT DU JETON, JAMAIS DU CORPS ───
 *
 * Aucun identifiant ici : on écrit le nom de la session qui appelle, comme
 * `GET /auth/me` ne lit que la sienne. Un `id` dans ce corps ferait de cette
 * route un renommage d'autrui, et la porte serait ouverte avant que la règle
 * qui la garde n'existe.
 *
 * ─── LA BORNE : 120, ET C'EST CELLE DE LA SIGNATURE ───
 *
 * `LeadConvertSchema.ownerName` écrit cette même colonne, borné à 120. Deux
 * bornes différentes sur une seule colonne laisseraient le CRM poser un nom
 * que son porteur ne pourrait plus réenregistrer — un champ qui refuse ce
 * qu'il affiche. Les barres, elles, tronquent à l'écran : cette borne protège
 * la base et le journal, pas la mise en page.
 *
 * `.strict()` comme partout ailleurs : une clé inattendue dans un corps de
 * requête est une tentative, pas une tolérance.
 */
export const AuthMeUpdateSchema = z
  .object({
    /**
     * Au moins un caractère : le nom vide est l'état qu'on répare, pas un
     * choix qu'on offre. Qui veut se retirer du pied de barre n'a rien à y
     * gagner — l'écran retomberait sur le tiret d'avant.
     */
    nom: z.string().trim().min(1, 'Votre nom ne peut pas rester vide.').max(120),
  })
  .strict();
export type AuthMeUpdate = z.infer<typeof AuthMeUpdateSchema>;

// ─────────────────────────────────────────────────────────────
// Temps réel (WebSocket) — rooms par tenantId
// ─────────────────────────────────────────────────────────────

/**
 * Rôles autorisés à lire la file de commandes et à rejoindre son flux temps
 * réel. Le cogérant n'est pas dupliqué ici : il endosse `gerant` via
 * `roleSatisfait`, exactement comme dans la garde HTTP.
 */
export const ORDER_READ_ROLES = ['owner', 'gerant', 'caisse', 'cuisine'] as const;

export const WS_EVENTS = {
  orderCreated: 'order.created',
  orderUpdated: 'order.updated',
  menuUpdated: 'menu.updated',
} as const;
export type WsEvent = (typeof WS_EVENTS)[keyof typeof WS_EVENTS];

/** Canal Redis pub/sub par tenant. */
export const ordersChannel = (tenantId: string) => `tenant:${tenantId}:orders`;
