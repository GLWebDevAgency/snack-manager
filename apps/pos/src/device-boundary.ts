import type { DeviceIdentity, DeviceKind, PairDevice } from '@sm/contracts';

/** Frontière immuable du bundle Caisse : elle ne dépend d'aucune saisie. */
export const APP_DEVICE_KIND = 'pos' satisfies DeviceKind;

export function pairingRequest(pairingCode: string): PairDevice {
  return { pairingCode, expectedKind: APP_DEVICE_KIND };
}

export function belongsToApp(device: Pick<DeviceIdentity, 'kind'>): boolean {
  return device.kind === APP_DEVICE_KIND;
}
