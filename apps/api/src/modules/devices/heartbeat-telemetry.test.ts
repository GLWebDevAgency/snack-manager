import { beforeEach, describe, expect, it } from 'vitest';
import { HeartbeatDevice } from './heartbeat-device.usecase';
import {
  FakeDevicesRepository,
  FakeTenantBrandRepository,
  TestClock,
  storedDevice,
} from './devices.fakes';

const TOKEN = 'dev_tok_telemetrie';
const START = '2026-08-24T10:00:00Z';

/**
 * TÉLÉMÉTRIE DU BATTEMENT — diagnostic quatre casquettes, P2.
 *
 * Le battement partait vide : au téléphone, l'équipe savait « en ligne /
 * muet » et rien d'autre. Ces tests verrouillent les deux contrats du champ :
 * un battement RICHE écrit la version, la file et la dernière erreur ; un
 * battement PAUVRE (vieux client, corps vide) ne les efface pas.
 */
describe('Télémétrie du battement de cœur', () => {
  let devices: FakeDevicesRepository;
  let heartbeat: HeartbeatDevice;

  beforeEach(async () => {
    devices = new FakeDevicesRepository();
    devices.seed(storedDevice({ id: 'device-1', paired: false, pairingCode: 'ABCDEF' }));
    await devices.claim('device-1', 'ABCDEF', TOKEN, new Date(START));
    heartbeat = new HeartbeatDevice(
      new TestClock(new Date(START)),
      devices.asRepository(),
      new FakeTenantBrandRepository().asRepository(),
    );
  });

  it('enregistre version, file et dernière erreur', async () => {
    await heartbeat.execute(TOKEN, {
      appVersion: '1.0.0',
      queueDepth: 12,
      lastError: 'Session expirée',
    });
    const stored = await devices.asRepository().findByDeviceToken(TOKEN);
    expect(stored?.appVersion).toBe('1.0.0');
    expect(stored?.queueDepth).toBe(12);
    expect(stored?.lastError).toBe('Session expirée');
  });

  it('un battement sans télémétrie ne défait pas ce qu’un battement riche a appris', async () => {
    await heartbeat.execute(TOKEN, { appVersion: '1.0.0', queueDepth: 3, lastError: 'x' });
    // Le vieux client — ou la route rejouée sans corps : la date seule bouge.
    await heartbeat.execute(TOKEN);
    const stored = await devices.asRepository().findByDeviceToken(TOKEN);
    expect(stored?.appVersion).toBe('1.0.0');
    expect(stored?.queueDepth).toBe(3);
  });

  it('une file redescendue à zéro et une erreur levée s’EFFACENT, elles', async () => {
    // L'état est un PRÉSENT, pas un historique : quand la tablette dit « tout
    // est parti, plus d'erreur », l'écran doit cesser d'inquiéter.
    await heartbeat.execute(TOKEN, { appVersion: '1.0.0', queueDepth: 9, lastError: 'panne' });
    await heartbeat.execute(TOKEN, { appVersion: '1.0.0', queueDepth: 0, lastError: '' });
    const stored = await devices.asRepository().findByDeviceToken(TOKEN);
    expect(stored?.queueDepth).toBe(0);
    expect(stored?.lastError).toBe('');
  });
});
