/**
 * ═══════════════════════════════════════════════════════════════════════════
 * LES PHOTOS D'UN PLAT — l'ordre, et ce qui manque
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Ce qui reste ici quand tout ce qui parle d'IMAGES est parti dans
 * `components/mediatheque/photos.ts` : les deux seules décisions qui parlent
 * de PRODUITS. L'éditeur de marque dépose et réduit dans la même médiathèque,
 * mais il n'ordonne aucune liste et ne compte aucun plat — la frontière est
 * là, et pas ailleurs.
 */

import { photoUrlDe, type MediaVue } from "@sm/contracts";

/**
 * Déplace une photo d'un cran — la PREMIÈRE est la principale.
 *
 * Réordonner n'est donc pas cosmétique : c'est le geste qui change la photo
 * affichée sur la caisse, la vitrine et le téléviseur, sans qu'aucune adresse
 * ne change (cf. `photoUrlDe`, qui prend la première référence résolue). Un
 * pas hors des bornes rend la liste INCHANGÉE plutôt qu'une liste tronquée :
 * une flèche grisée peut toujours être atteinte au clavier.
 */
export function deplacer<T>(liste: readonly T[], index: number, pas: number): T[] {
  const vers = index + pas;
  if (index < 0 || index >= liste.length || vers < 0 || vers >= liste.length) {
    return [...liste];
  }
  const suite = [...liste];
  const [element] = suite.splice(index, 1);
  suite.splice(vers, 0, element as T);
  return suite;
}

/**
 * Combien de plats n'ont AUCUNE photo à montrer.
 *
 * Le compte passe par `photoUrlDe`, l'adaptateur de lecture unique, et pas par
 * `medias.length === 0` : les dix-neuf plats du pilote portent encore leur
 * chaîne héritée, ils ont bel et bien une photo à l'écran, et les compter
 * comme manquants enverrait le restaurateur chercher un problème qui n'existe
 * pas. Un média référencé mais disparu, lui, est bien compté comme manquant —
 * c'est ce que le mangeur voit.
 */
export function produitsSansPhoto(
  produits: readonly { medias?: unknown; photoUrl?: unknown }[],
  catalogue: ReadonlyMap<string, MediaVue>,
): number {
  return produits.filter((p) => photoUrlDe(p, catalogue, "vignette") === null).length;
}

