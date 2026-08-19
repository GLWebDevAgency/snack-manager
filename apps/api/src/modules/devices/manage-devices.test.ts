import { beforeEach, describe, expect, it } from 'vitest';
import { DEVICE_OFFLINE_AFTER_MS, PAIRING_CODE_TTL_MS, isPairingCodeShape } from '@sm/contracts';
import { ManageDevices } from './manage-devices.usecase';
import { FakeDevicesRepository, TestClock, storedDevice } from './devices.fakes';

const TENANT = '65f000000000000000000001';
const OTHER_TENANT = '65f000000000000000000002';

describe('Back-office des appareils', () => {
  let clock: TestClock;
  let repository: FakeDevicesRepository;
  let manage: ManageDevices;

  beforeEach(() => {
    clock = new TestClock(new Date('2026-08-19T10:00:00Z'));
    repository = new FakeDevicesRepository();
    manage = new ManageDevices(clock, repository.asRepository());
  });

  it('un appareil naît avec un code lisible, prêt à saisir', async () => {
    const created = await manage.create(TENANT, { name: 'Caisse comptoir', kind: 'pos' });

    expect(created.paired).toBe(false);
    expect(created.statusLabel).toBe("En attente d'appairage");
    expect(created.kindLabel).toBe('Caisse');
    // Alphabet sans I, O, 0 ni 1 : le code se recopie sans erreur de lecture.
    expect(isPairingCodeShape(created.pairing?.code ?? '')).toBe(true);
    expect(Date.parse(created.pairing!.expiresAt)).toBe(
      clock.now().getTime() + PAIRING_CODE_TTL_MS,
    );
  });

  it("l'appareil d'un autre établissement est invisible et intouchable", async () => {
    repository.seed(storedDevice({ id: 'device-x', tenantId: OTHER_TENANT }));

    expect(await manage.list(TENANT)).toHaveLength(0);
    // Le tenantId vient du token : deviner un identifiant ne suffit jamais.
    await expect(manage.get(TENANT, 'device-x')).rejects.toThrow(/introuvable/);
    await expect(manage.regenerateCode(TENANT, 'device-x')).rejects.toThrow(/introuvable/);
    await expect(manage.remove(TENANT, 'device-x')).rejects.toThrow(/introuvable/);
  });

  it('régénérer un code révoque le jeton de la tablette perdue', async () => {
    repository.seed(storedDevice({ paired: true, lastSeenAt: clock.now() }), 'jeton-volé');
    expect(await repository.findByDeviceToken('jeton-volé')).not.toBeNull();

    const updated = await manage.regenerateCode(TENANT, 'device-1');

    expect(updated.paired).toBe(false);
    expect(isPairingCodeShape(updated.pairing?.code ?? '')).toBe(true);
    // C'est le SEUL geste qui coupe l'accès d'une tablette disparue.
    expect(await repository.findByDeviceToken('jeton-volé')).toBeNull();
  });

  it('le code disparaît de la vue dès que l’appareil est appairé', async () => {
    repository.seed(storedDevice({ paired: true, lastSeenAt: clock.now() }));
    const view = (await manage.list(TENANT))[0]!;
    expect(view.pairing).toBeNull();
    expect(view.statusLabel).toBe('En ligne');
  });

  it('le silence se raconte en minutes, pas en horodatage', async () => {
    repository.seed(storedDevice({ paired: true, lastSeenAt: clock.now() }));
    clock.advanceMinutes(DEVICE_OFFLINE_AFTER_MS / 60_000 + 7);

    const view = (await manage.list(TENANT))[0]!;
    expect(view.online).toBe(false);
    // Un gérant ne doit pas faire de soustraction pour savoir si sa caisse
    // encaisse encore.
    expect(view.statusLabel).toBe('Hors ligne depuis 12 min');
  });

  it('un appareil appairé mais jamais revu est nommé comme tel', async () => {
    repository.seed(storedDevice({ paired: true, lastSeenAt: null }));
    const view = (await manage.list(TENANT))[0]!;
    expect(view.statusLabel).toBe('Jamais connecté');
    expect(view.online).toBe(false);
  });

  it('renommer ne touche ni au code ni à l’appairage', async () => {
    repository.seed(storedDevice({ paired: true, lastSeenAt: clock.now() }), 'jeton');
    const updated = await manage.update(TENANT, 'device-1', { name: 'Caisse terrasse' });

    expect(updated.name).toBe('Caisse terrasse');
    expect(updated.paired).toBe(true);
    expect(await repository.findByDeviceToken('jeton')).not.toBeNull();
  });
});
