import { Schema, type InferSchemaType } from 'mongoose';
import { InvoiceIssuanceSchema, InvoicePendingSchema } from './invoice-issuance.schema';
import { OrderCapacityClaimSchema, OrderCapacityDaySchema, ORDER_CAPACITY_INDEXES } from './order-capacity.schema';
import {
  ADMIN_LOG_ACTIONS,
  AUDIT_AUTHOR_MEANS,
  BRAND_MODES,
  BRAND_MOTIONS,
  BRAND_SHAPES,
  CAPACITES,
  EMPREINTE_RE,
  HEX,
  LAITON,
  MEDIA_FORMATS_ADMIS,
  MEDIA_GENRES,
  MEDIAS_PAR_PRODUIT_MAX,
  ORIGINES_MEDIA,
  PLATFORM_SETTINGS_ID,
  PRESENTATIONS_ENTETE,
  PRESET_KEYS,
  SENS_DEROGATION,
  SM_INVOICE_VAT,
  SCENOGRAPHIES,
  SCREEN_CORNERS,
  SCREEN_MOTIONS,
  SCREEN_PRICE_SCALES,
  FEATURED_PRODUCTS_MAX,
  STOCKAGES_MEDIA,
  TENANT_AUDIT_ACTIONS,
  TYPE_PAIR_KEYS,
  USER_ROLES,
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

function hidePrivateOrderFields(
  _document: unknown,
  returned: Record<string, unknown>,
): Record<string, unknown> {
  delete returned.loyaltyMemberId;
  delete returned.loyaltyEarnOperationId;
  delete returned.loyaltyActorRef;
  delete returned.loyaltyDeviceRef;
  delete returned.loyaltyEarnState;
  delete returned.loyaltyEarnAttempts;
  delete returned.loyaltyEarnLastError;
  delete returned.loyaltyEarnCompletedAt;
  delete returned.loyaltyEarnNextAttemptAt;
  delete returned.loyaltyEarnLeaseUntil;
  delete returned.paymentFlow;
  delete returned.counterCollection;
  delete returned.publicRecovery;
  return returned;
}

function hidePrivateAdmissionFields(_document: unknown, returned: Record<string, unknown>): Record<string, unknown> {
  delete returned.kind;
  delete returned.channel;
  delete returned.proofHash;
  delete returned.payloadHash;
  delete returned.snapshot;
  delete returned.validationOwner;
  delete returned.capacity;
  return returned;
}

// ─────────────────────────────────────────────────────────────
// Le masque d'identité — cinq rôles stockés, tout le reste dérivé
// (packages/contracts/src/marque.ts). `null` tant que le tenant n'a pas
// été repris : le résolveur retombe alors sur Nuit + brandColor + logoUrl.
// ─────────────────────────────────────────────────────────────

/**
 * DÉFENSE EN PROFONDEUR — la base refuse aussi ce que le contrat refuse.
 *
 * Le contrat (`marque.ts`) rejette déjà `bleu` et `javascript:…` sur toutes les
 * routes. Mais `admin-cli`, un shell mongo et les scripts à venir écrivent SANS
 * zod : sans contrainte ici, la base accepterait une couleur illisible ou un
 * `src` dangereux — que le repli Nuit masquerait ensuite à chaque lecture, donc
 * sans que personne le voie. `HEX` est importé du contrat ; la règle d'image y
 * est plus riche (`ImageUrl` : URL, 500 caractères, http(s)) mais n'y est pas
 * exportée, et la base en garde la moitié qui compte à l'écriture. Le jour où
 * le contrat l'exporte, cette constante est le seul point à supprimer.
 *
 * Ces validateurs ne s'exécutent que sur un document Mongoose (`save`,
 * `validateSync`) et sur un `updateOne` lancé avec `runValidators`.
 */
const IMAGE_URL = /^https?:\/\//i;
const COULEUR = [HEX, 'Couleur attendue au format #rrggbb'] as const;
const IMAGE = {
  match: [IMAGE_URL, 'URL http(s) attendue'] as const,
  maxlength: 500,
};

const LogoPair = new Schema(
  {
    light: { type: String, default: null, ...IMAGE },
    dark: { type: String, default: null, ...IMAGE },
  },
  { _id: false },
);

export const BrandSub = new Schema(
  {
    mode: { type: String, enum: [...BRAND_MODES], required: true },
    palette: {
      type: new Schema(
        {
          ground: { type: String, required: true, match: COULEUR },
          surface: { type: String, required: true, match: COULEUR },
          ink: { type: String, required: true, match: COULEUR },
          accent: { type: String, required: true, match: COULEUR },
          onAccent: { type: String, required: true, match: COULEUR },
        },
        { _id: false },
      ),
      required: true,
    },
    type: {
      type: new Schema(
        { pair: { type: String, enum: [...TYPE_PAIR_KEYS], required: true } },
        { _id: false },
      ),
      required: true,
    },
    shape: { type: String, enum: [...BRAND_SHAPES], required: true },
    motion: { type: String, enum: [...BRAND_MOTIONS], required: true },
    logo: {
      type: new Schema(
        {
          mark: { type: LogoPair, required: true },
          lockup: { type: LogoPair, required: true },
        },
        { _id: false },
      ),
      required: true,
    },
    hero: { type: String, default: null, ...IMAGE },
    preset: {
      type: String,
      enum: [...PRESET_KEYS, null],
      default: null,
    },
    /*
     * CE QUE L'EN-TÊTE MONTRE — le symbole et le nom, ou le logo horizontal.
     *
     * `default` et non `required` : tous les masques déjà stockés sont
     * antérieurs à ce champ. Mongo le posera à leur prochaine écriture, et le
     * contrat le pose à la lecture — un masque ancien n'est donc jamais
     * invalide, il est simplement lu avec le comportement d'avant.
     */
    entete: {
      type: String,
      enum: [...PRESENTATIONS_ENTETE],
      default: 'verrou',
    },
  },
  { _id: false },
);

export const TenantSchema = new Schema(
  {
    slug: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    logoUrl: { type: String, default: null },
    // Le laiton vient du CONTRAT : c'est la même constante que le repli du
    // masque (`marqueDeRepli`) et que l'accent de la direction Nuit. Recopiée
    // ici, elle divergeait le jour où la marque changeait de teinte.
    brandColor: { type: String, default: LAITON },
    brand: { type: BrandSub, default: null },
    address: { type: String, default: '' },
    phones: { type: [String], default: [] },
    /**
     * LE CONTACT DU GÉRANT — celui qu'on appelle, pas celui qu'on affiche.
     *
     * À ne pas confondre avec `phones` juste au-dessus, qui porte les numéros
     * PUBLICS du restaurant : une ligne de comptoir décroche en plein coup de
     * feu, ou pas du tout. Quand l'équipe Snack Manager doit joindre le
     * restaurateur — impayé, incident, relance — c'est ce numéro-là qu'il lui
     * faut.
     *
     * L'information existait pourtant : le lead la porte depuis la
     * prospection, et la conversion la JETAIT. La fiche client du CRM affichait
     * donc un bouton « Appeler » qui ne s'affichait jamais, faute de numéro à
     * composer, et le commercial rouvrait le pipeline pour retrouver ce qu'il
     * venait de signer.
     */
    contact: {
      name: { type: String, default: '' },
      phone: { type: String, default: '' },
      email: { type: String, default: '' },
    },
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
    // `null` admis depuis l'Atelier : un client peut n'acheter QUE des
    // services (site, réseaux, présence) — aucune formule logicielle alors.
    plan: { type: String, enum: ['essentiel', 'complet', 'boost', null], default: 'essentiel' },
    founderSeat: { type: Boolean, default: false },
    /**
     * Fin de la remise fondateur — douze mois après la signature.
     *
     * `founderSeat` dit le DROIT, ce champ dit le TERME. Les deux sont
     * nécessaires : un booléen ne peut pas expirer, et c'est exactement ce qui
     * a fait vivre pendant des mois une promesse de « tarif gelé à vie » que
     * personne n'appliquait — un gel sans terme est une dette perpétuelle qui
     * pèse sur chaque révision de grille.
     *
     * Posé une seule fois, à la conversion, et jamais recalculé : la remise
     * d'un client se lit sur son contrat, pas sur l'horloge du serveur.
     * `null` quand il n'y a pas de remise — l'absence se lit, elle ne se déduit
     * pas d'un champ manquant.
     */
    founderUntil: { type: Date, default: null },
    /**
     * La remise fondateur MENSUELLE, figée au montant du contrat signé.
     *
     * Un montant et non un taux, et c'est tout l'objet du champ. La remise
     * vendue porte sur « tout ce qu'on signe aujourd'hui » : un pourcentage
     * appliqué à l'offre courante remiserait aussi le service ajouté le
     * onzième mois, et permettrait à un fondateur de relancer sa remise en
     * changeant d'offre. Un montant figé, lui, ne bouge pas quand l'offre
     * grossit — le supplément se paie donc plein tarif de lui-même.
     *
     * Posé une fois à la conversion, jamais recalculé, jamais touché par un
     * changement d'offre. `null` quand il n'y a pas de remise ; `0` serait une
     * remise de zéro euro, ce qui n'est pas la même chose.
     */
    founderDiscountCents: { type: Number, default: null },
    /**
     * Le module de commande en ligne, vendu à part de la formule — il se
     * greffe sur un abonnement OU sur le site existant du restaurateur.
     *
     * Ce champ a manqué pendant tout le développement de l'Atelier : la
     * proposition le portait, le devis le chiffrait, les brouillons de facture
     * le facturaient, puis la signature le JETAIT. En aval, toute la
     * facturation retombait sur `plan` seul — un client Complet avec le module
     * était facturé 159 € au lieu de 238 €.
     *
     * À ne jamais confondre avec `settings.onlineOrderingPaused`, qui est une
     * pause d'exploitation décidée par le gérant un soir de coup de feu. Ici
     * c'est une SOUSCRIPTION.
     */
    onlineOrdering: { type: Boolean, default: false },
    onlineDelivery: { type: Boolean, default: false },
    standaloneLoyalty: { type: Boolean, default: false },
    websiteUrl: { type: String, default: null },
    delivery: {
      type: new Schema({
        enabled: { type: Boolean, default: false },
        zones: { type: [new Schema({
          id: { type: String, required: true },
          name: { type: String, required: true },
          postalCodes: { type: [String], required: true },
          feeCents: { type: Number, required: true, min: 0 },
          minimumOrderCents: { type: Number, required: true, min: 0 },
          freeDeliveryFromCents: {
            type: Number, default: null, min: 1, max: 100_000,
            validate: { validator: (value: number | null) => value === null || Number.isInteger(value), message: 'Seuil de gratuité entier requis' },
          },
        }, { _id: false })], default: [] },
        leadTimeMin: { type: Number, default: 45 },
        slotCapacity: { type: Number, default: 2 },
      }, { _id: false }),
      default: () => ({ enabled: false, zones: [], leadTimeMin: 45, slotCapacity: 2 }),
    },
    /**
     * LES DÉROGATIONS DE CAPACITÉ — l'exception commerciale, tracée.
     *
     * `plan` dit la formule, `onlineOrdering` dit l'option ; les capacités
     * EFFECTIVES s'en déduisent par le catalogue (`capacitesEffectives`,
     * @sm/contracts) et ne sont JAMAIS stockées — une copie en base se
     * désynchroniserait du catalogue au premier changement d'offre, en
     * silence, sur les seuls tenants déjà créés.
     *
     * Reste ce qu'aucun catalogue ne peut porter : le cas particulier. Un geste
     * commercial, une période d'essai sur une option, un ancien client gardé
     * aux anciennes conditions, une fonction retirée le temps d'un litige. Sans
     * ce champ, chacun de ces cas se réglait en changeant la FORMULE du
     * client — ce qui fausse aussitôt sa facture et le MRR du CRM.
     *
     * `motif` et `auteur` sont exigés par le contrat, et ce n'est pas
     * décoratif : une capacité ouverte hors formule est un manque à gagner, une
     * capacité fermée malgré la formule est un litige. Dans les deux cas
     * quelqu'un demandera « pourquoi ? » six mois plus tard.
     *
     * Les énumérations viennent du CONTRAT, jamais recopiées : une capacité
     * ajoutée au produit doit être refusée ici tant qu'elle n'est pas au
     * catalogue. Elles ne s'exécutent toutefois qu'à `save()` et sur les
     * requêtes portant `runValidators` — la validation qui compte reste
     * `DerogationCapaciteSchema` à la frontière.
     */
    derogationsCapacite: {
      type: [
        new Schema(
          {
            capacite: { type: String, enum: CAPACITES, required: true },
            sens: { type: String, enum: SENS_DEROGATION, required: true },
            motif: { type: String, required: true },
            /** Qui l'a accordée — un membre de l'équipe Snack Manager, nommé. */
            auteur: { type: String, required: true },
            le: { type: Date, default: Date.now, required: true },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    /**
     * L'engagement signé : au mois, ou à l'année avec deux mois offerts.
     *
     * Nommé `billingCycle` et non `billing` parce que `billing` porte déjà
     * l'identité de facturation du restaurant (raison sociale, SIRET, TVA) —
     * deux notions voisines de nom, étrangères de nature.
     */
    billingCycle: { type: String, enum: ['mensuel', 'annuel'], default: 'mensuel' },
    /**
     * L'Atelier signé — les services vendus avec l'abonnement, posés à la
     * signature. Les factures disent ce qui a été FACTURÉ ; ce champ dit ce
     * qui est DÛ en travail (présence internet à tenir, publications à
     * sortir) : c'est lui que la fiche client lit pour répondre à « qui a
     * quoi ? » sans fouiller la facturation. Les prix, eux, restent dérivés
     * de la grille — jamais stockés.
     */
    atelier: {
      type: new Schema(
        {
          siteVitrine: { type: Boolean, default: false },
          refonteSite: { type: Boolean, default: false },
          identiteVisuelle: { type: Boolean, default: false },
          integrationCommande: { type: Boolean, default: false },
          presenceInternet: { type: Boolean, default: false },
          reseauxSociaux: { type: String, enum: ['hebdo', 'bihebdo', null], default: null },
          signedAt: { type: Date, required: true },
        },
        { _id: false },
      ),
      default: null,
    },
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
          /**
           * POURQUOI il est parti — la cause structurée, pour l'agrégation.
           *
           * `reason` juste au-dessus porte le détail en toutes lettres, et un
           * texte libre ne s'agrège pas : six départs donnent six phrases, et
           * aucun tableau. Or c'est la question qu'un éditeur doit pouvoir se
           * poser au bout d'un an — prix, complexité, fonction manquante ? —
           * et elle ne se répond qu'avec une cause.
           *
           * `null` sur les départs actés avant ce champ : l'absence se lit,
           * elle ne se devine pas d'un texte qu'on relirait à la main.
           */
          churnCause: {
            type: String,
            enum: ['prix', 'fermeture', 'concurrent', 'usage', 'manque', 'impaye', 'autre', null],
            default: null,
          },
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
      /**
       * L'objectif de recette du jour, en centimes — le curseur que le gérant
       * pose depuis son tableau de bord.
       *
       * SANS DÉFAUT, délibérément : zéro serait un objectif atteint dès
       * l'ouverture, et la jauge afficherait 100 % avant la première commande.
       * L'absence de valeur laisse le tableau de bord appliquer la sienne.
       *
       * Ce champ a vécu six semaines dans la liste blanche du service sans
       * exister ici : Mongoose en mode strict jetait le `$set` en silence, la
       * route répondait 200, et l'objectif disparaissait au rechargement.
       * `apps/api/src/modules/tenants/tenants.test.ts` verrouille désormais la
       * correspondance entre la liste blanche et ce schéma.
       */
      dailyGoalCents: { type: Number },
    },
    /**
     * NOTRE relation Stripe avec ce restaurant : c'est LUI qui nous paie
     * l'abonnement. À ne jamais confondre avec `encaissement` ci-dessous, où
     * c'est le CONSOMMATEUR qui paie LE RESTAURANT.
     */
    stripe: {
      customerId: { type: String, default: null },
      subscriptionId: { type: String, default: null },
    },
    /**
     * SON compte Stripe à lui — celui sur lequel ses clients paient leurs
     * commandes en ligne (charges directes, cf. @sm/contracts `encaissement`).
     *
     * Rien de secret n'entre ici : un identifiant de compte et les drapeaux
     * que Stripe nous rend. Les coordonnées bancaires, les pièces d'identité
     * et la lutte anti-blanchiment restent chez Stripe — c'est ce transfert de
     * responsabilité qui rend le montage tenable, et l'argent ne transite
     * JAMAIS par le compte de l'éditeur (ce serait un service de paiement,
     * réservé aux établissements agréés).
     *
     * `null` = pas raccordé : le restaurant encaisse au comptoir, et rien
     * n'est cassé pour autant.
     */
    encaissement: {
      type: new Schema(
        {
          accountId: { type: String, required: true },
          // Les trois drapeaux sont FAUX par défaut. Un défaut permissif
          // ferait croire qu'un restaurant encaisse alors que Stripe refuse
          // ses paiements — le client final verrait un formulaire de carte
          // qui échoue au dernier clic.
          chargesEnabled: { type: Boolean, default: false },
          payoutsEnabled: { type: Boolean, default: false },
          detailsSubmitted: { type: Boolean, default: false },
          raccordeLe: { type: Date, required: true },
          synchroniseLe: { type: Date, required: true },
        },
        { _id: false },
      ),
      default: null,
    },
  },
  { timestamps: true },
);
// La résolution d'un domaine personnalisé (public/resolve) cherche le tenant
// par `domains.hostname` À CHAQUE visite d'un site client dont le cache a
// expiré : sans index, c'est un balayage de la collection entière, alimenté
// en prime par le bruit des scans d'hôtes inconnus. Multiclé : un index par
// domaine rattaché, pas par tenant.
TenantSchema.index({ 'domains.hostname': 1 });

export type Tenant = InferSchemaType<typeof TenantSchema>;

// ─────────────────────────────────────────────────────────────
// users — comptes email + mot de passe (restaurant, équipe SM)
// ─────────────────────────────────────────────────────────────

export const UserSchema = new Schema(
  {
    /**
     * L'ADRESSE EST L'IDENTIFIANT DE CONNEXION, et son unicité est MONDIALE.
     *
     * `AuthService.login` cherche un compte par son seul e-mail, sans
     * établissement : deux documents portant la même adresse rendraient l'un
     * des deux au hasard du moteur, et la personne atterrirait un jour sur deux
     * dans le mauvais back-office. L'index unique n'est donc pas une hygiène de
     * base, c'est ce qui rend la connexion déterministe.
     *
     * Conséquence assumée : une adresse ne peut appartenir qu'à UN restaurant.
     * Le refus est rendu en clair par le CRM (`courrielDejaPris`,
     * @sm/contracts), qui nomme l'établissement propriétaire de l'adresse.
     */
    email: { type: String, required: true, unique: true, lowercase: true },
    passwordHash: { type: String, required: true },
    /**
     * QUATRE RÔLES, dont trois vivent dans un restaurant.
     *
     * `owner` naît à la signature et porte l'abonnement ; `cogerant` porte tout
     * l'opérationnel ; `comptable` ne lit que l'argent ; `sm_admin` est
     * l'équipe Snack Manager, sans établissement. L'énumération et ce qu'elle
     * implique se lisent dans `packages/contracts/src/comptes.ts` — cette liste
     * en est le miroir en base, et un test de contrat vérifie qu'elles ne
     * divergent pas.
     *
     * À NE PAS CONFONDRE avec `StaffSchema.role` (`gerant`, `caisse`,
     * `cuisine`) : ce sont des porteurs de code sur tablette, sans mot de passe.
     * `cogerant` s'écrit sans « é » et sans trait d'union précisément pour ne
     * jamais être lu comme le `gerant` de la tablette.
     */
    role: { type: String, enum: [...USER_ROLES], required: true },
    /**
     * L'ÉTABLISSEMENT DU COMPTE — `null` = équipe Snack Manager.
     *
     * UN SEUL, et c'est la couture que le chantier « appartenance » ouvrira :
     * ce champ deviendra alors une table `(compte, établissement, rôle)`,
     * permettant à une personne d'appartenir à plusieurs restaurants avec un
     * rôle propre à chacun. Rien n'est préparé ici pour ce jour-là — une
     * jointure inventée d'avance serait une jointure vide à maintenir.
     */
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', default: null },
    name: { type: String, default: '' },
    /**
     * Génération opaque des sessions email/mot de passe. Un changement de
     * secret la remplace et révoque immédiatement tous les JWT antérieurs.
     * `0` garde les comptes historiques connectables sans backfill.
     */
    sessionVersion: { type: String, default: '0' },
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
     * Version opaque des sessions PIN. Tout changement de rôle, PIN ou état
     * la remplace et rend immédiatement caducs les JWT déjà émis.
     * `0` est volontairement compatible avec les documents historiques.
     */
    sessionVersion: { type: String, default: '0' },
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
    featuredProductIds: {
      type: [{ type: Schema.Types.ObjectId, ref: 'Product' }],
      default: [],
      validate: {
        validator: (ids: unknown[]) => ids.length <= FEATURED_PRODUCTS_MAX && new Set(ids.map(String)).size === ids.length,
        message: 'Choisissez au plus trois produits distincts par catégorie',
      },
    },
    featuredRevision: { type: Number, default: 0, min: 0, validate: Number.isInteger },
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
    /**
     * LA CHAÎNE HÉRITÉE — lue en repli, PLUS JAMAIS écrite par une route.
     *
     * Elle porte les dix-neuf photos du pilote (`/photos/…`, posées par
     * `seed-photos.ts`). `ProductCreateSchema` et `ProductUpdateSchema` ne la
     * reçoivent plus : c'était une chaîne libre, sans validation d'URL ni de
     * protocole, qui contournait la liste blanche d'origines appliquée aux
     * images de marque. La photo se choisit désormais dans la médiathèque, et
     * `photoUrl` sort DÉRIVÉ de `medias[0]` (`photoUrlDe`, @sm/contracts).
     *
     * La colonne reste : la vider d'un coup viderait la carte du pilote en
     * service. C'est la reprise `backfill:medias` qui la remplace, produit par
     * produit, par une vraie référence de médiathèque.
     */
    photoUrl: { type: String, default: null },
    /**
     * LES PHOTOS DU PRODUIT — un à trois médias, le premier est le principal.
     *
     * Des RÉFÉRENCES, pas des copies : le même cliché sert plusieurs produits
     * (trois galettes sur la photo du panneau mural), survit au renommage du
     * plat et à sa mise hors carte, et se recadre une fois pour toutes les
     * surfaces. Un attribut de produit n'aurait aucune de ces propriétés.
     *
     * La borne de trois est portée ICI en plus du contrat : la base est aussi
     * écrite par l'admin-cli, par un shell et par les reprises, qui ne passent
     * pas par zod — même défense en profondeur que `IMAGE_URL` plus haut.
     */
    medias: {
      type: [{ type: Schema.Types.ObjectId, ref: 'Media' }],
      default: [],
      validate: {
        validator: (v: unknown[]) => !Array.isArray(v) || v.length <= MEDIAS_PAR_PRODUIT_MAX,
        message: `Un produit porte au plus ${MEDIAS_PAR_PRODUIT_MAX} photos`,
      },
    },
    order: { type: Number, default: 0 },
    active: { type: Boolean, default: true },
  },
  { timestamps: true, suppressReservedKeysWarning: true },
);
ProductSchema.index({ tenantId: 1, categoryId: 1, order: 1 });
export type Product = InferSchemaType<typeof ProductSchema>;

// ─────────────────────────────────────────────────────────────
// medias — la médiathèque d'un restaurant
// ─────────────────────────────────────────────────────────────

const PointInteretSub = new Schema(
  {
    x: { type: Number, default: 0.5, min: 0, max: 1 },
    y: { type: Number, default: 0.5, min: 0, max: 1 },
  },
  { _id: false },
);

/**
 * UN MÉDIA APPARTIENT AU RESTAURANT, PAS AU PRODUIT.
 *
 * Le même cliché sert en vignette carrée à la caisse, en carte sur la vitrine
 * et en seize neuvièmes au téléviseur ; il survit au produit qu'on renomme,
 * qu'on scinde en deux tailles ou qu'on retire de la carte pour l'hiver. D'où
 * une collection à lui, cloisonnée par `tenantId` comme toutes les autres.
 *
 * ─── L'EMPREINTE EST UNE CLÉ, PAS UNE MÉTADONNÉE ───
 *
 * `(tenantId, empreinte)` est UNIQUE, et c'est ce qui fait le dédoublonnage :
 * redéposer le même fichier retrouve la ligne existante au lieu d'en créer une
 * seconde et de payer deux fois le même objet. L'unicité est portée par la
 * BASE et pas seulement par le service — deux dépôts simultanés du même
 * fichier (deux onglets, deux postes) arrivent sinon tous les deux à la
 * conclusion « il n'existe pas encore ».
 *
 * L'index est PARTIEL : deux restaurants qui déposent la même photo de kebab
 * gardent chacun la leur (le cloisonnement passe avant l'économie d'un objet),
 * et une collection vide n'a pas à supporter un index sur un champ absent.
 */
export const MediaSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, required: true, index: true },
    /** `photo` est public, `document` ne l'est JAMAIS — cf. `MEDIA_GENRES_PUBLICS`. */
    genre: { type: String, enum: [...MEDIA_GENRES], required: true, default: 'photo' },
    /** SHA-256 tronqué à 128 bits, hexadécimal minuscule : l'adresse en dérive. */
    empreinte: {
      type: String,
      required: true,
      match: [EMPREINTE_RE, 'Empreinte de média invalide'],
    },
    type: { type: String, enum: [...MEDIA_FORMATS_ADMIS], required: true },
    octets: { type: Number, required: true, min: 1 },
    /** Lues dans les octets quand l'en-tête du format les donne. */
    largeur: { type: Number, default: null },
    hauteur: { type: Number, default: null },
    point: { type: PointInteretSub, default: () => ({ x: 0.5, y: 0.5 }) },
    /** Libre et facultatif : la surface retombe sur le nom du produit. */
    alt: { type: String, default: '', maxlength: 200 },
    /** `objet` : les octets sont chez nous. `heritee` : dans le paquet web. */
    stockage: { type: String, enum: [...STOCKAGES_MEDIA], required: true, default: 'objet' },
    origine: { type: String, enum: [...ORIGINES_MEDIA], required: true, default: 'depot' },
    /**
     * L'origine http(s) SOUS LAQUELLE le média a été déposé, validée contre la
     * liste blanche au moment du dépôt. Absolue pour la même raison que
     * `logoUrl` : caisse, cuisine et téléviseur sont d'autres origines.
     */
    base: { type: String, default: null, ...IMAGE },
    /** Le nom de fichier, pour les seuls médias hérités du pilote. */
    fichier: { type: String, default: null, maxlength: 200 },
    auteurId: { type: String, default: null },
    auteurNom: { type: String, default: '' },
  },
  { timestamps: true },
);
/** La LISTE du gérant : sa médiathèque, du plus récent au plus ancien. */
MediaSchema.index({ tenantId: 1, createdAt: -1 });
/** Le DÉDOUBLONNAGE, et il est unique — voir l'en-tête. */
MediaSchema.index({ tenantId: 1, empreinte: 1 }, { unique: true });
export type Media = InferSchemaType<typeof MediaSchema>;

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
    /** Preuve de reprise publique, atomique avec la vente ; jamais adoptée après création. */
    publicRecovery: {
      type: new Schema({
        version: { type: Number, enum: [1], required: true },
        proofHash: { type: String, match: /^[a-f0-9]{64}$/, required: true },
        payloadHash: { type: String, match: /^[a-f0-9]{64}$/, required: true },
      }, { _id: false }),
      default: null,
      select: false,
    },
    /**
     * Carte présentée AVANT la création de la vente.
     *
     * `select: false` évite d'exposer ce pseudonyme aux écrans cuisine et aux
     * listes de commandes ; seul l'adaptateur fidélité le relit explicitement.
     */
    loyaltyMemberId: { type: String, default: null, select: false },
    /**
     * Outbox embarqué dans la commande Mongo : la vente et l'intention de
     * gain naissent atomiquement. Un worker idempotent la consomme seulement
     * après `delivered + paid`.
     */
    loyaltyEarnOperationId: { type: String, default: null, select: false },
    loyaltyActorRef: { type: String, default: null, select: false },
    loyaltyDeviceRef: { type: String, default: null, select: false },
    loyaltyEarnState: {
      type: String,
      enum: ['pending', 'processing', 'completed', 'failed', 'cancelled', null],
      default: null,
      select: false,
    },
    loyaltyEarnAttempts: { type: Number, default: 0, min: 0, select: false },
    loyaltyEarnLastError: { type: String, default: null, select: false },
    loyaltyEarnCompletedAt: { type: Date, default: null, select: false },
    loyaltyEarnNextAttemptAt: { type: Date, default: null, select: false },
    loyaltyEarnLeaseUntil: { type: Date, default: null, select: false },
    channel: { type: String, enum: ['online', 'pos', 'phone'], required: true },
    type: { type: String, enum: ['surplace', 'emporter', 'pickup', 'delivery'], required: true },
    lines: { type: [OrderLineSub], required: true },
    // Sous-schémas explicites + required : sans cela, Mongoose 8.24 infère les
    // objets imbriqués comme optionnels et tout accès devient nullable côté TS.
    totals: {
      type: new Schema(
        {
          subtotal: { type: Number, required: true },
          deliveryFee: { type: Number, default: 0, min: 0 },
          /**
           * La remise portée par le ticket — geste commercial OU promotion.
           *
           * Les deux ne sont pas la même chose et le champ le dit : une remise
           * décidée au comptoir nomme l'ÉQUIPIER qui l'a accordée, PIN vérifié,
           * parce que c'est ce que NF525 veut pouvoir retrouver. Une promotion
           * applique une règle publiée par le restaurateur, que personne au
           * comptoir n'a décidée — la nommer d'un équipier ferait porter à
           * quelqu'un une décision qu'il n'a pas prise.
           *
           * Exactement l'un des deux est renseigné. `promotionId` est arrivé
           * avec l'application des promotions, jusque-là écrites en base et
           * jamais appliquées.
           */
          discount: {
            type: new Schema(
              {
                amount: Number,
                reason: String,
                staffId: { type: Schema.Types.ObjectId, default: null },
                promotionId: { type: Schema.Types.ObjectId, ref: 'Promotion', default: null },
              },
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
          /**
           * Le compte Stripe qui a RÉELLEMENT encaissé (charges directes).
           * `null` = encaissé avant Connect, sur le compte de la plateforme :
           * c'est la seule porte par laquelle l'historique reste remboursable,
           * et aucun chemin de création ne sait plus la fabriquer.
           */
          stripeAccountId: { type: String, default: null },
          refundedCents: { type: Number, default: 0, min: 0 },
          pendingRefundCents: { type: Number, default: 0, min: 0 },
          refundSyncVersion: { type: Number, default: 0, min: 0 },
          refunds: { type: [new Schema({
            id: { type: String, required: true },
            amountCents: { type: Number, required: true, min: 0 },
            status: { type: String, required: true },
            operationId: { type: String, default: null },
            reason: { type: String, default: '' },
          }, { _id: false })], default: [] },
        },
        { _id: false },
      ),
      required: true,
    },
    // One immutable collection receipt, committed atomically with payment.
    // No default receipt may manufacture an operator confirmation for history.
    counterCollection: {
      type: new Schema({
        operationId: { type: String, required: true },
        amountCents: { type: Number, required: true, min: 0, max: 100_000_000, validate: Number.isSafeInteger },
        tender: { type: String, enum: ['cash', 'card', 'meal_voucher'], required: true },
        cashReceivedCents: { type: Number, default: null, min: 0, max: 100_000_000, validate: (v: number | null) => v === null || Number.isSafeInteger(v) },
        changeGivenCents: { type: Number, default: null, min: 0, max: 100_000_000, validate: (v: number | null) => v === null || Number.isSafeInteger(v) },
        collectedAt: { type: Date, required: true },
        actor: { type: new Schema({
          sub: { type: String, required: true },
          kind: { type: String, enum: ['staff', 'user'], required: true },
          role: { type: String, enum: ['owner', 'cogerant', 'gerant', 'caisse'], required: true },
        }, { _id: false }), required: true },
        deviceId: { type: String, default: null },
      }, { _id: false }),
      default: null,
      select: false,
    },
    // Preuve privée persistée AVANT tout appel bancaire. Aucun défaut ne
    // convertit une ancienne commande en preuve d'absence de PaymentIntent.
    paymentFlow: {
      type: new Schema({
        version: { type: Number, enum: [1], required: true },
        origin: { type: String, enum: ['created_v1', 'adopted_intent', 'legacy_unknown'], required: true },
        phase: { type: String, enum: ['open', 'closing', 'closed', 'counter_ready', 'settled', 'review_required'], required: true },
        attempt: {
          type: new Schema({
            id: { type: String, required: true },
            accountId: { type: String, default: null },
            environment: { type: String, enum: ['test', 'live'], required: true },
            amountCents: { type: Number, min: 1, required: true, validate: Number.isSafeInteger },
            currency: { type: String, enum: ['eur'], required: true },
            idempotencyKey: { type: String, required: true },
            metadata: {
              type: new Schema({
                orderId: { type: String, required: true },
                tenantId: { type: String, required: true },
                orderNumber: { type: String, required: true },
              }, { _id: false }),
              required: true,
            },
            preparedAt: { type: Date, required: true },
            requestStartedAt: { type: Date, default: null },
            recoveryUntil: { type: Date, required: true },
          }, { _id: false }),
          default: null,
        },
        close: {
          type: new Schema({
            operationId: { type: String, required: true },
            // An old closure always means cancellation. A counter switch is a
            // distinct, immutable destination, never a reopened bank attempt.
            destination: { type: String, enum: ['cancel_order', 'counter'], default: 'cancel_order' },
            reason: { type: String, required: true },
            requestedBy: { type: String, required: true },
            requestedAt: { type: Date, required: true },
          }, { _id: false }),
          default: null,
        },
        providerStatus: { type: String, default: null },
        providerCheckedAt: { type: Date, default: null },
        reviewReason: { type: String, default: null },
      }, { _id: false }),
      default: null,
      select: false,
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
    delivery: {
      type: new Schema({
        address: { type: new Schema({
          line1: { type: String, required: true },
          line2: { type: String, default: '' },
          postalCode: { type: String, required: true },
          city: { type: String, required: true },
          country: { type: String, enum: ['FR'], default: 'FR' },
        }, { _id: false }), required: true },
        instructions: { type: String, default: '' },
        zoneId: { type: String, required: true },
        zoneName: { type: String, required: true },
        feeCents: { type: Number, required: true, min: 0 },
        estimatedMinutes: { type: Number, required: true },
        dispatchedAt: { type: Date, default: null },
        deliveredAt: { type: Date, default: null },
        driverName: { type: String, default: null },
      }, { _id: false }),
      default: null,
    },
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
  {
    timestamps: true,
    // Chaque `save()` inclut `__v` dans son filtre et l'incrémente. Deux
    // gestes concurrents sur le même ticket ne peuvent donc jamais s'écraser
    // silencieusement (ex. livrer pendant qu'une annulation est validée).
    optimisticConcurrency: true,
    // `select:false` ne s'applique qu'aux lectures Mongo. Un document tout
    // juste créé contient encore le champ en mémoire : ces transformations le
    // retirent aussi des réponses HTTP et de toute sérialisation accidentelle.
    toObject: { transform: hidePrivateOrderFields },
    toJSON: { transform: hidePrivateOrderFields },
  },
);
OrderSchema.index({ tenantId: 1, createdAt: -1 });
OrderSchema.index({ tenantId: 1, status: 1 });
OrderSchema.index({ tenantId: 1, clientId: 1 }, { unique: true }); // rejeu offline idempotent
OrderSchema.index(
  { tenantId: 1, loyaltyEarnOperationId: 1 },
  {
    unique: true,
    partialFilterExpression: { loyaltyEarnOperationId: { $type: 'string' } },
  },
);
OrderSchema.index({ loyaltyEarnState: 1, loyaltyEarnNextAttemptAt: 1, createdAt: 1 });
OrderSchema.index({ loyaltyEarnState: 1, loyaltyEarnLeaseUntil: 1 });
// Non unique : les commandes créées avant le champ portent toutes `null`, et
// un index unique les ferait entrer en collision. La collision de deux jetons
// de 192 bits tirés au hasard, elle, n'arrive pas.
OrderSchema.index({ trackingToken: 1 });
export type Order = InferSchemaType<typeof OrderSchema>;

/** Journal commun (collection historique conservée) : aucun TTL ne rouvre une clé incertaine. */
export const PublicOrderAdmissionSchema = new Schema({
  _id: { type: String, required: true },
  tenantId: { type: Schema.Types.ObjectId, required: true },
  clientId: { type: String, required: true },
  version: { type: Number, enum: [1], required: true },
  // Les anciens documents C01 sans kind restent publics. Le staff ne crée
  // aucune preuve de reprise publique ; l'origine ne fait pas partie de la clé unique.
  kind: { type: String, enum: ['public', 'legacy', 'staff'], default: 'public', immutable: true, select: false },
  // Ancien C01 absent = online uniquement ; chaque nouvelle identité staff
  // fige le canal exact afin de ne pas échanger phone et pos pendant la reprise.
  channel: { type: String, enum: ['online', 'pos', 'phone'], default: undefined, immutable: true, select: false },
  proofHash: { type: String, match: /^[a-f0-9]{64}$/, required: true, select: false },
  payloadHash: { type: String, match: /^[a-f0-9]{64}$/, required: true, select: false },
  state: { type: String, enum: ['validating', 'committing', 'created', 'rejected'], required: true },
  validationOwner: { type: String, default: null, select: false },
  orderId: { type: Schema.Types.ObjectId, default: null },
  slot: { type: Date, required: true },
  snapshot: { type: Schema.Types.Mixed, default: null, select: false },
  // Aucun défaut : une admission C01/historique ne s'invente pas de réservation.
  capacity: { type: OrderCapacityClaimSchema, default: undefined, select: false },
  rejection: { type: String, enum: ['unavailable', 'slot_unavailable', 'invalid_order', 'abandoned', null], default: null },
}, { timestamps: true, toJSON: { transform: hidePrivateAdmissionFields }, toObject: { transform: hidePrivateAdmissionFields } });
PublicOrderAdmissionSchema.index({ tenantId: 1, clientId: 1 }, { unique: true });
PublicOrderAdmissionSchema.index({ tenantId: 1, slot: 1, state: 1 });
for (const { name, field } of ORDER_CAPACITY_INDEXES) {
  PublicOrderAdmissionSchema.index({ tenantId: 1, 'capacity.slot': 1, [`capacity.${field}`]: 1 }, {
    name, unique: true, partialFilterExpression: { [`capacity.${field}`]: { $type: 'number' } },
  });
}
export type PublicOrderAdmission = InferSchemaType<typeof PublicOrderAdmissionSchema>;

// ─────────────────────────────────────────────────────────────
// counters — numérotation journalière atomique
// ─────────────────────────────────────────────────────────────

export const CounterSchema = new Schema(
  {
    _id: { type: String, required: true }, // `<tenantId>:<yyyymmdd>`
    seq: { type: Number, default: 0 },
    pendingInvoice: { type: InvoicePendingSchema, default: null },
  },
  { versionKey: false },
);
export type Counter = InferSchemaType<typeof CounterSchema>;

// ─────────────────────────────────────────────────────────────
// auditLog — append-only, socle NF525
// ─────────────────────────────────────────────────────────────

/**
 * L'AUTEUR D'UN GESTE — qui, à quel titre, par quel moyen.
 *
 * Le registre ne portait qu'un `staffId` : l'équipier dont le PIN validait une
 * annulation. Tout ce qui se fait depuis le back-office — un prix, une
 * rupture, un horaire — n'avait donc PAS d'auteur du tout, alors que c'est
 * exactement la question qu'on pose à un registre.
 *
 * ─── POURQUOI DU TEXTE ET NON UN `ObjectId` ───
 *
 * `id` désigne aujourd'hui un compte (`users`) ou un membre d'équipe
 * (`staff`), et demain, peut-être, une clé de connecteur pour un assistant
 * agissant au nom du restaurant. Une clé n'aura pas la forme d'un ObjectId :
 * typer ce champ en `ObjectId` obligerait à MIGRER la collection le jour de
 * cet ajout — sur un registre append-only, c'est-à-dire à ne pas pouvoir le
 * faire. Le texte accueille les trois sans rien réécrire. `means` porte la
 * valeur `connector` pour la même raison, et aucun code ne l'écrit encore.
 *
 * `name` et `role` sont DÉNORMALISÉS (même règle que `adminLogs.actorEmail`) :
 * un registre relu par jointure change de contenu quand un équipier est
 * renommé, change de rôle ou quitte le restaurant.
 */
const AuditAuthorSub = new Schema(
  {
    id: { type: String, required: true },
    name: { type: String, default: '' },
    role: { type: String, default: '' },
    means: { type: String, enum: [...AUDIT_AUTHOR_MEANS], required: true },
  },
  { _id: false },
);

export const AuditLogSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, required: true, index: true },
    /**
     * L'équipier dont le PIN a validé un geste de caisse. CONSERVÉ à côté de
     * `author` : les lignes écrites avant lui ne portent que ça, et un
     * registre append-only ne se rattrape pas par une reprise de données.
     */
    staffId: { type: Schema.Types.ObjectId, default: null },
    action: {
      type: String,
      // La SOURCE, plus une recopie : une action ajoutée à
      // `TENANT_AUDIT_ACTIONS` (@sm/contracts) existe ici sans geste
      // supplémentaire. Le journal d'administration a payé cette leçon — une
      // action déclarée au contrat mais absente d'une enum recopiée ici est
      // refusée à l'écriture, et le geste passe sans laisser de trace.
      enum: [...TENANT_AUDIT_ACTIONS],
      required: true,
    },
    targetId: { type: String, default: null },
    /** Optional idempotent append proof; existing audit writers are unchanged. */
    deduplication: { type: new Schema({ key: { type: String, required: true }, fingerprint: { type: String, required: true } }, { _id: false }), default: null },
    meta: { type: Schema.Types.Mixed, default: null },
    /** `null` sur les lignes antérieures au champ, et sur les gestes sans PIN. */
    author: { type: AuditAuthorSub, default: null },
    pinVerifiedAt: { type: Date, default: null },
    at: { type: Date, default: Date.now },
  },
  { timestamps: false },
);
AuditLogSchema.index({ tenantId: 1, at: -1 });

