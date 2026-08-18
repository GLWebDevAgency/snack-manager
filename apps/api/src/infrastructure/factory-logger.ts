/**
 * Journal minimal attendu par les fabriques d'adaptateurs.
 *
 * Deux méthodes, pas tout `Logger` : une fabrique se teste en vérifiant qu'elle
 * a bien PRÉVENU quand la configuration manquait. Cette ligne de démarrage est
 * la seule trace qui dit pourquoi le rattachement de domaine répond
 * « indisponible » en production — elle mérite d'être testée, donc d'être
 * remplaçable.
 */
export interface FactoryLogger {
  log(message: string): void;
  warn(message: string): void;
}
