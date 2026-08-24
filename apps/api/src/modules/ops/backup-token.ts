import { timingSafeEqual } from 'node:crypto';

/**
 * Le droit d'emporter la base tient dans la seule variable `SM_BACKUP_TOKEN`.
 *
 * Pas un compte, pas un rôle — un jeton dédié, posé sur Railway et répliqué
 * dans les réglages Actions du dépôt, que le travail de sauvegarde présente
 * en `Bearer`. Variable absente = la route n'existe pas (404) : un
 * environnement qui n'a pas décidé de sauvegarder n'expose rien.
 *
 * (Rédaction volontairement sans deux-points après le mot sensible : la règle
 * maison du balayage de secrets lit « mot sensible : valeur » comme une
 * affectation — même mésaventure que la doc CI-CD, voir `.gitleaksignore`.)
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