/**
 * APPEND-ONLY, garanti par l'ODM et pas seulement par la discipline.
 *
 * Un journal qu'on peut réécrire ne prouve rien. Ces hooks refusent toute mise
 * à jour et toute suppression : la seule écriture possible est une insertion.
 * Une correction se fait donc en AJOUTANT une ligne, comme dans un livre de
 * comptes — jamais en effaçant la précédente.
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

/**
 * Pose les huit refus sur un schéma de registre.
 *
 * Écrite une fois et appliquée aux DEUX journaux — celui du restaurant et
 * celui de l'équipe Snack Manager. Le second les avait, le premier non : la
 * même promesse était tenue d'un côté et seulement affichée de l'autre, alors
 * que c'est le registre du restaurant qu'on ouvre devant un contrôle de caisse.
 * Recopier la boucle aurait laissé les deux diverger au premier ajout.
 */
function rendreAppendOnly(schema: Schema, collection: string): void {
  for (const op of APPEND_ONLY_BLOCKED) {
    // `as never` : la signature de `pre` est une union de littéraux que TS ne
    // peut pas réduire depuis une variable de boucle. Le comportement, lui,
    // est celui d'un middleware de requête ordinaire.
    schema.pre(op as never, function blockMutation() {
      throw new Error(`${collection} est append-only : « ${op} » est refusé.`);
    });
  }
}

