import { describe, expect, it } from 'vitest';
import { belongsToApp, pairingRequest } from './device-boundary';

describe("frontière d'appairage de la caisse", () => {
  it('annonce toujours POS au serveur', () => {
    expect(pairingRequest('4KP7RM')).toEqual({ pairingCode: '4KP7RM', expectedKind: 'pos' });
  });

  it("refuse l'identité d'un écran cuisine", () => {
    expect(belongsToApp({ kind: 'pos' })).toBe(true);
    expect(belongsToApp({ kind: 'kds' })).toBe(false);
  });
});
