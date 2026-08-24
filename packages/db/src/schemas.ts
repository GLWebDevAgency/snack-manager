import { Schema, type InferSchemaType } from 'mongoose';
import {
  PLATFORM_SETTINGS_ID,
  SM_INVOICE_VAT,
  isPlatformLogAction,
  type SocialNetwork,
} from '@sm/contracts';

// Conventions : prix en centimes (int), tenantId indexé en tête de chaque
// collection tenant-scoped, timestamps automatiques partout.

// ─────────────────────────────────────────────────────────────
// tenants
// ─────────────────────────────────────────────────────────────

const HoursSlot = new Schema(
  { open: { type: String, required: true }, close: { type: String, required: true } },
  { _id: false },
);

const DayHours = new Schema(
  {
    day: { type: Number, min: 1, max: 7, required: true }, // ISO : 1 = lundi … 7 = dimanche
    lunch: { type: HoursSlot, default: null },
    dinner: { type: HoursSlot, default: null },
  },
  { _id: false },
);

export const TenantSchema = new Schema(
  {
    slug: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    logoUrl: { type: String, default: null },
    brandColor: { type: String, default: '#c9a15a' },
    address: { type: String, default: '' },
    phones: { type: [String], default: [] },
    hours: { type: [DayHours], default: [] },
    closures: {
      type: [
        new Schema(
          { from: Date, to: Date, reason: String },
          { _id: false },
        ),
      ],
      default: [],
    },
    // Domaines personnalisés rattachés à l'établissement (« commander.classfood.fr »).
    // Le sous-domaine automatique `<slug>.snackmanager.app` n'y figure PAS : il
    // est servi sans action du restaurateur, donc sans état à suivre. Ici on ne
    // stocke que ce qui dépend d'un tiers — la zone DNS du client et le
    // certificat de notre hébergeur — d'où `status`, `lastCheckedAt` et `detail`.
    domains: {
      type: [
        new Schema({
          hostname: { type: String, required: true, lowercase: true, trim: true },
          // Identifiant chez le fournisseur (Railway, Cloudflare…) : sans lui on
          // ne sait plus ni interroger l'état ni détacher le domaine.
          providerId: { type: String, required: true },
          status: {
            type: String,
            enum: ['pending_dns', 'issuing_certificate', 'active', 'failed'],
            default: 'pending_dns',
          },
          target: { type: String, required: true }, // valeur CNAME dictée au client
          isPrimary: { type: Boolean, default: false },
          addedAt: { type: Date, default: Date.now },
          lastCheckedAt: { type: Date, default: null },
          detail: { type: String, default: null }, // cause lisible d'un échec
        }),
      ],
      default: [],
    },
    plan: { type: String, enum: ['essentiel', 'complet', 'boost'], default: 'essentiel' },
    founderSeat: { type: Boolean, default: false },
    /**
     * État du compte côté Snack Manager — le seul champ qui décide de l'ACCÈS.
     *
     * Suspendre coupe l'accès, jamais les données : le menu, les commandes et
     * l'historique d'un restaurant suspendu restent intacts, prêts à rouvrir le
     * jour où la facture est réglée. Rien ici n'est destructif.
     *
     * Le sous-schéma est explicite (et non un objet imbriqué implicite) pour
     * que Mongoose infère des champs NON nullables côté TypeScript — même
     * raison que pour `totals` et `payment` sur les commandes.
     *
     * ATTENTION : les tenants créés avant ce champ n'ont pas d'`account` en
     * base, et `.lean()` ne matérialise pas les défauts. Toute lecture doit
     * traiter l'absence comme « pas de blocage » (`DEFAULT_TENANT_ACCOUNT_STATUS`
     * vaut `trial`) — un champ manquant ne doit jamais fermer un restaurant.
     */
    account: {
      type: new Schema(
        {
          status: {
            type: String,
            enum: ['trial', 'active', 'suspended', 'churned'],
            default: 'trial',
            required: true,
          },
          /** Début du statut COURANT, réécrit à chaque changement. */
          since: { type: Date, default: Date.now, required: true },
          /** Motif du dernier changement, saisi par l'équipe SM. */
          reason: { type: String, default: '' },
          /** Horodatage de la suspension en cours — `null` dès la réactivation. */
          suspendedAt: { type: Date, default: null },
          /**
           * Fin de l'essai, posée à la CRÉATION du compte (conversion d'un
           * lead). `null` sur les tenants d'avant ce champ : le signal de fin
           * d'essai retombe alors sur l'ancienneté du statut (TRIAL_DAYS),
           * comme avant — jamais une anomalie.
           */
          trialEndsAt: { type: Date, default: null },
        },
        { _id: false },
      ),
      default: () => ({ status: 'trial', since: new Date(), reason: '', suspendedAt: null }),
    },
    /**
     * IDENTITÉ DE FACTURATION — celle qui s'imprime sur NOS factures.
     *
     * Distincte de `name` et `address`, qui décrivent l'ENSEIGNE et le
     * COMPTOIR : « CLASS'FOOD » et l'adresse où l'on mange. Une facture, elle,
     * s'adresse à une personne morale — « CLASS'FOOD SARL », à son siège, avec
     * son SIRET. Les deux coïncident souvent et diffèrent parfois ; les
     * confondre revient à envoyer au comptable du restaurant une pièce qu'il ne
     * peut pas rattacher.
     *
     * TOUT EST FACULTATIF, et c'est délibéré : exiger un SIRET à l'inscription
     * arrêterait net un restaurateur qui veut d'abord essayer. Ce qui manque
     * s'imprime en emplacement vide et remonte au gérant sur son écran
     * « Abonnement », où il le saisit lui-même — c'est LUI qui le connaît, et
     * le chercher à sa place serait se tromper à sa place.
     *
     * Sous-schéma explicite (et non objet imbriqué implicite) pour que Mongoose
     * infère des champs NON nullables côté TypeScript — même raison que pour
     * `account` et `totals`.
     */
    billing: {
      type: new Schema(
        {
          /** Raison sociale, si elle diffère du nom commercial. */
          legalName: { type: String, default: '' },
          /** Forme juridique et capital — « SARL au capital de 10 000 € ». */
          legalForm: { type: String, default: '' },
          /** 14 chiffres, sans espaces. Vide = pas encore renseigné. */
          siret: { type: String, default: '' },
          /** TVA intracommunautaire — `FR…`. */
          vatNumber: { type: String, default: '' },
          /** Adresse de FACTURATION — le siège, s'il diffère de l'établissement. */
          address: { type: String, default: '' },
          /** Où envoyer les factures, si ce n'est pas l'adresse du compte. */
          email: { type: String, default: '' },
        },
        { _id: false },
      ),
      default: () => ({
        legalName: '',
        legalForm: '',
        siret: '',
        vatNumber: '',
        address: '',
        email: '',
      }),
    },
    settings: {
      slotIntervalMin: { type: Number, default: 10 },
      slotCapacity: { type: Number, default: 4 },
      onlineOrderingPaused: { type: Boolean, default: false },
      pauseMessage: { type: String, default: 'Victimes de notre succès — la commande en ligne rouvre très vite !' },
      printTicketOn: { type: String, enum: ['accept', 'ready'], default: 'accept' },
      printStickerOn: { type: String, enum: ['accept', 'ready'], default: 'ready' },
    },
    stripe: {
      customerId: { type: String, default: null },
      subscriptionId: { type: String, default: null },
    },
  },
  { timestamps: true },
);
export type Tenant = InferSchemaType<typeof TenantSchema>;