rendreAppendOnly(AuditLogSchema, 'auditLogs');

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
    /**
     * La proposition sur la table — quel plan, quel module, quel engagement.
     * Posée à l'étape « proposition », reprise au moment de signer. `null`
     * tant que rien n'a été mis par écrit ; les PRIX ne s'y stockent pas,
     * ils se dérivent de la grille (@sm/contracts, `proposalCents`).
     */
    proposal: {
      type: new Schema(
        {
          // `null` = proposition sans formule — que des services de l'Atelier
          // (même motif que `reseauxSociaux` plus bas pour l'enum nullable).
          plan: { type: String, enum: ['essentiel', 'complet', 'boost', null], default: null },
          onlineOrdering: { type: Boolean, default: false },
          onlineDelivery: { type: Boolean, default: false },
          standaloneLoyalty: { type: Boolean, default: false },
          billing: { type: String, enum: ['mensuel', 'annuel'], default: 'mensuel' },
          // L'Atelier — les services retenus. Les prix ne se stockent pas :
          // ils se dérivent de la grille (@sm/contracts), comme le plan.
          services: {
            type: new Schema(
              {
                siteVitrine: { type: Boolean, default: false },
                refonteSite: { type: Boolean, default: false },
                identiteVisuelle: { type: Boolean, default: false },
                integrationCommande: { type: Boolean, default: false },
                presenceInternet: { type: Boolean, default: false },
                reseauxSociaux: { type: String, enum: ['hebdo', 'bihebdo', null], default: null },
              },
              { _id: false },
            ),
            default: null,
          },
          note: { type: String, default: '' },
          at: { type: Date, required: true },
        },
        { _id: false },
      ),
      default: null,
    },
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
// Un incident éteint n'est pas une archive métier : 90 jours suffisent pour
// diagnostiquer une régression, sans conserver indéfiniment URL/pile/message.
ErrorEventSchema.index({ lastAt: 1 }, { expireAfterSeconds: 90 * 24 * 3600 });
export type ErrorEvent = InferSchemaType<typeof ErrorEventSchema>;

