import { timingSafeEqual } from 'node:crypto';

/**
 * Le droit d'emporter la base tient dans UN secret : `SM_BACKUP_TOKEN`.
 *
 * Pas un compte, pas un rôle — un jeton dédié, posé en variable sur Railway
 * et en secret GitHub, que le travail de sauvegarde présente en `Bearer`.
 * Variable absente = la route n'existe pas (404) : un environnement qui n'a
 * pas décidé de sauvegarder n'expose rien.
 *
 * Comparaison en temps constant : sur une route qui rend toute la base, on ne
 * laisse même pas fuir la longueur du préfixe juste.
 */
export function backupTokenMatches(header: string | undefined, expected: string): boolean {
  if (!header?.startsWith('Bearer ')) return false;
  const presented = Buffer.from(header.slice('Bearer '.length).trim());
  const wanted = Buffer.from(expected);
  if (presented.length !== wanted.length) return false;
  return timingSafeEqual(presented, wanted);
}