// ─────────────────────────────────────────────────────────────
// users — comptes email + mot de passe (gérants, équipe SM)
// ─────────────────────────────────────────────────────────────

export const UserSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ['owner', 'sm_admin'], required: true },
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', default: null }, // null = équipe Snack Manager
    name: { type: String, default: '' },
  },
  { timestamps: true },
);
export type User = InferSchemaType<typeof UserSchema>;

// ─────────────────────────────────────────────────────────────
// staff — équipe du resto, connexion PIN sur tablette
// ─────────────────────────────────────────────────────────────

export const StaffSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    name: { type: String, required: true },
    role: { type: String, enum: ['gerant', 'caisse', 'cuisine'], required: true },
    pinHash: { type: String, required: true },
    active: { type: Boolean, default: true },
    /**
     * Coût horaire employeur, en CENTIMES — sans lui aucune projection de masse
     * salariale n'est possible.
     *
     * DONNÉE PERSONNELLE. Une rémunération ne doit jamais transiter vers une
     * session ouverte au PIN sur la tablette du comptoir : un équipier lirait
     * le salaire de son collègue en tapotant l'écran. La lecture est réservée
     * au compte propriétaire (cf. `canReadPayroll`, module planning) — au même
     * titre que `pinHash`, ce champ ne part JAMAIS dans une réponse par défaut.
     *
     * `null` = non renseigné, à distinguer de `0` : une projection qui compte
     * un salarié non tarifé comme gratuit est un chiffre faux, pas un chiffre
     * prudent. Le module planning remonte explicitement les manquants.
     */
    hourlyCostCents: { type: Number, default: null, min: 0 },
  },
  { timestamps: true },
);
export type Staff = InferSchemaType<typeof StaffSchema>;

// ─────────────────────────────────────────────────────────────
// shifts — pointages (module RH)
// ─────────────────────────────────────────────────────────────

export const ShiftSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, required: true, index: true },
    staffId: { type: Schema.Types.ObjectId, ref: 'Staff', required: true },
    clockIn: { type: Date, required: true },
    clockOut: { type: Date, default: null },
    source: { type: String, enum: ['kds', 'pos', 'backoffice'], default: 'kds' },
  },
  { timestamps: true },
);
ShiftSchema.index({ tenantId: 1, staffId: 1, clockIn: -1 });
export type Shift = InferSchemaType<typeof ShiftSchema>;

// ─────────────────────────────────────────────────────────────
// plannedshifts — services PRÉVUS (planning du gérant)
// ─────────────────────────────────────────────────────────────

/**
 * Un service prévu, à ne pas confondre avec le pointage (`Shift`) : celui-ci
 * dit ce que le gérant a DÉCIDÉ, celui-là ce qui s'est RÉELLEMENT passé. Les
 * confronter est tout l'intérêt du module.
 *
 * POURQUOI DES CHAÎNES ET NON DES `Date`. « Samedi, 18:00 → 23:30 » est une
 * heure MURALE : c'est l'heure de la pendule du snack, pas un instant. Stocké
 * en `Date`, un planning posé en août se décalerait d'une heure au passage à
 * l'heure d'hiver — l'équipe recevrait un planning faux deux fois par an. Le
 * jour reste donc `AAAA-MM-JJ` et les heures `HH:MM` ; la conversion en
 * instants n'a lieu qu'au moment de croiser avec les pointages.
 *
 * `end` peut être INFÉRIEUR à `start` : un snack qui ferme à 00:30 saisit
 * « 18:00 → 00:30 ». La durée se calcule en ajoutant 24 h dans ce cas.
 */
export const PlannedShiftSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, required: true, index: true },
    staffId: { type: Schema.Types.ObjectId, ref: 'Staff', required: true },
    /** Jour calendaire parisien, `AAAA-MM-JJ`. */
    date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    /** Heure murale de début, `HH:MM`. */
    start: { type: String, required: true, match: /^([01]\d|2[0-3]):[0-5]\d$/ },
    /** Heure murale de fin, `HH:MM` — peut précéder `start` (service de nuit). */
    end: { type: String, required: true, match: /^([01]\d|2[0-3]):[0-5]\d$/ },
    position: {
      type: String,
      enum: ['caisse', 'cuisine', 'polyvalent'],
      default: 'polyvalent',
      required: true,
    },
    note: { type: String, default: '' },
    /**
     * Un gérant construit son planning en plusieurs fois, entre deux services.
     * Le BROUILLON est ce qui rend l'outil utilisable : tant qu'il n'a pas
     * publié, son équipe ne doit voir aucun jet intermédiaire.
     */
    status: { type: String, enum: ['brouillon', 'publie'], default: 'brouillon', required: true },
    /** Horodatage de la publication — `null` tant que le service est brouillon. */
    publishedAt: { type: Date, default: null },
  },
  { timestamps: true },
);
/** Lecture d'une semaine : le tri chronologique sort directement de l'index. */
PlannedShiftSchema.index({ tenantId: 1, date: 1, start: 1 });
/** Totaux par personne sur une période (projection de coût, confrontation). */
PlannedShiftSchema.index({ tenantId: 1, staffId: 1, date: 1 });
export type PlannedShift = InferSchemaType<typeof PlannedShiftSchema>;