/**
 * Jalons du tunnel de commande — un document par jalon, anonyme par
 * construction (slug, étape, canal, date : RIEN d'autre, voir le contrat).
 * Le TTL de 90 jours est la politique de rétention : un entonnoir se lit sur
 * des semaines, pas des années, et la collection ne peut pas enfler sans fin.
 */
export const FunnelEventSchema = new Schema(
  {
    slug: { type: String, required: true },
    step: {
      type: String,
      enum: ['visite', 'panier', 'coordonnees', 'commande'],
      required: true,
    },
    canal: { type: String, enum: ['page', 'embed', 'domaine'], required: true },
    at: { type: Date, required: true },
  },
  { timestamps: false },
);
// TTL : index ASCENDANT obligatoirement — Mongo n'expire que sur { champ: 1 }.
FunnelEventSchema.index({ at: 1 }, { expireAfterSeconds: 90 * 24 * 3600 });
export type FunnelEvent = InferSchemaType<typeof FunnelEventSchema>;

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
// Le cooldown opérationnel se compte en heures ; passé 90 jours, cette coche
// n'a plus d'effet et ne doit pas devenir une collection permanente.
AlertLogSchema.index({ sentAt: 1 }, { expireAfterSeconds: 90 * 24 * 3600 });
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

/**
 * Une COCHE de la file de production hebdomadaire de l'Atelier — « la
 * publication de la semaine est faite chez ce client ».
 *
 * Le DÛ ne se stocke jamais : il se dérive de `tenant.atelier` et de la
 * semaine (@sm/contracts, `productionTasksFor`) — même principe que le
 * retard d'une facture. Seul le FAIT s'écrit : décocher supprime le
 * document, l'unicité (tenant, semaine, tâche) rend le geste idempotent.
 */
