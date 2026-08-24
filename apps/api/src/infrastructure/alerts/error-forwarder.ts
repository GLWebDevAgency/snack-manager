import type { ErrorReport } from '@sm/contracts';

/**
 * Relais OPTIONNEL du journal d'erreurs vers un collecteur externe.
 *
 * Le journal maison (`errorEvents`) reste la source de vérité : il marche
 * sans compte, sans clé, et nourrit l'écran /sm/erreurs comme le veilleur.
 * Ce relais n'ajoute que de la profondeur (contexte, regroupement Sentry)
 * quand la variable est posée — et `forward` est fire-and-forget : il ne
 * ralentit ni ne fait échouer l'enregistrement local.
 */
export interface ErrorForwarder {
  readonly enabled: boolean;
  forward(report: ErrorReport): void;
}

export const ERROR_FORWARDER = 'ERROR_FORWARDER';
