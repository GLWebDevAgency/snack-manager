import type { Clock } from '@sm/domain';

/**
 * Horloge injectable du module « Menu Board ».
 *
 * Tout ici dépend de l'heure : l'expiration d'un code d'appairage, le service
 * en cours, le « hors ligne depuis 20 min », l'heure du rechargement de nuit.
 * Un `Date.now()` en dur rendrait le dayparting intestable — et personne ne
 * s'apercevrait qu'un écran de salle affiche la carte du midi à 21 h.
 *
 * Le jeton est déclaré localement (les fournisseurs Nest sont portés par le
 * module) : ce module ne dépend d'aucun autre.
 */
export const CLOCK = 'CLOCK';

export type { Clock };
