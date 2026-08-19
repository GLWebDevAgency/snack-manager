import { beforeEach, describe, expect, it } from 'vitest';
import { HeartbeatDevice } from './heartbeat-device.usecase';
import { FakeDevicesRepository, FakeTenantBrandRepository, TestClock, storedDevice } from './devices.fakes';

const TOKEN = 'dev_tok_suspension';
const START = '2026-08-19T10:00:00Z';

/**
 * SUSPENSION D'ABONNEMENT VUE PAR UNE TABLETTE DÉJÀ APPAIRÉE.
 *
 * Ces surfaces sont le trou que la première version de la suspension avait
 * laissé ouvert : une caisse ne présente pas de JWT pour vivre, elle présente
 * son jeton d'appareil, qui ne traverse pas le guard global. Le parc déjà
 * installé — c'est-à-dire la totalité du parc en service — continuait donc de
 * fonctionner normalement chez un client qu'on venait de couper.
 */
describe('Abonnement suspendu et appareils de terrain', () => {
  let clock: TestClock;
  let devices: FakeDevicesRepository;
  let tenants: FakeTenantBrandRepository;
  let heartbeat: HeartbeatDevice;

  beforeEach(async () => {
    clock = new TestClock(new Date(START));
    devices = new FakeDevicesRepository();
    tenants = new FakeTenantBrandRepository();
    // `StoredDevice` ne porte pas le jeton — il n'a rien à faire dans une vue
    // de lecture. On appaire donc l'appareil comme le ferait la tablette, en
    // passant par le code, ce qui enregistre le jeton dans le dépôt.
    devices.seed(storedDevice({ id: 'device-1', paired: false, pairingCode: 'ABCDEF' }));
    await devices.claim('device-1', 'ABCDEF', TOKEN, new Date(START));
    heartbeat = new HeartbeatDevice(clock, devices.asRepository(), tenants.asRepository());
  });

  it('accepte le battement d’un client suspendu, et le signale', async () => {
    tenants.setStatus('suspended');

    const result = await heartbeat.execute(TOKEN);

    // Le battement PASSE : c'est un signe de vie, pas un acte de commerce. Le
    // support a besoin de voir la tablette allumée pour aider au téléphone —
    // la faire disparaître du parc au moment où le dossier se tend serait
    // exactement le contraire de ce qu'on veut.
    expect(result.ok).toBe(true);
    // …mais il porte l'information, pour que la caisse verrouille son écran
    // tout de suite au lieu d'échouer plus tard devant un client, au moment
    // d'encaisser.
    expect(result.suspended).toBe(true);
  });

  it('ne transporte rien de plus chez un client à jour', async () => {
    tenants.setStatus('active');

    const result = await heartbeat.execute(TOKEN);

    expect(result.ok).toBe(true);
    expect(result.suspended).toBeUndefined();
  });

  it('laisse travailler un établissement sans champ `account`', async () => {
    // Tous les tenants antérieurs à la facturation sont dans ce cas, et
    // `.lean()` ne matérialise pas les défauts Mongoose. Un champ absent ne
    // doit JAMAIS verrouiller une caisse en plein coup de feu.
    tenants.setStatus(undefined);

    const result = await heartbeat.execute(TOKEN);

    expect(result.ok).toBe(true);
    expect(result.suspended).toBeUndefined();
  });

  it('ne verrouille pas un client qui nous a quittés', async () => {
    // `churned` n'est pas `suspended` : couper l'accès est un geste explicite
    // et motivé, jamais un effet de bord du départ.
    tenants.setStatus('churned');

    const result = await heartbeat.execute(TOKEN);

    expect(result.suspended).toBeUndefined();
  });
});
