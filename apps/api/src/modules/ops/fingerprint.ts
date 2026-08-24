import { createHash } from 'node:crypto';
import type { ErrorSource } from '@sm/contracts';

/**
 * L'empreinte qui fait d'une avalanche une ligne.
 *
 * Deux occurrences de la même panne doivent tomber dans le même groupe même
 * quand le message porte du bruit variable — un identifiant de commande, un
 * port, un timestamp. D'où la normalisation : toute suite de chiffres devient
 * `#`, tout hexadécimal long (ObjectId, UUID, hash) devient `~`. On y ajoute
 * la PREMIÈRE ligne de pile utile : c'est elle qui distingue deux erreurs au
 * même message levées de deux endroits différents.
 *
 * Volontairement stable et simple : changer cette fonction re-fragmente tous
 * les groupes existants — ne le faire qu'en connaissance de cause.
 */

const normalize = (text: string): string =>
  text
    .replace(/[0-9a-f]{12,}/gi, '~')
    .replace(/\d+/g, '#')
    .trim()
    .slice(0, 300);

/** Première ligne de pile qui pointe du code — les en-têtes `Error:` sautent. */
const topFrame = (stack: string): string => {
  for (const line of stack.split('\n')) {
    const t = line.trim();
    if (t.startsWith('at ') || t.includes('.ts:') || t.includes('.js:')) return t;
  }
  return '';
};

export function errorFingerprint(source: ErrorSource, message: string, stack = ''): string {
  const seed = `${source}|${normalize(message)}|${normalize(topFrame(stack))}`;
  return createHash('sha1').update(seed).digest('hex').slice(0, 20);
}
