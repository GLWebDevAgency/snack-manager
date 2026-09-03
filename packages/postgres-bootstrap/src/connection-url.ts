import { isAbsolute } from 'node:path';

type ConnectionUrlOptions = Readonly<{
  variableName: string;
  expectedDatabase: string;
  expectedRole?: string;
  expectedHost?: string;
  expectedPort?: string;
  forbiddenRoles?: readonly string[];
}>;

/**
 * Refuse d'ouvrir une connexion privilégiée tant que libpq ne vérifiera pas
 * l'identité du serveur. Cette validation précède volontairement `new Pool` :
 * une URL mal configurée ne doit jamais tenter une première socket en clair.
 */
export function authenticatedPostgresUrl(
  rawValue: string | undefined,
  options: ConnectionUrlOptions,
): string {
  const raw = rawValue ?? '';
  const value = raw.trim();
  if (!value || value !== raw) throw new Error(`${options.variableName} manquant ou entouré d’espaces`);

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${options.variableName} doit être une URL PostgreSQL valide`);
  }
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !url.username ||
    !url.password ||
    !url.hostname ||
    decodeURIComponent(url.pathname) !== `/${options.expectedDatabase}`
  ) {
    throw new Error(
      `${options.variableName} doit contenir identité, secret, hôte et base PostgreSQL attendue`,
    );
  }

  const role = decodeURIComponent(url.username);
  if (options.expectedRole && role !== options.expectedRole) {
    throw new Error(`${options.variableName} n’utilise pas le rôle PostgreSQL attendu`);
  }
  if (options.forbiddenRoles?.includes(role)) {
    throw new Error(`${options.variableName} réutilise une identité applicative interdite`);
  }
  if (options.expectedHost !== undefined && url.hostname !== options.expectedHost) {
    throw new Error(`${options.variableName} ne cible pas l’hôte PostgreSQL attendu`);
  }
  if (options.expectedPort !== undefined && url.port !== options.expectedPort) {
    throw new Error(`${options.variableName} ne cible pas le port PostgreSQL attendu`);
  }

  const allowedParameters = new Set(['sslmode', 'uselibpqcompat', 'sslrootcert']);
  const parameters = [...url.searchParams.keys()];
  if (
    parameters.some((name) => !allowedParameters.has(name)) ||
    [...allowedParameters].some((name) => url.searchParams.getAll(name).length > 1)
  ) {
    throw new Error(`${options.variableName} contient des paramètres TLS ambigus`);
  }

  const verifyFull =
    url.searchParams.get('sslmode') === 'verify-full' && parameters.length === 1;
  const rootCertificate = url.searchParams.get('sslrootcert');
  const verifyCa =
    url.searchParams.get('sslmode') === 'verify-ca' &&
    url.searchParams.get('uselibpqcompat') === 'true' &&
    Boolean(rootCertificate && isAbsolute(rootCertificate)) &&
    parameters.length === 3;
  if (!verifyFull && !verifyCa) {
    throw new Error(
      `${options.variableName} doit authentifier PostgreSQL avec sslmode=verify-full ou verify-ca`,
    );
  }

  return value;
}
