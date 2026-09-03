import { createHash } from 'node:crypto';
import { EMPREINTE_LONGUEUR } from '@sm/contracts';

/**
 * L'EMPREINTE D'UN MÉDIA — SHA-256 tronqué à 128 bits, hexadécimal minuscule.
 *
 * ─── POURQUOI ELLE VIT DANS LE PAQUET DE LA BASE ───
 *
 * Ce n'est pas une fonction utilitaire, c'est l'IDENTITÉ d'un média : c'est
 * elle que porte l'index unique `(tenantId, empreinte)`, et c'est d'elle que
 * dérive l'adresse publique des octets. Deux calculs différents de la même
 * empreinte, ce sont deux médiathèques — une photo redéposée créerait un
 * doublon au lieu de retrouver sa ligne, et le dédoublonnage promis par le
 * modèle deviendrait faux sans qu'aucun test ne rougisse.
 *
 * Elle est donc écrite UNE FOIS, ici, où vit l'index qui en dépend. Ses deux
 * lecteurs y accèdent : l'API (`MediasService.deposer`, qui dépend déjà de
 * `@sm/db`) et la reprise `backfill:medias`, qui doit produire exactement les
 * mêmes empreintes que l'API pour être idempotente vis-à-vis d'elle.
 *
 * Pas dans `@sm/contracts` : `node:crypto` n'existe pas dans le navigateur, et
 * le contrat est aussi lu par le web. Seule la LONGUEUR y est déclarée, avec
 * le motif que la base et les routes appliquent.
 */
export function empreinteDe(corps: Uint8Array): string {
  return createHash('sha256').update(corps).digest('hex').slice(0, EMPREINTE_LONGUEUR);
}