// ─────────────────────────────────────────────────────────────
// categories
// ─────────────────────────────────────────────────────────────

export const CategorySchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, required: true, index: true },
    name: { type: String, required: true },
    order: { type: Number, default: 0 },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);
CategorySchema.index({ tenantId: 1, order: 1 });
export type Category = InferSchemaType<typeof CategorySchema>;

// ─────────────────────────────────────────────────────────────
// products — le cœur flexible du modèle
// ─────────────────────────────────────────────────────────────

const VariantSub = new Schema(
  {
    key: { type: String, required: true },
    name: { type: String, required: true },
    price: { type: Number, required: true }, // centimes
  },
  { _id: false },
);

const OptionChoiceSub = new Schema(
  {
    key: { type: String, required: true },
    name: { type: String, required: true },
    priceDelta: { type: Number, default: 0 },
  },
  { _id: false },
);

const OptionGroupSub = new Schema(
  {
    key: { type: String, required: true },
    name: { type: String, required: true },
    type: { type: String, enum: ['single', 'multi'], required: true },
    min: { type: Number, default: 0 },
    max: { type: Number, default: null },
    choices: { type: [OptionChoiceSub], default: [] },
    // Règles par variante : { M: { min: 1, max: 1, priceDelta: 150 } }
    perVariant: { type: Schema.Types.Mixed, default: null },
  },
  { _id: false },
);

export const ProductSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, required: true, index: true },
    // null = « Non rattaché » (produit orphelin après suppression de catégorie)
    categoryId: { type: Schema.Types.ObjectId, ref: 'Category', default: null, index: true },
    name: { type: String, required: true },
    description: { type: String, default: '' }, // liste d'ingrédients affichée
    price: { type: Number, default: 0 }, // centimes — ignoré si variants non vide
    variants: { type: [VariantSub], default: [] },
    optionGroups: { type: [OptionGroupSub], default: [] },
    removables: { type: [String], default: [] }, // modificateurs express « sans X »
    tags: { type: [String], default: [] },
    isNew: { type: Boolean, default: false },
    outOfStock: { type: Boolean, default: false }, // rupture 1-tap
    // 'manual' = coupé à la main · 'ingredient' = cascade rupture ingrédient (contexte supply)
    outOfStockSource: { type: String, enum: ['manual', 'ingredient', null], default: null },
    photoUrl: { type: String, default: null },
    order: { type: Number, default: 0 },
    active: { type: Boolean, default: true },
  },
  { timestamps: true, suppressReservedKeysWarning: true },
);
ProductSchema.index({ tenantId: 1, categoryId: 1, order: 1 });
export type Product = InferSchemaType<typeof ProductSchema>;

// ─────────────────────────────────────────────────────────────
// orders
// ─────────────────────────────────────────────────────────────

const OrderLineSub = new Schema(
  {
    productId: { type: Schema.Types.ObjectId, required: true },
    name: { type: String, required: true }, // dénormalisé : le ticket survit aux edits du menu
    variantKey: { type: String, default: null },
    variantName: { type: String, default: null },
    options: {
      type: [
        new Schema(
          {
            groupKey: String,
            choiceKey: String,
            name: String,
            priceDelta: { type: Number, default: 0 },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    removed: { type: [String], default: [] },
    note: { type: String, default: null },
    qty: { type: Number, required: true, min: 1 },
    unitPrice: { type: Number, required: true },
    lineTotal: { type: Number, required: true },
  },
  { _id: false },
);

export const OrderSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, required: true, index: true },
    number: { type: Number, required: true }, // séquence journalière par tenant
    clientId: { type: String, required: true }, // clé d'idempotence offline (uuid appareil)
    channel: { type: String, enum: ['online', 'pos', 'phone'], required: true },
    type: { type: String, enum: ['surplace', 'emporter', 'pickup'], required: true },
    lines: { type: [OrderLineSub], required: true },
    // Sous-schémas explicites + required : sans cela, Mongoose 8.24 infère les
    // objets imbriqués comme optionnels et tout accès devient nullable côté TS.
    totals: {
      type: new Schema(
        {
          subtotal: { type: Number, required: true },
          discount: {
            type: new Schema(
              { amount: Number, reason: String, staffId: Schema.Types.ObjectId },
              { _id: false },
            ),
            default: null,
          },
          total: { type: Number, required: true },
        },
        { _id: false },
      ),
      required: true,
    },
    payment: {
      type: new Schema(
        {
          // OÙ l'argent est encaissé.
          method: { type: String, enum: ['online', 'counter'], required: true },
          // AVEC QUOI le client a payé. `null` = rien n'a encore été perçu.
          // Sans ce champ, une carte passée à la caisse est indiscernable d'un
          // « à encaisser au retrait » et la clôture de caisse (Z) est fausse.
          tender: { type: String, enum: ['cash', 'card', 'meal_voucher', 'online', null], default: null },
          status: { type: String, enum: ['pending', 'paid', 'refunded'], default: 'pending' },
          // Rendu monnaie, en CENTIMES. Calculés par le serveur à la création :
          // changeGiven = cashReceived − totals.total.
          cashReceived: { type: Number, default: null },
          changeGiven: { type: Number, default: null },
          stripePaymentIntentId: { type: String, default: null },
        },
        { _id: false },
      ),
      required: true,
    },
    status: {
      type: String,
      enum: ['new', 'preparing', 'ready', 'delivered', 'cancelled'],
      default: 'new',
      index: true,
    },
    statusHistory: {
      type: [
        new Schema(
          { status: String, at: Date, by: { type: String, default: 'system' } },
          { _id: false },
        ),
      ],
      default: [],
    },
    pickup: {
      type: new Schema(
        { slot: Date, customerName: String, customerPhone: { type: String, default: null } },
        { _id: false },
      ),
      default: null,
    },
    note: { type: String, default: null },
    /**
     * Jeton de suivi public — 32 caractères URL-safe tirés de `crypto`.
     *
     * L'ObjectId seul ne peut pas garder un secret : son préfixe est un
     * horodatage et son suffixe un compteur, donc partiellement devinable.
     * Les routes `/public/orders/:id…` exigent ce jeton avant d'exposer le
     * nom et le téléphone du client (RGPD).
     *
     * NON `required` volontairement : les commandes antérieures à ce champ
     * doivent rester enregistrables (`order.save()` sur un changement de
     * statut) plutôt que d'échouer en validation en plein service.
     */
    trackingToken: { type: String, default: null },
    virtualBrandId: { type: Schema.Types.ObjectId, default: null }, // marques virtuelles T4
    // Métadonnées techniques (ex. { note: 'seed-history' } pour purger un jeu de démo)
    meta: { type: Schema.Types.Mixed, default: null },
  },
  { timestamps: true },
);
OrderSchema.index({ tenantId: 1, createdAt: -1 });
OrderSchema.index({ tenantId: 1, status: 1 });
OrderSchema.index({ tenantId: 1, clientId: 1 }, { unique: true }); // rejeu offline idempotent
// Non unique : les commandes créées avant le champ portent toutes `null`, et
// un index unique les ferait entrer en collision. La collision de deux jetons
// de 192 bits tirés au hasard, elle, n'arrive pas.
OrderSchema.index({ trackingToken: 1 });
export type Order = InferSchemaType<typeof OrderSchema>;

// ─────────────────────────────────────────────────────────────
// counters — numérotation journalière atomique
// ─────────────────────────────────────────────────────────────

export const CounterSchema = new Schema(
  {
    _id: { type: String, required: true }, // `<tenantId>:<yyyymmdd>`
    seq: { type: Number, default: 0 },
  },
  { versionKey: false },
);
export type Counter = InferSchemaType<typeof CounterSchema>;

// ─────────────────────────────────────────────────────────────
// auditLog — append-only, socle NF525
// ─────────────────────────────────────────────────────────────

export const AuditLogSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, required: true, index: true },
    staffId: { type: Schema.Types.ObjectId, default: null },
    action: { type: String, required: true }, // order.cancel | order.discount | order.refund | price.change | …
    targetId: { type: String, default: null },
    meta: { type: Schema.Types.Mixed, default: null },
    pinVerifiedAt: { type: Date, default: null },
    at: { type: Date, default: Date.now },
  },
  { timestamps: false },
);
AuditLogSchema.index({ tenantId: 1, at: -1 });
export type AuditLog = InferSchemaType<typeof AuditLogSchema>;

