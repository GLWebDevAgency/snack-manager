import type { Brand } from "@sm/contracts";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * LE VERROU DU MASQUE — la déclinaison « logo avec le nom » du mode en cours
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Deux sondes, et DEUX SEULEMENT : la déclinaison qui va avec le mode, puis
 * l'autre. C'est la même règle que `logoPour` pour son format — un logo dessiné
 * pour fond sombre disparaît sur une Brasserie crème — mais elle s'arrête là.
 *
 * ─── POURQUOI PAS `logoPour(brand, "lockup")` ──────────────────────────────
 *
 * Parce qu'il RETOMBE SUR LA MARQUE : ses deux dernières sondes vont chercher
 * `logo.mark` quand `logo.lockup` est vide. C'est exactement ce qu'il faut pour
 * remplir une tuile — n'importe quel fichier posé vaut mieux qu'une initiale —
 * et exactement ce qu'il ne faut pas ici. Un verrou REMPLACE le nom écrit : y
 * servir un pictogramme carré, qui ne porte aucun nom, effacerait le nom du
 * restaurant de son propre en-tête. Sans verrou posé, on n'en veut pas un
 * approximatif ; on veut la tuile et le nom, tels qu'ils ont toujours été.
 */
export function verrouPour(brand: Brand): string | null {
  /*
   * LE CHOIX DU RESTAURATEUR PASSE AVANT CE QU'IL A POSÉ.
   *
   * Poser une image horizontale ne suffit plus à l'employer : le restaurateur
   * dit lequel des deux il veut voir. Il peut vouloir garder sa planche
   * horizontale pour ses supports imprimés et préférer le symbole à l'écran,
   * où la largeur manque — un verrou de 512 px sur un téléphone de 390 pousse
   * tout le reste de l'en-tête.
   *
   * Le défaut reste `verrou`, donc rien ne change pour qui n'a rien choisi.
   */
  if (brand.entete === "symbole") return null;
  const prefere = brand.mode === "dark" ? "dark" : "light";
  const autre = prefere === "dark" ? "light" : "dark";
  return brand.logo.lockup[prefere] ?? brand.logo.lockup[autre];
}
