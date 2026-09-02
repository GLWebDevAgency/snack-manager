type RuntimeEnvironment = Record<string, unknown>;

const nonEmpty = (value: unknown): boolean =>
  typeof value === 'string' && value.trim().length > 0;

/**
 * Railway exécute staging et production avec les mêmes exigences de secrets.
 * NODE_ENV seul n'est pas une frontière fiable : une variable oubliée ne doit
 * jamais désactiver silencieusement les contrôles de démarrage.
 */
export function isDeployedRuntime(config: RuntimeEnvironment): boolean {
  return (
    config.NODE_ENV === 'production' ||
    nonEmpty(config.RAILWAY_ENVIRONMENT_NAME) ||
    nonEmpty(config.RAILWAY_ENVIRONMENT_ID)
  );
}