// ─────────────────────────────────────────────────────────────
// leads — CRM Snack Manager
// ─────────────────────────────────────────────────────────────

export const LeadSchema = new Schema(
  {
    restaurantName: { type: String, required: true },
    contact: {
      name: { type: String, default: '' },
      phone: { type: String, default: '' },
      email: { type: String, default: '' },
    },
    stage: {
      type: String,
      enum: ['nouveau', 'contacte', 'demo', 'proposition', 'signe', 'perdu'],
      default: 'nouveau',
    },
    sequence: { type: String, enum: ['A', 'B', 'C', null], default: null },
    touches: {
      type: [new Schema({ at: Date, type: String, note: String }, { _id: false })],
      default: [],
    },
    founderSeatReserved: { type: Boolean, default: false },
    notes: { type: String, default: '' },
  },
  { timestamps: true },
);
export type Lead = InferSchemaType<typeof LeadSchema>;

// ─────────────────────────────────────────────────────────────
// errorEvents — le journal d'erreurs de la plateforme (exploitation)
// ─────────────────────────────────────────────────────────────

/**
 * Une ligne PAR EMPREINTE, jamais par occurrence : la même panne qui frappe
 * mille fois pèse un document avec `count: 1000`, pas mille documents. C'est
 * ce qui rend la collection lisible à l'écran ET insubmersible — une boucle
 * d'erreurs ne peut pas remplir la base plus vite qu'elle n'incrémente.
 */
export const ErrorEventSchema = new Schema(
  {
    source: { type: String, enum: ['api', 'web', 'pos', 'kds'], required: true },
    hash: { type: String, required: true },
    message: { type: String, required: true },
    stack: { type: String, default: '' },
    url: { type: String, default: '' },
    appVersion: { type: String, default: '' },
    count: { type: Number, default: 1 },
    firstAt: { type: Date, required: true },
    lastAt: { type: Date, required: true },
    // null = jamais vue : c'est la valeur qui fait remonter le groupe en tête
    // de l'écran (null trie avant toute date).
    seenAt: { type: Date, default: null },
  },
  { timestamps: false },
);
ErrorEventSchema.index({ source: 1, hash: 1 }, { unique: true });
ErrorEventSchema.index({ lastAt: -1 });
export type ErrorEvent = InferSchemaType<typeof ErrorEventSchema>;

/**
 * Mémoire du veilleur d'alertes : quand chaque clé a sonné pour la dernière
 * fois. C'est elle qui transforme « une caisse muette » en UNE alerte toutes
 * les six heures, et pas une par passage du veilleur.
 */
export const AlertLogSchema = new Schema(
  {
    key: { type: String, required: true, unique: true },
    sentAt: { type: Date, required: true },
  },
  { timestamps: false },
);
export type AlertLog = InferSchemaType<typeof AlertLogSchema>;

/**
 * « Traité » sur un signal de la file de travail : la clé est l'id STABLE du
 * signal, l'effet est temporaire (le signal réapparaît après quelques jours si
 * la cause persiste — un impayé « traité » qui dure n'est pas traité).
 */
export const SignalDismissalSchema = new Schema(
  {
    key: { type: String, required: true, unique: true },
    at: { type: Date, required: true },
    actorEmail: { type: String, default: '' },
  },
  { timestamps: false },
);
export type SignalDismissal = InferSchemaType<typeof SignalDismissalSchema>;

// ─────────────────────────────────────────────────────────────
// platformSettings — les réglages de NOTRE plateforme (document unique)
// ─────────────────────────────────────────────────────────────

/**
 * Les quatre liens, un par réseau.
 *
 * `satisfies Record<SocialNetwork, …>` n'est pas décoratif : c'est ce qui fait
 * échouer la compilation le jour où un cinquième réseau entre dans
 * `SOCIAL_NETWORKS` sans que le modèle le suive. Sans lui, le contrat
 * accepterait le nouveau lien et la base le jetterait en silence (`strict`
 * mode de Mongoose supprime les clés inconnues) — un lien saisi, enregistré
 * « avec succès », et introuvable au rechargement.
 *
 * `default: null` et non `''` : `null` est la valeur qui signifie « pas de
 * compte », et c'est elle seule que la vitrine sait ne pas afficher.
 */
