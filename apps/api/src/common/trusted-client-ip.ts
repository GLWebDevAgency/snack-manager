import { isIP } from 'node:net';

type IpRequest = {
  headers?: Record<string, unknown>;
  socket?: { remoteAddress?: string | null };
};

/**
 * Identité réseau des limites publiques.
 *
 * Railway documente `X-Real-IP` comme l'adresse distante du client. Nous ne
 * lisons jamais `X-Forwarded-For` : Express peut y accepter une valeur posée
 * par l'appelant avant le hop Railway. Hors Railway (tests/dev), l'adresse du
 * socket reste le repli sûr ; une absence regroupe au lieu d'ouvrir un bucket
 * neuf par chaîne arbitraire.
 */
export function trustedClientIp(request: IpRequest): string {
  const header = singleHeader(request.headers?.['x-real-ip']);
  if (header && isIP(header)) return header;

  const socket = request.socket?.remoteAddress?.trim();
  if (socket && isIP(socket)) return socket;
  return 'inconnu';
}

function singleHeader(value: unknown): string | null {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value) && value.length === 1 && typeof value[0] === 'string') {
    return value[0].trim();
  }
  return null;
}
