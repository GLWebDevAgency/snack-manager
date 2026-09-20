import { type KeyValueStore } from '@sm/client-core';
import { getToken } from '@/lib/api';

const identityError = () => new Error('Votre session a changé. Fermez cette fenêtre et reconnectez-vous avant de reprendre.');

/** Local fence only; JWT signature and owner role remain API responsibilities.
 * Neither token nor password is written to the refund journal. */
export function refundSession(readToken: () => string | null = getToken, now = Date.now) {
  const token = readToken();
  if (!token) throw identityError();
  let claims: { tenantId: string; sub: string; exp: number };
  try {
    const encoded = token.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/');
    const raw = JSON.parse(decodeURIComponent(Array.from(atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '=')))
      .map(char => `%${char.charCodeAt(0).toString(16).padStart(2, '0')}`).join('')));
    if (!raw || raw.kind !== 'user' || raw.role !== 'owner' || !/^[a-f0-9]{24}$/.test(raw.tenantId)
      || !/^[a-f0-9]{24}$/.test(raw.sub) || !Number.isSafeInteger(raw.exp) || !Number.isSafeInteger(raw.exp * 1000) || raw.exp * 1000 <= now()) throw identityError();
    claims = raw;
  } catch { throw identityError(); }
  const assertCurrent = () => {
    if (readToken() !== token || claims.exp * 1000 <= now()) throw identityError();
  };
  const storage = () => {
    assertCurrent();
    if (!globalThis.localStorage) throw new Error('Le stockage durable est indisponible. Aucun remboursement ne sera envoyé.');
    return globalThis.localStorage;
  };
  // Shared origin journal: owners cannot hide competing intentions in separate
  // keys. The shared core performs its compare-and-set under Web Locks.
  const store: KeyValueStore = {
    async getItem(key) { return storage().getItem(key); },
    async setItem(key, value) {
      storage().setItem(key, value);
      if (storage().getItem(key) !== value) throw new Error('La demande n’a pas été conservée. Aucun envoi supplémentaire n’est autorisé.');
    },
    async removeItem(key) {
      storage().removeItem(key);
      if (storage().getItem(key) !== null) throw new Error('La confirmation locale n’a pas été conservée. Vérifiez le journal avant de poursuivre.');
    },
  };
  return { ownerId: `${claims.tenantId}:user:${claims.sub}`, assertCurrent, store };
}