const socialLinkFields = {
  instagram: { type: String, default: null },
  tiktok: { type: String, default: null },
  facebook: { type: String, default: null },
  linkedin: { type: String, default: null },
} satisfies Record<SocialNetwork, { type: StringConstructor; default: null }>;

/**
 * ═══ UN RÉGLAGE DE PLATEFORME EST UN DOCUMENT, PAS UNE COLLECTION DE LIGNES ═══
 *
 * Il n'existe qu'une seule Snack Manager : ces réglages n'ont ni `tenantId`,
 * ni raison d'exister en plusieurs exemplaires. Encore faut-il que le
 * deuxième exemplaire soit IMPOSSIBLE et non simplement improbable — sinon un
 * `create()` écrit à la place d'un `updateOne(…, { upsert: true })`, un jour
 * de correction rapide, laisse deux documents en base. À partir de là tout
 * dépend de celui que la lecture ramène en premier : la vitrine affiche les
 * anciens liens, l'écran du CRM montre les nouveaux, et personne ne comprend
 * pourquoi la modification « n'a pas pris ».
 *
 * D'où la forme retenue : LA CLÉ PRIMAIRE EST UNE CONSTANTE. `_id` vaut
 * `PLATFORM_SETTINGS_ID` (`'platform'`), imposé par `default` et verrouillé
 * par `enum`. MongoDB garantit l'unicité de `_id` par construction — sans
 * index supplémentaire à créer, sans `partialFilterExpression` à régler, et
 * sans qu'aucun chemin d'écriture puisse y échapper : une seconde insertion
 * lève une erreur de clé dupliquée, et un `_id` inventé est refusé par la
 * validation Mongoose avant même de partir.
 *
 * Les alternatives, et pourquoi elles perdent :
 *   · un champ `key` avec index unique → un index de plus, et un document
 *     sans `key` passe quand même (`sparse` n'exclut que les champs absents) ;
 *   · un singleton porté par le tenant → faux : ces réglages n'appartiennent
 *     à aucun restaurant, les rattacher à l'un d'eux serait un contresens que
 *     la première migration multi-tenant paierait ;
 *   · une collection libre avec « on lit le plus récent » → c'est la version
 *     déguisée du bug ci-dessus.
 *
 * ═══ ET POURQUOI DES RUBRIQUES ═══
 *
 * `social` est un sous-objet nommé, pas quatre champs à la racine. D'autres
 * réglages de plateforme viendront (nom affiché, adresse de contact) : ils
 * arriveront comme `brand`, `contact`… chacun dans sa rubrique. Le document
 * reste lisible, et le PATCH d'une rubrique ne peut pas toucher aux autres.
 * Ce qui n'en fait pas un fourre-tout : n'entre ici que ce qui concerne la
 * PLATEFORME elle-même. Tout ce qui appartient à un restaurant reste dans
 * `TenantSchema`, tout ce qui relève de l'environnement (clés d'API, URL de
 * service) reste dans les variables d'environnement — ce sont des secrets de
 * déploiement, pas des réglages qu'on édite depuis un écran.
 */
export const PlatformSettingsSchema = new Schema(
  {
    _id: {
      type: String,
      default: PLATFORM_SETTINGS_ID,
      enum: [PLATFORM_SETTINGS_ID],
    },
    social: { type: new Schema(socialLinkFields, { _id: false }), default: () => ({}) },
  },
  { timestamps: true, versionKey: false },
);
export type PlatformSettingsDoc = InferSchemaType<typeof PlatformSettingsSchema>;

// ─────────────────────────────────────────────────────────────
// reviews — avis clients
// ─────────────────────────────────────────────────────────────

export const ReviewSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, required: true, index: true },
    orderId: { type: Schema.Types.ObjectId, default: null },
    author: { type: String, required: true },
    rating: { type: Number, min: 1, max: 5, required: true },
    text: { type: String, default: '' },
    source: { type: String, enum: ['online', 'google', 'manual'], default: 'online' },
    reply: {
      type: new Schema({ text: String, at: Date, by: String }, { _id: false }),
      default: null,
    },
  },
  { timestamps: true },
);
ReviewSchema.index({ tenantId: 1, createdAt: -1 });
export type Review = InferSchemaType<typeof ReviewSchema>;

// ─────────────────────────────────────────────────────────────
// promotions
// ─────────────────────────────────────────────────────────────

export const PromotionSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, required: true, index: true },
    name: { type: String, required: true },
    description: { type: String, default: '' },
    kind: { type: String, enum: ['percent', 'amount', 'offered_item'], required: true },
    value: { type: Number, default: 0 }, // % ou centimes selon kind
    code: { type: String, default: null },
    channels: { type: [String], default: ['online', 'pos'] },
    startsAt: { type: Date, default: null },
    endsAt: { type: Date, default: null },
    active: { type: Boolean, default: true },
    usageCount: { type: Number, default: 0 },
  },
  { timestamps: true },
);
export type Promotion = InferSchemaType<typeof PromotionSchema>;

// ─────────────────────────────────────────────────────────────
// screens — Menu Board : les écrans TV accrochés en salle
// ─────────────────────────────────────────────────────────────

/**
 * Une scène de la playlist. Aucun contenu n'est recopié ici : une scène
 * DÉSIGNE (une catégorie, des produits) et le contenu est résolu à l'affichage.
 * Sans ça, changer un prix obligerait à repasser sur chaque écran.
 */
const SceneSub = new Schema(
  {
    kind: { type: String, enum: ['category', 'promo', 'featured', 'custom'], required: true },
    categoryId: { type: Schema.Types.ObjectId, ref: 'Category', default: null },
    productIds: { type: [Schema.Types.ObjectId], default: [] },
    title: { type: String, default: null },
    durationMs: { type: Number, default: 10000 },
  },
  { _id: false },
);

