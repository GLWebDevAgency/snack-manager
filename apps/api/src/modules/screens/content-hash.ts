import { createHash } from 'node:crypto';

/**
 * Empreinte du contenu affiché.
 *
 * L'écran interroge l'API toutes les minutes pendant douze heures. Retélécharger
 * la carte entière à chaque fois userait le wifi du snack pour rien — et surtout
 * repeindre l'écran sans raison casserait l'animation en cours sous les yeux du
 * client. L'écran compare donc une empreinte et ne redessine que si elle bouge.
 *
 * Deux exigences, en tension apparente :
 *  - STABLE : même carte, même service ⇒ même empreinte, indéfiniment. D'où
 *    l'exclusion de tout ce qui bouge tout seul (horodatage de génération,
 *    heure du rechargement de nuit, dernier battement de cœur).
 *  - SENSIBLE : un prix corrigé, une rupture cochée, un passage midi → soir
 *    doivent la faire changer.
 */

/** Longueur retenue de l'empreinte : 16 hexadécimaux, largement assez pour comparer. */
const HASH_LENGTH = 16;

/**
 * JSON canonique : clés triées, à tous les niveaux.
 *
 * `JSON.stringify` conserve l'ordre d'insertion des clés. Deux objets identiques
 * construits par des chemins différents produiraient donc deux chaînes
 * différentes — et l'écran se repeindrait sans cesse.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;

  const entries = Object.entries(value as Record<string, unknown>)
    // `undefined` disparaîtrait de toute façon du JSON : on l'écarte d'abord,
    // sinon une clé optionnelle absente et la même à `undefined` divergeraient.
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

export function contentHashOf(value: unknown): string {
  return createHash('sha1').update(canonicalJson(value)).digest('hex').slice(0, HASH_LENGTH);
}
