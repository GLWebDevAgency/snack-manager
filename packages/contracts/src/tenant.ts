import { z } from 'zod';
import { HexSchema } from './marque';

/**
 * IDENTITÉ DE L'ÉTABLISSEMENT — éditable par le gérant, enfin.
 *
 * Jusqu'au 24/08/2026, le nom, la couleur de marque, l'adresse et les
 * téléphones étaient consommés PARTOUT (caisse, cuisine, vitrine, tickets)
 * et éditables NULLE PART : chaque changement retombait sur l'équipe SM, en
 * base (diagnostic quatre casquettes, P2). Ce contrat arme l'écran
 * « Paramètres » du back-office restaurateur.
 *
 * Le logo n'est pas DANS ce PATCH : ce n'est pas un champ URL (un champ nu
 * inviterait des liens morts sur les tickets) mais un FICHIER, envoyé sur sa
 * propre route (`PUT /tenants/me/logo`, multipart) et hébergé par nous sur
 * R2 — seules les bornes ci-dessous sont partagées entre l'écran et l'API.
 * Le slug n'y est pas non plus : c'est l'adresse publique de l'établissement,
 * la changer casse la fiche Google et les QR imprimés — geste d'équipe SM.
 */

/**
 * Taille maximale du logo : 512 Ko. Un logo sert en en-tête de ticket, sur
 * une tablette de caisse et un board TV — au-delà, c'est une photo, pas un
 * logo, et c'est la page de commande de tous ses clients qui la télécharge.
 * L'écran vérifie AVANT d'envoyer (message immédiat), l'API refuse ensuite
 * (la limite qui compte) : même nombre des deux côtés, donc partagé ici.
 */
export const LOGO_MAX_OCTETS = 512 * 1024;

/** Formats admis — pas de SVG : un SVG embarque du script, un logo non. */
export const LOGO_FORMATS_ADMIS = ['image/png', 'image/jpeg', 'image/webp'] as const;
/** Un lien éditorial, jamais chargé par le serveur ni utilisé comme redirect automatique. */
export const WebsiteUrlSchema = z.url().max(2048).refine((value) => {
  const url = new URL(value);
  return url.protocol === 'https:' && !url.username && !url.password;
}, 'Utilisez une adresse HTTPS sans identifiants intégrés');
export const TenantIdentityUpdateSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  websiteUrl: WebsiteUrlSchema.nullable().optional(),
  /**
   * L'accent de marque — seul levier de personnalisation (charte DA §3).
   * `HexSchema` (et pas une regex recopiée) : la casse est normalisée une
   * seule fois, au contrat, pour que la colonne plate `brandColor` et
   * `brand.palette.accent` ne divergent jamais d'une majuscule.
   */
  brandColor: HexSchema.optional(),
  address: z.string().trim().max(200).optional(),
  /** Tels qu'ils s'impriment sur le ticket — le format reste libre. */
  phones: z.array(z.string().trim().min(1).max(20)).max(3).optional(),
});
export type TenantIdentityUpdate = z.infer<typeof TenantIdentityUpdateSchema>;

/**
 * LES RÉGLAGES DU RESTAURANT — validés, enfin.
 *
 * `PATCH /tenants/me/settings` prenait un corps NU : une liste blanche de clés
 * recopiait les valeurs dans un `$set` sans regarder ce qu'elles contenaient.
 * Le service le disait lui-même — « la route prend un corps nu, sans schéma
 * Zod, et cette liste est le seul rempart ». Une liste de clés n'est pas un
 * rempart : elle dit QUELS champs s'écrivent, jamais AVEC QUOI.
 *
 * Chaque borne ci-dessous répare un dégât précis, et aucune n'est décorative :
 * un intervalle de créneau à zéro divise par zéro dans le calcul des
 * disponibilités ; une capacité négative ferme la commande en ligne sans qu'un
 * seul écran ne l'explique ; un objectif du jour négatif rend la jauge du
 * tableau de bord illisible ; un message de pause sans borne part sur la page
 * publique de tous les clients.
 *
 * `.partial()` et non des `.optional()` un à un : c'est un PATCH, et les clés
 * absentes doivent rester absentes du `$set` — un défaut appliqué ici
 * réinitialiserait en silence ce que le gérant n'a pas touché.
 */