export const AtelierTickSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, required: true },
    /** Clef de semaine ISO `AAAA-Wss` — voir @sm/contracts `production.ts`. */
    week: { type: String, required: true },
    // Les clefs de tâches vivent dans @sm/contracts (`PRODUCTION_TASKS`) ;
    // recopiées ici comme les formules plus haut — ce paquet reste sans
    // dépendance, et un test de cohérence casserait à la divergence.
    task: {
      type: String,
      enum: ['social_pub_1', 'social_pub_2', 'presence_avis', 'presence_rapport'],
      required: true,
    },
    doneAt: { type: Date, required: true },
    /** `sub` du jeton sm_admin — même trace que les signaux traités. */
    doneBy: { type: String, default: '' },
    note: { type: String, default: '' },
  },
  { timestamps: false },
);
AtelierTickSchema.index({ tenantId: 1, week: 1, task: 1 }, { unique: true });
export type AtelierTick = InferSchemaType<typeof AtelierTickSchema>;

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
    /**
     * Les trois bornes qui manquaient — et sans lesquelles une promotion se
     * découvre sur la marge du mois plutôt que sur un écran.
     *
     * `minSubtotalCents` : sans lui, « 5 € offerts » s'applique à une commande
     * de 5,50 €. `maxDiscountCents` : sans lui, « −50 % » sur une commande de
     * groupe à 200 € coûte cent euros. `maxUsage` : sans lui, un code qui fuit
     * sur les réseaux ne s'arrête jamais.
     *
     * `0` vaut « pas de borne » dans les trois cas, et jamais « borne à zéro » —
     * c'est le défaut, et il doit se lire comme l'absence de condition.
     */
    minSubtotalCents: { type: Number, default: 0 },
    maxDiscountCents: { type: Number, default: 0 },
    maxUsage: { type: Number, default: 0 },
    /**
     * Le produit offert — `offered_item` seulement.
     *
     * La nature figurait à l'énuméré depuis l'origine et était INAPPLICABLE :
     * le modèle ne disait pas quel produit offrir. Le formulaire la proposait
     * pourtant, et la promotion créée n'aurait rien pu faire.
     */
    offeredProductId: { type: Schema.Types.ObjectId, ref: 'Product', default: null },
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