export const ScreenSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, required: true, index: true },
    name: { type: String, required: true }, // « Écran comptoir gauche »
    // Code d'appairage à 6 caractères non ambigus (ni I, ni O, ni 0, ni 1) :
    // le gérant le lit sur le téléviseur et le recopie sur son téléphone.
    // `null` une fois l'écran appairé — un code qui traîne est un secret exposé.
    pairingCode: { type: String, default: null },
    pairingCodeExpiresAt: { type: Date, default: null },
    paired: { type: Boolean, default: false },
    // Secret long remis À L'APPAIRAGE et jamais renvoyé ensuite : c'est la seule
    // identité de l'écran, qui n'a ni compte ni mot de passe.
    deviceToken: { type: String, default: null },
    orientation: { type: String, enum: ['landscape', 'portrait'], default: 'landscape' },
    playlist: { type: [SceneSub], default: [] },
    theme: { type: String, enum: ['brand', 'dark', 'light'], default: 'brand' },
    // Dernier battement de cœur — source du « hors ligne depuis 20 min ».
    lastSeenAt: { type: Date, default: null },
    active: { type: Boolean, default: true },
    // Dernière révocation prononcée depuis le back-office interne (clé HDMI
    // volée, écran remplacé). Le détail « qui, quand, pourquoi » vit dans
    // `adminLogs` ; ces deux champs ne sont là que pour l'afficher sur la
    // fiche de l'écran sans relire tout le journal.
    revokedAt: { type: Date, default: null },
    revokedReason: {
      type: String,
      enum: ['perte', 'vol', 'panne', 'remplacement', null],
      default: null,
    },
  },
  { timestamps: true },
);
ScreenSchema.index({ tenantId: 1, createdAt: -1 });
/**
 * Index PARTIEL, et non `sparse`.
 *
 * `sparse` n'exclut que les documents où le champ est ABSENT — or le défaut
 * écrit explicitement `null`. Deux écrans non appairés portaient donc tous
 * deux `deviceToken: null` et entraient en collision : impossible de créer un
 * second écran. Le filtre partiel n'indexe que les jetons réellement émis.
 */
ScreenSchema.index(
  { deviceToken: 1 },
  { unique: true, partialFilterExpression: { deviceToken: { $type: 'string' } } },
);
ScreenSchema.index({ pairingCode: 1 }, { sparse: true });
export type Screen = InferSchemaType<typeof ScreenSchema>;

// ─────────────────────────────────────────────────────────────
// devices — les appareils de terrain : caisses et écrans cuisine
// ─────────────────────────────────────────────────────────────

/**
 * Une tablette de comptoir ou de piano.
 *
 * Elle n'a ni compte, ni mot de passe : son `deviceToken` EST son identité, et
 * c'est lui qui porte l'établissement. Sans cette collection, la caisse
 * embarquait le slug du restaurant en dur dans son code — un seul client
 * possible par binaire.
 *
 * Structure volontairement CALQUÉE sur `screens` : mêmes noms de champs,
 * mêmes index, même cycle de vie du code d'appairage. Deux mécanismes
 * d'appairage divergents dans un même produit, c'est deux fois plus de support
 * au téléphone.
 */
export const DeviceSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, required: true, index: true },
    name: { type: String, required: true }, // « Caisse comptoir », « Écran cuisine »
    kind: { type: String, enum: ['pos', 'kds'], required: true },
    // Code à 6 caractères non ambigus (ni I, ni O, ni 0, ni 1), lu dans le
    // back-office et recopié sur la tablette. `null` une fois appairé.
    pairingCode: { type: String, default: null },
    pairingCodeExpiresAt: { type: Date, default: null },
    paired: { type: Boolean, default: false },
    // Secret long remis À L'APPAIRAGE et jamais renvoyé ensuite.
    deviceToken: { type: String, default: null },
    // Dernier battement de cœur — source du « hors ligne depuis 12 min ».
    lastSeenAt: { type: Date, default: null },
    active: { type: Boolean, default: true },
    // Dernière révocation prononcée depuis le back-office interne (tablette
    // perdue ou volée). Le détail « qui, quand, pourquoi » vit dans
    // `adminLogs` ; ces deux champs ne sont là que pour l'afficher sur la
    // fiche de l'appareil sans relire tout le journal.
    revokedAt: { type: Date, default: null },
    revokedReason: {
      type: String,
      enum: ['perte', 'vol', 'panne', 'remplacement', null],
      default: null,
    },
  },
  { timestamps: true },
);
DeviceSchema.index({ tenantId: 1, createdAt: -1 });
/**
 * Index PARTIEL, et non `sparse` — même piège que sur les écrans : le défaut
 * écrit explicitement `null`, si bien que deux appareils non appairés
 * entreraient en collision sur un index unique classique.
 */
DeviceSchema.index(
  { deviceToken: 1 },
  { unique: true, partialFilterExpression: { deviceToken: { $type: 'string' } } },
);
DeviceSchema.index({ pairingCode: 1 }, { sparse: true });
export type Device = InferSchemaType<typeof DeviceSchema>;

// ─────────────────────────────────────────────────────────────
// adminLogs — journal d'administration Snack Manager, append-only
// ─────────────────────────────────────────────────────────────

/**
 * Ce que l'ÉQUIPE SM fait aux comptes de ses clients.
 *
 * À ne pas confondre avec `auditLogs`, qui trace ce que fait le PERSONNEL d'un
 * restaurant dans sa propre caisse (annulations, remises — socle NF525). Deux
 * publics, deux responsabilités, deux collections : mélanger les deux rendrait
 * le journal d'un restaurateur illisible et le nôtre incontrôlable.
 *
 * Nous agissons sur l'outil de travail d'un commerçant : suspendre son accès,
 * couper une tablette, changer sa formule. Chaque geste doit pouvoir être
 * reconstitué — qui, quoi, sur quel établissement, quand, pourquoi.
 *
 * `actorEmail` est DÉNORMALISÉ volontairement : un journal qui se relit à
 * travers une jointure change de contenu quand un compte d'équipe est renommé
 * ou supprimé. Ce qui est écrit reste écrit.
 */
