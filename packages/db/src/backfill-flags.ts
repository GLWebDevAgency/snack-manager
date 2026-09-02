/**
 * Les drapeaux communs aux reprises `backfill:*`, et le code de sortie qui
 * fait ÉCHOUER une relance de contrôle.
 *
 * ── Pourquoi un module partagé ────────────────────────────────────────────
 *
 * `scripts/reprise-mongo.sh` relance chaque reprise après l'avoir appliquée,
 * et `docs/CI-CD.md` en fait une promesse : « elle ne doit plus rien
 * trouver ». Tant que cette relance ne faisait qu'AFFICHER son décompte, la
 * promesse n'était vérifiée par personne — le script sortait en succès même
 * quand la seconde passe retrouvait des documents, et c'est l'œil de
 * l'opérateur qui devait remarquer la ligne « N tenant(s) ». `--exiger-zero`
 * convertit ce décompte en code de sortie ; le `set -e` du script s'arrête
 * alors sur place.
 *
 * Une convention de code de sortie recopiée dans quatre scripts dérive au
 * premier oubli : elle vit ici, une fois.
 */

/**
 * Le code que rend une reprise à qui reste du travail sous `--exiger-zero`.
 *
 * Choisi hors des codes déjà pris : 1 = erreur inattendue (le `catch` de
 * chaque reprise), 2 = mauvais usage (`reprise-mongo.sh`).
 */
export const CODE_RESTE_A_FAIRE = 3;

export type Drapeaux = {
  /** Sans lui, une reprise LIT et n'écrit rien. C'est le défaut, toujours. */
  appliquer: boolean;
  /** Sortir en échec s'il reste du travail — la relance de contrôle. */
  exigerZero: boolean;
};

export function lireDrapeaux(argv: readonly string[] = process.argv.slice(2)): Drapeaux {
  return {
    appliquer: argv.includes('--appliquer'),
    exigerZero: argv.includes('--exiger-zero'),
  };
}

/**
 * Convertit « il reste du travail » en échec de processus.
 *
 * On POSE `process.exitCode` au lieu d'appeler `process.exit()` : l'appelant
 * doit encore fermer sa connexion Mongo, et un `exit()` immédiat couperait la
 * sortie standard avant que le compte rendu soit écrit — l'opérateur verrait
 * un échec sans sa raison.
 */
export function exigerZero(drapeaux: Drapeaux, reste: number, quoi: string): void {
  if (!drapeaux.exigerZero || reste === 0) return;
  console.error(
    `\n✗ --exiger-zero : ${reste} ${quoi}. La reprise n'est pas terminée — voir le détail ci-dessus.\n`,
  );
  process.exitCode = CODE_RESTE_A_FAIRE;
}
