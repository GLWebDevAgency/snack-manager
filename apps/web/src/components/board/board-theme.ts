"use client";

/**
 * Ce qui reste du « thème » de l'écran de salle.
 *
 * Les couleurs ne se calculent plus ici : l'écran reçoit le MASQUE effectif du
 * restaurant (`content.masque`) et l'hôte (`BoardStage`) le résout avec le
 * même résolveur que la vitrine et la carte de fidélité. Seul le monogramme de
 * repli — quand aucun logo n'est posé — a encore sa place dans ce fichier.
 */

/** Monogramme de repli quand le restaurant n'a pas encore de logo. */
export function monogramOf(name: string): string {
  const words = name.trim().split(/[\s'’-]+/).filter(Boolean);
  if (words.length === 0) return "SM";
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[1]![0]!).toUpperCase();
}