export const AdminLogSchema = new Schema(
  {
    at: { type: Date, default: Date.now, required: true },
    /** L'humain de l'équipe SM (rôle `sm_admin`) — jamais « system ». */
    actorId: { type: Schema.Types.ObjectId, required: true },
    actorEmail: { type: String, default: '' },
    action: {
      type: String,
      // RECOPIE de `ADMIN_LOG_ACTIONS` (@sm/contracts) : toute action ajoutée
      // là-bas doit l'être ici, sinon l'écriture tombe en ValidationError APRÈS
      // la mutation qu'elle devait tracer. `admin.test.ts` épingle l'égalité
      // des deux listes.
      enum: [
        'tenant.create',
        'tenant.suspend',
        'tenant.reactivate',
        'tenant.plan_change',
        'tenant.note',
        'tenant.detail_view',
        'tenant.owner_reset',
        'device.revoke',
        'screen.revoke',
        'invoice.issue',
        'invoice.pay',
        'invoice.cancel',
        'platform.social_change',
      ],
      required: true,
    },
    /**
     * L'ÉTABLISSEMENT VISÉ — exigé, SAUF pour une action de plateforme.
     *
     * Les actions `platform.*` portent sur Snack Manager elle-même (les liens
     * de réseaux sociaux affichés sur notre vitrine) : elles ne visent aucun
     * restaurant, et leur en inventer un serait un mensonge dans le seul
     * registre qu'on ouvre en cas de litige.
     *
     * `required` est donc une FONCTION plutôt qu'un `false` généreux. La
     * différence est tout l'intérêt du champ : une suspension écrite sans
     * `tenantId` — un identifiant perdu en chemin, un appel mal câblé — reste
     * refusée à l'écriture, comme avant. Passer le champ à `required: false`
     * pour faire de la place à la plateforme aurait ouvert la porte à des
     * lignes « compte suspendu » qui ne disent pas de quel compte il s'agit.
     */
    tenantId: {
      type: Schema.Types.ObjectId,
      default: null,
      index: true,
      required: function (this: { action?: unknown }): boolean {
        return !isPlatformLogAction(this.action);
      },
    },
    /** Cible secondaire : identifiant d'appareil ou d'écran. */
    targetId: { type: String, default: null },
    reason: { type: String, default: '' },
    /** Contexte : ancienne/nouvelle formule, motif de révocation, note… */
    meta: { type: Schema.Types.Mixed, default: null },
  },
  { timestamps: false },
);
AdminLogSchema.index({ tenantId: 1, at: -1 });
AdminLogSchema.index({ at: -1 });

/**
 * APPEND-ONLY, garanti par l'ODM et pas seulement par la discipline.
 *
 * Un journal qu'on peut réécrire ne prouve rien. Ces hooks refusent toute
 * mise à jour et toute suppression : la seule écriture possible est une
 * insertion. Une correction se fait donc en AJOUTANT une ligne, comme dans un
 * livre de comptes — jamais en effaçant la précédente.
 *
 * (Cela ne remplace pas des droits Mongo restrictifs en production ; cela
 * ferme la porte au code applicatif, qui est la voie réellement empruntée.)
 */
const APPEND_ONLY_BLOCKED = [
  'updateOne',
  'updateMany',
  'replaceOne',
  'findOneAndUpdate',
  'findOneAndReplace',
  'deleteOne',
  'deleteMany',
  'findOneAndDelete',
] as const;

for (const op of APPEND_ONLY_BLOCKED) {
  // `as never` : la signature de `pre` est une union de littéraux que TS ne
  // peut pas réduire depuis une variable de boucle. Le comportement, lui, est
  // celui d'un middleware de requête ordinaire.
  AdminLogSchema.pre(op as never, function blockMutation() {
    throw new Error(`adminLogs est append-only : « ${op} » est refusé.`);
  });
}

export type AdminLog = InferSchemaType<typeof AdminLogSchema>;

// ─────────────────────────────────────────────────────────────
// invoices — facturation de l'abonnement Snack Manager
// ─────────────────────────────────────────────────────────────

/**
 * CE QUE NOUS FACTURONS À NOS CLIENTS RESTAURATEURS.
 *
 * À ne confondre ni avec `orders` (ce qu'un restaurant encaisse auprès de ses
 * propres clients) ni avec `auditLogs` : ici, l'argent va du commerçant VERS
 * Snack Manager. C'est la pièce qui rend une suspension légitime — sans elle,
 * « impayé » n'est qu'une affirmation.
 *
 * TROIS PROPRIÉTÉS STRUCTURENT CE MODÈLE.
 *
 * 1. UNE PIÈCE COMPTABLE, PAS UNE LIGNE DE LOG. `number` vient d'une séquence
 *    continue tenue dans `counters` (`invoice:<année>`) et l'index unique
 *    ci-dessous interdit qu'un numéro serve deux fois. Une facture ne se
 *    supprime jamais : le statut passe à `annulee`, avec un motif, et le numéro
 *    reste consommé — un trou dans la numérotation est une question sans
 *    réponse le jour d'un contrôle.
 *
 * 2. `en_retard` FIGURE DANS L'ÉNUMÉRATION MAIS N'EST PAS ÉCRIT par l'API. Le
 *    retard est une fonction du temps : le figer en base le rendrait faux dès
 *    le lendemain matin sans une tâche de nuit pour le rafraîchir, et un impayé
 *    invisible est précisément ce qu'on cherche à supprimer. Il est recalculé à
 *    chaque lecture (`effectiveInvoiceStatus`, @sm/contracts). La valeur reste
 *    acceptée pour qu'une future relance automatique puisse la persister sans
 *    migration.
 *
 * 3. LA PÉRIODE EST UN MOIS CALENDAIRE EN UTC, bornes incluses des deux côtés :
 *    deux mois consécutifs ne se chevauchent pas et ne laissent pas de trou.
 *    Le sous-schéma est explicite (et non un objet imbriqué implicite) pour que
 *    Mongoose infère des champs NON nullables côté TypeScript — même raison que
 *    pour `totals` et `account`.
 */
