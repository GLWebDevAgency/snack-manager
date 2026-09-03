import type { LoyaltyCustomerCard } from "@sm/contracts";

/**
 * LES PALIERS — la seule mécanique de la carte qui porte une émotion.
 *
 * Tout ce fichier est PUR : il ne connaît ni React, ni le DOM, ni le réseau.
 * C'est ce qui permet de prouver sans navigateur les deux règles qui comptent
 * — « quel palier vise-t-on » et « lequel vient d'être franchi » — là où la
 * carte les jouait jusqu'ici en ligne, dans le corps du composant, sans test.
 */

export type Recompense = LoyaltyCustomerCard["rewards"][number];

/**
 * Le palier VISÉ : le moins cher de ceux qui restent hors de portée.
 *
 * `null` quand le solde les atteint tous — ce qui n'est pas une erreur mais
 * l'état d'un très bon client, et la jauge doit alors être pleine plutôt que
 * vide (c'est le piège qu'un simple `find()` sans repli produisait).
 */
export function prochainPalier(
  recompenses: readonly Recompense[],
  solde: number,
): Recompense | null {
  let vise: Recompense | null = null;
  for (const recompense of recompenses) {
    if (recompense.costUnits <= solde) continue;
    if (!vise || recompense.costUnits < vise.costUnits) vise = recompense;
  }
  return vise;
}

/**
 * L'avancement vers le palier visé, en pourcentage entier (0 à 100).
 *
 * Aucun palier à viser ⇒ 100 : la jauge est pleine, pas vide. Un coût nul ou
 * négatif ne peut pas venir du contrat (`costUnits` y est un entier positif),
 * mais une division par zéro rendrait `NaN` jusque dans un attribut ARIA — la
 * garde coûte une ligne.
 */
export function progressionVers(solde: number, palier: Recompense | null): number {
  if (!palier) return 100;
  if (palier.costUnits <= 0) return 100;
  return Math.min(100, Math.max(0, Math.round((solde / palier.costUnits) * 100)));
}

/**
 * LES PALIERS QUI VIENNENT D'ÊTRE FRANCHIS — et pourquoi c'est un DELTA.
 *
 * Célébrer « toutes les récompenses accessibles » ferait une fête à chaque
 * ouverture de l'application, y compris pour un palier atteint il y a trois
 * semaines : la fête cesserait d'être un événement au deuxième lancement. Ce
 * qui se célèbre est donc la TRANSITION — une récompense qui n'était pas
 * accessible et qui l'est devenue entre deux états de la carte.
 *
 * Sans état précédent (première ouverture, carte restaurée depuis l'appareil),
 * rien n'est franchi : on ne fête pas ce qu'on découvre.
 *
 * Comparaison par `id` et non par rang : le catalogue du restaurant bouge
 * (récompense ajoutée, retirée, renommée), et deux tableaux d'index alignés
 * auraient célébré un décalage de liste.
 */
export function paliersFranchis(
  avant: LoyaltyCustomerCard | null,
  apres: LoyaltyCustomerCard,
): Recompense[] {
  if (!avant) return [];
  const accessiblesAvant = new Set(
    avant.rewards.filter((r) => r.affordable).map((r) => r.id),
  );
  return apres.rewards.filter((r) => r.affordable && !accessiblesAvant.has(r.id));
}

/** L'écart de solde entre deux états — le « +6 » annoncé après un scan. */
export function deltaDeSolde(
  avant: LoyaltyCustomerCard | null,
  apres: LoyaltyCustomerCard,
): number {
  if (!avant) return 0;
  return apres.member.balanceUnits - avant.member.balanceUnits;
}

/** « point » ou « points » selon le nombre — l'accord, écrit une fois. */
export function unitePour(
  nombre: number,
  singulier: string,
  pluriel: string,
): string {
  return Math.abs(nombre) === 1 ? singulier : pluriel;
}

/** Le nombre tel que la France l'écrit — séparateur de milliers compris. */
export function chiffre(valeur: number): string {
  return valeur.toLocaleString("fr-FR");
}

/**
 * La phrase du bas de jauge — celle que le client lit juste avant de toucher
 * « Commander ». Elle est ici, et non dans le JSX, parce qu'elle a trois cas
 * et que le troisième (le palier tout juste atteint) n'existait pas.
 */
export function phraseDeProgression(
  solde: number,
  palier: Recompense | null,
  singulier: string,
  pluriel: string,
): string {
  if (!palier) return "Votre solde atteint tous les paliers publiés.";
  const restant = palier.costUnits - solde;
  if (restant <= 0) return `« ${palier.name} » est à vous.`;
  return `Encore ${chiffre(restant)} ${unitePour(restant, singulier, pluriel)} pour « ${palier.name} »`;
}
