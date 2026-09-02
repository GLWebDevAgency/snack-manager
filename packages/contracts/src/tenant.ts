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
export const TenantIdentityUpdateSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
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
