import type { DeviceIdentity, DeviceKind, PairDevice } from '@sm/contracts';

/** Frontière immuable du bundle Cuisine : elle ne dépend d'aucune saisie. */
export const APP_DEVICE_KIND = 'kds' satisfies DeviceKind;

export function pairingRequest(pairingCode: string): PairDevice {
  return { pairingCode, expectedKind: APP_DEVICE_KIND };
}

export function belongsToApp(device: Pick<DeviceIdentity, 'kind'>): boolean {
  return device.kind === APP_DEVICE_KIND;
}
