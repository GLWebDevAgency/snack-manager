import { describe, expect, it } from 'vitest';
import { PairDeviceSchema } from './devices';

describe("contrat d'appairage d'un appareil", () => {
  it("exige l'application qui présente le code", () => {
    expect(PairDeviceSchema.safeParse({ pairingCode: '4KP7RM' }).success).toBe(false);
    expect(
      PairDeviceSchema.safeParse({ pairingCode: '4KP7RM', expectedKind: 'screen' }).success,
    ).toBe(false);
  });

  it.each(['pos', 'kds'] as const)('conserve le type %s après validation', (expectedKind) => {
    expect(PairDeviceSchema.parse({ pairingCode: '4kp7rm', expectedKind })).toEqual({
      pairingCode: '4KP7RM',
      expectedKind,
    });
  });
});
