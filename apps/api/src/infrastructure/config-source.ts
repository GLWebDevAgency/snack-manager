/**
 * Accès à la configuration, réduit à ce dont les adaptateurs ont besoin.
 *
 * Une fonction plutôt que `ConfigService` : lire des variables d'environnement
 * est une opération pure, elle se teste avec un objet littéral et n'a aucune
 * raison de traîner Nest derrière elle. Les fabriques deviennent des fonctions
 * ordinaires, testables sans monter un module.
 */
export type ConfigSource = (key: string) => string | undefined;

/** Adapte un `ConfigService` Nest — ou n'importe quoi qui sait lire une clé. */
export function configSourceOf(config: {
  get<T = string>(key: string): T | undefined;
}): ConfigSource {
  return (key) => config.get<string>(key);
}

/** Lit une clé en refusant les valeurs blanches (« ” » copié depuis un tableur). */
export function readNonEmpty(get: ConfigSource, key: string): string | null {
  return get(key)?.trim() || null;
}