const ScreenPresentationSub = new Schema({
  version: { type: Number, enum: [1], default: 1 },
  corners: { type: String, enum: [...SCREEN_CORNERS], default: 'brand' },
  priceScale: { type: String, enum: [...SCREEN_PRICE_SCALES], default: 'balanced' },
  motion: { type: String, enum: [...SCREEN_MOTIONS], default: 'brand' },
}, { _id: false, strict: 'throw' });

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
    // La mise en scène. ABSENTE sur les écrans antérieurs : `toStored` lit
    // alors « ardoise », l'écran qu'ils ont toujours eu — une mise à jour ne
    // change pas l'apparence d'un téléviseur accroché au mur. Les écrans neufs
    // reçoivent le défaut du contrat (Comptoir) à la création, pas ce défaut-ci.
    scenography: { type: String, enum: [...SCENOGRAPHIES], default: 'ardoise' },
    presentation: { type: ScreenPresentationSub, default: undefined },
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
    // Télémétrie du dernier battement (contrat `DeviceHeartbeatBody`) : la
    // version du bundle, la profondeur de la file hors-ligne, la dernière
    // erreur de synchronisation. Écrasée à chaque battement — c'est un état
    // PRÉSENT, pas un historique.
    appVersion: { type: String, default: '' },
    queueDepth: { type: Number, default: null },
    lastError: { type: String, default: '' },
    active: { type: Boolean, default: true },
    /**
     * Version opaque de l'appairage. Elle change lors d'une désactivation,
     * d'un changement de type ou d'un nouvel appairage afin qu'un ancien JWT
     * staff ne puisse jamais redevenir valide après révocation.
     */
    sessionVersion: { type: String, default: '0' },
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
      // La SOURCE, plus une recopie : une action ajoutée à `ADMIN_LOG_ACTIONS`
      // (@sm/contracts) existe ici sans geste supplémentaire.
      enum: [...ADMIN_LOG_ACTIONS],
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
 * APPEND-ONLY, par le même dispositif que le registre du restaurant.
 *
 * Les huit refus vivent désormais dans `rendreAppendOnly` (déclaré plus haut,
 * avec le journal `auditLogs`) : les deux registres tiennent une promesse
 * identique, et une liste d'opérations recopiée aurait fini par diverger.
 */
