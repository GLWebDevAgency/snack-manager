import type { Clock } from '@sm/domain';

/**
 * Horloge injectable du module « Appareils ».
 *
 * Tout ce qui compte ici dépend de l'heure : l'expiration d'un code
 * d'appairage et le « hors ligne depuis 12 min » du back-office. Un
 * `Date.now()` en dur rendrait les deux intestables — et une caisse comptée à
 * tort comme en ligne, c'est un gérant qui ne va pas voir pourquoi son
 * comptoir n'encaisse plus.
 *
 * Le jeton est déclaré localement (les fournisseurs Nest sont portés par le
 * module) : ce module ne dépend d'aucun autre.
 */
export const CLOCK = 'CLOCK';

export type { Clock };