export const InvoiceSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, required: true, index: true },
    /** `SM-2026-0004` — séquence annuelle, globale au parc, sans trou. */
    number: { type: String, required: true },
    kind: {
      type: String,
      enum: ['abonnement', 'mise_en_place', 'option', 'autre'],
      default: 'abonnement',
      required: true,
    },
    /** Libellé lisible : « Abonnement Complet — septembre 2026 ». */
    label: { type: String, default: '' },
    period: {
      type: new Schema(
        {
          start: { type: Date, required: true },
          end: { type: Date, required: true },
        },
        { _id: false },
      ),
      required: true,
    },
    /**
     * Montant en CENTIMES, comme partout ailleurs.
     *
     * NE SE LIT JAMAIS SEUL : c'est `vat.amountsAre` qui dit s'il est hors
     * taxes ou toutes taxes comprises. Un montant nu dans une collection de
     * factures est exactement l'ambiguïté qui produit une erreur de
     * déclaration — celle qu'on ne découvre qu'au contrôle.
     */
    amountCents: { type: Number, required: true, min: 0 },
    /**
     * LE RÉGIME DE TVA DE LA PIÈCE, FIGÉ À SON ÉMISSION.
     *
     * Il est stocké SUR LA FACTURE, et non lu dans la configuration au moment
     * de l'impression, pour une raison qui tient en une phrase : une facture de
     * l'an dernier ne se recalcule pas au taux de cette année. Le jour où le
     * taux change — ou celui où l'éditeur bascule en franchise en base —, les
     * pièces déjà émises continuent de dire ce qu'elles ont dit au client, et
     * seules les suivantes portent le nouveau régime.
     *
     * ─── LES PIÈCES ÉMISES AVANT CE CHAMP ───
     *
     * Elles ne portent RIEN : la collection ne stockait qu'un montant. Elles
     * sont lues au défaut documenté `LEGACY_INVOICE_VAT` (@sm/contracts), qui
     * décrit le régime sous lequel elles ont réellement été facturées, et la
     * lecture le signale (`InvoiceTotals.stamped` vaut alors `false`). Aucune
     * migration n'écrit à leur place : réécrire une pièce comptable pour lui
     * faire dire ce qu'un défaut sait déjà déduire n'ajouterait pas une
     * information, seulement une écriture qu'on ne pourrait plus distinguer
     * d'une émission d'époque.
     */
    vat: {
      type: new Schema(
        {
          /** Taux en POURCENT — `20`, `10`, `5.5`, `0` (franchise en base). */
          ratePercent: { type: Number, required: true, min: 0 },
          /** Ce que vaut `amountCents` : hors taxes chez nous. */
          amountsAre: { type: String, enum: ['ht', 'ttc'], required: true },
        },
        { _id: false },
      ),
      // Le défaut vient de @sm/contracts, jamais recopié ici : deux endroits
      // qui décident du taux, c'est un jour où ils diffèrent.
      default: () => ({ ...SM_INVOICE_VAT }),
      required: true,
    },
    status: {
      type: String,
      enum: ['brouillon', 'envoyee', 'en_retard', 'payee', 'annulee'],
      default: 'brouillon',
      required: true,
    },
    /** Date d'envoi au client — `null` tant que la pièce est un brouillon. */
    issuedAt: { type: Date, default: null },
    dueAt: { type: Date, required: true },
    paidAt: { type: Date, default: null },
    /** Comment l'argent est arrivé — `null` tant que rien n'est encaissé. */
    method: {
      type: String,
      enum: ['prelevement', 'virement', 'carte', 'cheque', null],
      default: null,
    },
    cancelledAt: { type: Date, default: null },
    cancelReason: { type: String, default: '' },
  },
  { timestamps: true },
);
/** Le numéro identifie la pièce : deux factures ne peuvent pas le partager. */
InvoiceSchema.index({ number: 1 }, { unique: true });
/** Fiche d'un client : son historique, échéance la plus récente en tête. */
InvoiceSchema.index({ tenantId: 1, dueAt: -1 });
/** File des impayés du parc : on balaie par statut, du plus ancien au plus récent. */
InvoiceSchema.index({ status: 1, dueAt: 1 });
/** Garde-fou anti-double-facturation : un abonnement par client et par période. */
InvoiceSchema.index({ tenantId: 1, kind: 1, 'period.start': 1 });
export type Invoice = InferSchemaType<typeof InvoiceSchema>;

// ─────────────────────────────────────────────────────────────
// Registre des modèles (consommé par l'API Nest et le seed)
// ─────────────────────────────────────────────────────────────

export const MODELS = {
  Tenant: { name: 'Tenant', schema: TenantSchema, collection: 'tenants' },
  User: { name: 'User', schema: UserSchema, collection: 'users' },
  Staff: { name: 'Staff', schema: StaffSchema, collection: 'staff' },
  Shift: { name: 'Shift', schema: ShiftSchema, collection: 'shifts' },
  PlannedShift: {
    name: 'PlannedShift',
    schema: PlannedShiftSchema,
    collection: 'plannedshifts',
  },
  Category: { name: 'Category', schema: CategorySchema, collection: 'categories' },
  Product: { name: 'Product', schema: ProductSchema, collection: 'products' },
  Order: { name: 'Order', schema: OrderSchema, collection: 'orders' },
  Counter: { name: 'Counter', schema: CounterSchema, collection: 'counters' },
  AuditLog: { name: 'AuditLog', schema: AuditLogSchema, collection: 'auditlogs' },
  AdminLog: { name: 'AdminLog', schema: AdminLogSchema, collection: 'adminlogs' },
  Invoice: { name: 'Invoice', schema: InvoiceSchema, collection: 'invoices' },
  Lead: { name: 'Lead', schema: LeadSchema, collection: 'leads' },
  ErrorEvent: { name: 'ErrorEvent', schema: ErrorEventSchema, collection: 'errorevents' },
  AlertLog: { name: 'AlertLog', schema: AlertLogSchema, collection: 'alertlogs' },
  SignalDismissal: {
    name: 'SignalDismissal',
    schema: SignalDismissalSchema,
    collection: 'signaldismissals',
  },
  Review: { name: 'Review', schema: ReviewSchema, collection: 'reviews' },
  Promotion: { name: 'Promotion', schema: PromotionSchema, collection: 'promotions' },
  Screen: { name: 'Screen', schema: ScreenSchema, collection: 'screens' },
  Device: { name: 'Device', schema: DeviceSchema, collection: 'devices' },
  // Document unique, hors tenant : l'enregistrer ici suffit à le rendre
  // injectable partout (`DatabaseModule` déclare tout `MODELS`), il n'y a donc
  // aucun `MongooseModule.forFeature` à ajouter dans le module qui l'utilisera.
  PlatformSettings: {
    name: 'PlatformSettings',
    schema: PlatformSettingsSchema,
    collection: 'platformsettings',
  },
} as const;