export const TenantSettingsUpdateSchema = z
  .object({
    /** Le pas des créneaux de retrait, en minutes. */
    slotIntervalMin: z.number().int().min(5).max(60),
    /** Commandes acceptées par créneau — au moins une, sinon rien ne passe. */
    slotCapacity: z.number().int().min(1).max(100),
    onlineOrderingPaused: z.boolean(),
    /**
     * Affiché au CLIENT sur la page de commande — borné, jamais illimité.
     *
     * La chaîne vide est ADMISE : effacer son message est un geste normal du
     * gérant, et l'interdire l'obligerait à inventer un texte pour se taire. La
     * page de commande affiche alors la pause sans phrase, ce que
     * `publicOrderingState` sait déjà rendre (`message: null` côté client).
     */
    pauseMessage: z.string().trim().max(200),
    printTicketOn: z.enum(['accept', 'ready']),
    printStickerOn: z.enum(['accept', 'ready']),
    /**
     * L'objectif de recette du jour, en centimes.
     *
     * `null` efface l'objectif — le tableau de bord reprend le sien. `0` est
     * refusé : un objectif nul est atteint dès l'ouverture, et la jauge
     * afficherait 100 % avant la première commande. Le plafond écarte la faute
     * de frappe qui prend des euros pour des centimes.
     */
    dailyGoalCents: z.number().int().positive().max(100_000_000).nullable(),
  })
  .partial();
export type TenantSettingsUpdate = z.infer<typeof TenantSettingsUpdateSchema>;

// ─────────────────────────────────────────────────────────────
// LES HORAIRES ET LES FERMETURES — validés, enfin
// ─────────────────────────────────────────────────────────────

/**
 * L'heure MURALE d'un service, « HH:MM » sur 24 h.
 *
 * Murale et non instant : « on ouvre à 11:30 » ne dépend ni du jour ni de
 * l'heure d'été. C'est la forme que le calcul des créneaux lit
 * (`SlotsService.parseHm`), celle que le champ `<input type="time">` du
 * back-office produit, et celle que la base stocke (`HoursSlot`, deux chaînes).
 *
 * Le motif est EXPORTÉ pour la même raison que `HEX` et `IMAGE_URL` : la
 * frontière zod garde la route, mais la base est aussi écrite par l'admin-cli
 * et par les scripts de reprise, qui ne passent pas par elle.
 */
export const HEURE_MURALE = /^([01]\d|2[0-3]):[0-5]\d$/;

const HeureMuraleSchema = z
  .string()
  .trim()
  .regex(HEURE_MURALE, 'Heure attendue au format HH:MM (24 h)');

/**
 * Un service, ou son absence.
 *
 * `null` est la fermeture — « pas de midi le lundi » —, pas une valeur
 * manquante : c'est ainsi que l'écran l'envoie et que la base le stocke.
 *
 * `close` doit SUIVRE `open`, et ce n'est pas une coquetterie : le calcul des
 * créneaux ignore purement et simplement une fenêtre dont la fermeture précède
 * l'ouverture (`closeMin < openMin` → `continue`). Sans ce refus, un service
 * saisi « 18:00 → 02:00 » était accepté en 200, stocké, affiché sur la vitrine,
 * et ne proposait AUCUN créneau — sans que rien ne le dise. Le service qui
 * passe minuit n'est donc pas supporté ; le refus l'annonce au lieu de le
 * laisser découvrir un vendredi soir.
 */
const CreneauServiceSchema = z
  .object({ open: HeureMuraleSchema, close: HeureMuraleSchema })
  .strict()
  .refine((c) => c.open < c.close, {
    message:
      'La fermeture doit suivre l’ouverture — un service qui passe minuit n’est pas encore supporté',
    path: ['close'],
  })
  .nullable();

/**
 * Une journée de la semaine — jour ISO, midi, soir.
 *
 * `.default(null)` sur les deux services : `hours` est REMPLACÉ en entier à
 * chaque enregistrement, donc un service absent du corps est un service fermé.
 * Le dire explicitement évite qu'un `undefined` parte dans le `$set`.
 */
const JourHorairesSchema = z
  .object({
    /** ISO : 1 = lundi … 7 = dimanche, comme en base et comme `PublicSiteHours`. */
    day: z.number().int().min(1).max(7),
    lunch: CreneauServiceSchema.default(null),
    dinner: CreneauServiceSchema.default(null),
  })
  .strict();