rendreAppendOnly(AdminLogSchema, 'adminLogs');

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
    // `avoir` : la pièce NÉGATIVE qui corrige une facture réglée — même
    // séquence de numérotation, même collection. Une facture réglée ne
    // s'annule pas, elle s'avoise ; c'est cette nature qui porte le geste.
    kind: {
      type: String,
      enum: ['abonnement', 'mise_en_place', 'option', 'autre', 'avoir'],
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
     *
     * PAS DE `min: 0` : un AVOIR porte le montant NÉGATIF de la facture qu'il
     * corrige — c'est sa définition, pas un accident de saisie. Le garde-fou
     * contre un montant négatif saisi à la main est ailleurs : l'émission
     * (`InvoiceIssueSchema`, @sm/contracts) refuse tout montant < 0, et seul
     * le geste d'avoir écrit en négatif.
     */
    amountCents: { type: Number, required: true },
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
    stripeCheckoutSessionId: { type: String, default: null },
    stripePaymentIntentId: { type: String, default: null },
    stripePaymentEventId: { type: String, default: null },
    stripeCheckoutExpiresAt: { type: Date, default: null },
    /** Comment l'argent est arrivé — `null` tant que rien n'est encaissé. */
    method: {
      type: String,
      enum: ['prelevement', 'virement', 'carte', 'cheque', null],
      default: null,
    },
    cancelledAt: { type: Date, default: null },
    cancelReason: { type: String, default: '' },
    /**
     * LES RELANCES, tracées SUR LA PIÈCE.
     *
     * L'échelle de recouvrement (rappeler à J+8, relancer par écrit à J+15,
     * mettre en demeure à J+30) ne vaut que si l'on sait où l'on en est : sans
     * cette liste, « déjà relancé ? » se répondait de mémoire, et deux
     * personnes rappelaient le même gérant à un jour d'écart. Chaque relance
     * s'écrit AUSSI au journal d'administration (`invoice.remind`), avec son
     * auteur — ici ne vit que ce que la file de recouvrement doit relire vite.
     */
    reminders: {
      type: [
        new Schema(
          {
            at: { type: Date, required: true },
            channel: {
              type: String,
              enum: ['appel', 'sms', 'email', 'courrier', 'autre'],
              required: true,
            },
            note: { type: String, default: '' },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
  },
  { timestamps: true },
);
/** Le numéro identifie la pièce : deux factures ne peuvent pas le partager. */
InvoiceSchema.index({ number: 1 }, { unique: true });
/** Fiche d'un client : son historique, échéance la plus récente en tête. */
InvoiceSchema.index({ tenantId: 1, dueAt: -1 });
/** File des impayés du parc : on balaie par statut, du plus ancien au plus récent. */
InvoiceSchema.index({ status: 1, dueAt: 1 });
/** Accélère la vérification historique ; l'arbitrage vit dans InvoiceIssuance. */
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
  Media: { name: 'Media', schema: MediaSchema, collection: 'medias' },
  Order: { name: 'Order', schema: OrderSchema, collection: 'orders' },
  PublicOrderAdmission: { name: 'PublicOrderAdmission', schema: PublicOrderAdmissionSchema, collection: 'public_order_admissions' },
  OrderCapacityDay: { name: 'OrderCapacityDay', schema: OrderCapacityDaySchema, collection: 'order_capacity_days' },
  Counter: { name: 'Counter', schema: CounterSchema, collection: 'counters' },
  AuditLog: { name: 'AuditLog', schema: AuditLogSchema, collection: 'auditlogs' },
  AdminLog: { name: 'AdminLog', schema: AdminLogSchema, collection: 'adminlogs' },
  Invoice: { name: 'Invoice', schema: InvoiceSchema, collection: 'invoices' },
  InvoiceIssuance: { name: 'InvoiceIssuance', schema: InvoiceIssuanceSchema, collection: 'invoiceIssuances' },
  Lead: { name: 'Lead', schema: LeadSchema, collection: 'leads' },
  ErrorEvent: { name: 'ErrorEvent', schema: ErrorEventSchema, collection: 'errorevents' },
  AlertLog: { name: 'AlertLog', schema: AlertLogSchema, collection: 'alertlogs' },
  SignalDismissal: {
    name: 'SignalDismissal',
    schema: SignalDismissalSchema,
    collection: 'signaldismissals',
  },
  AtelierTick: { name: 'AtelierTick', schema: AtelierTickSchema, collection: 'atelierticks' },
  FunnelEvent: { name: 'FunnelEvent', schema: FunnelEventSchema, collection: 'funnelevents' },
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
