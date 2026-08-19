import { beforeEach, describe, expect, it } from 'vitest';
import { PAIRING_CODE_TTL_MS } from '@sm/contracts';
import { PairScreenDevice } from './pair-screen.usecase';
import { FakeScreensRepository, TestClock, storedScreen } from './screens.fakes';

const CODE = '4KP7RM';
const START = '2026-08-19T10:00:00Z';

describe('Appairer un écran', () => {
  let clock: TestClock;
  let repository: FakeScreensRepository;
  let useCase: PairScreenDevice;

  beforeEach(() => {
    clock = new TestClock(new Date(START));
    repository = new FakeScreensRepository();
    repository.seed(
      storedScreen({
        paired: false,
        pairingCode: CODE,
        pairingCodeExpiresAt: new Date(Date.parse(START) + PAIRING_CODE_TTL_MS),
      }),
    );
    useCase = new PairScreenDevice(clock, repository.asRepository());
  });

  it("remet un jeton long et l'identité de l'écran", async () => {
    const paired = await useCase.execute(CODE);

    expect(paired.screenId).toBe('screen-1');
    expect(paired.name).toBe('Écran comptoir gauche');
    expect(paired.orientation).toBe('landscape');
    expect(paired.deviceToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await repository.findByDeviceToken(paired.deviceToken)).not.toBeNull();
  });

  it('accepte le code recopié en minuscules avec un tiret', async () => {
    // Le gérant lit « 4KP7RM » sur le téléviseur et tape ce qu'il veut.
    const paired = await useCase.execute(' 4kp-7rm ');
    expect(paired.screenId).toBe('screen-1');
  });

  it("le code est à usage unique : le deuxième écran n'obtient rien", async () => {
    await useCase.execute(CODE);
    // Un code affiché en salle reste lisible par n'importe qui : s'il servait
    // deux fois, l'écran d'un tiers afficherait la carte du restaurant.
    await expect(useCase.execute(CODE)).rejects.toThrow(/Code inconnu/);
  });

  it('un code expiré est refusé, avec la marche à suivre', async () => {
    clock.advanceMinutes(PAIRING_CODE_TTL_MS / 60_000 + 1);
    await expect(useCase.execute(CODE)).rejects.toThrow(/expiré/);
  });

  it('le code vaut encore à la dernière seconde du quart d’heure', async () => {
    // La borne compte : le gérant descend de l'escabeau puis cherche son
    // téléphone. Une expiration une minute trop tôt se paie en appels.
    clock.set(new Date(Date.parse(START) + PAIRING_CODE_TTL_MS - 1_000));
    await expect(useCase.execute(CODE)).resolves.toMatchObject({ screenId: 'screen-1' });
  });

  it('un code inconnu ne révèle pas l’existence des écrans', async () => {
    await expect(useCase.execute('9XZ4TQ')).rejects.toThrow(/Code inconnu/);
  });

  it('une saisie qui n’a pas la forme d’un code est refusée avant toute lecture', async () => {
    // `0` et `I` ne font pas partie de l'alphabet : inutile d'aller en base.
    await expect(useCase.execute('4KP7R0')).rejects.toThrow(/6 caractères/);
    await expect(useCase.execute('4KP7R')).rejects.toThrow(/6 caractères/);
  });

  it('appairer date immédiatement le premier signe de vie', async () => {
    const paired = await useCase.execute(CODE);
    const screen = await repository.findByDeviceToken(paired.deviceToken);
    expect(screen?.lastSeenAt?.toISOString()).toBe(new Date(START).toISOString());
    expect(screen?.pairingCode).toBeNull();
  });
});
