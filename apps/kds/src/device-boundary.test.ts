import { describe, expect, it } from 'vitest';
import { belongsToApp, pairingRequest } from './device-boundary';

describe("frontière d'appairage de la cuisine", () => {
  it('annonce toujours KDS au serveur', () => {
    expect(pairingRequest('4KP7RM')).toEqual({ pairingCode: '4KP7RM', expectedKind: 'kds' });
  });

  it("refuse l'identité d'une caisse", () => {
    expect(belongsToApp({ kind: 'kds' })).toBe(true);
    expect(belongsToApp({ kind: 'pos' })).toBe(false);
  });
});