/**
 * Une borne de fermeture exceptionnelle.
 *
 * DEUX formes, et les deux sont nécessaires — l'écran renvoie la liste
 * ENTIÈRE à chaque geste, donc celles qu'il vient de saisir ET celles qu'il
 * vient de relire :
 *  - `2026-08-14`, ce que pose le champ date du back-office ;
 *  - `2026-08-14T00:00:00.000Z`, ce que rend l'API au tour suivant (la base
 *    stocke des `Date`).
 *
 * Une date-heure SANS fuseau est refusée : elle désigne un instant différent
 * selon la machine qui la lit, et aucun des deux producteurs n'en émet.
 * `SlotsService` étend ensuite les bornes date-seule aux limites du jour
 * parisien — c'est lui qui connaît le fuseau du restaurant, pas ce contrat.
 */
const BorneFermetureSchema = z.union([z.iso.date(), z.iso.datetime({ offset: true })]);

/**
 * Une fermeture exceptionnelle : du … au …, et pourquoi.
 *
 * `reason` est BORNÉE parce qu'elle est PUBLIQUE : c'est le `closureReason`
 * que la page de commande affiche au client quand la journée est fermée. Sans
 * borne, elle partait sans longueur sur la page de tous les clients.
 *
 * `to` et `reason` restent facultatifs : la base porte des fermetures d'avant
 * l'écran actuel, à qui il manque l'un ou l'autre, et l'écran les renvoie
 * telles quelles dès qu'on ajoute une ligne. Les refuser rendrait impossible
 * l'ajout d'une fermeture à un restaurant qui en a déjà une ancienne.
 */
const FermetureSchema = z
  .object({
    from: BorneFermetureSchema,
    to: BorneFermetureSchema.nullish(),
    reason: z.string().trim().max(200).nullish(),
  })
  .strict()
  .refine((f) => f.to == null || Date.parse(f.to) >= Date.parse(f.from), {
    message: 'La date de fin doit suivre la date de début',
    path: ['to'],
  });

/**
 * LES HORAIRES ET LES FERMETURES — la garde de `PATCH /tenants/me/hours`.
 *
 * C'était la DERNIÈRE route d'écriture du contrôleur à prendre un corps NU :
 * `@Body()` sans pipe, puis `$set: { hours, closures }` tel quel. Or ces deux
 * tableaux ne restent pas dans le back-office — ils repartent vers le PUBLIC
 * (la fiche `publicBySlug`, la vitrine, le tableau de menu, et surtout le
 * calcul des créneaux de retrait). Un corps mal formé ne cassait pas un écran
 * d'administration : il cassait la commande en ligne de tous les clients d'un
 * restaurant.
 *
 * `runValidators` côté service empêchait bien l'écriture hors schéma, mais
 * TARD et MAL : une erreur de cast Mongoose n'est pas un 400 lisible, et le
 * schéma Mongoose ne dit rien de la forme d'un créneau — `{ open: '25:99' }`
 * y passe, deux entrées pour le même jour aussi.
 *
 * `.strict()` à tous les niveaux : une clé inattendue dans un corps de requête
 * est une tentative, pas une tolérance (ASVS V5.1.3, mass assignment).
 */
export const TenantHoursUpdateSchema = z
  .object({
    /**
     * Sept jours au plus, un par jour. Le doublon est refusé parce qu'il est
     * SILENCIEUX : `windowsFor` fait un `.find()` sur le jour ISO, donc la
     * seconde entrée d'un même jour ne serait jamais lue — le gérant verrait
     * ses horaires du mardi enregistrés et son restaurant fermé le mardi.
     */
    hours: z
      .array(JourHorairesSchema)
      .max(7)
      .refine((jours) => new Set(jours.map((j) => j.day)).size === jours.length, {
        message: 'Deux entrées pour le même jour — seule la première serait lue',
      }),
    /**
     * Absente = inchangée : l'écran des horaires enregistre les sept jours
     * sans toucher aux fermetures, et le service ne pose alors rien dans le
     * `$set`.
     *
     * Le plafond n'est pas cosmétique : la liste n'est jamais purgée (une
     * fermeture passée reste), elle est relue à CHAQUE calcul de créneau, et
     * elle repart en entier à chaque ajout. Deux cents lignes couvrent des
     * années de congés et de jours fériés ; au-delà, c'est un envoi anormal.
     */
    closures: z.array(FermetureSchema).max(200).optional(),
  })
  .strict();
export type TenantHoursUpdate = z.infer<typeof TenantHoursUpdateSchema>;
