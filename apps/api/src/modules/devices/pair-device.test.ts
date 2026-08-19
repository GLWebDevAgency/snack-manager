import { beforeEach, describe, expect, it } from 'vitest';
import { PAIRING_CODE_TTL_MS } from '@sm/contracts';
import { PairDeviceUseCase } from './pair-device.usecase';
import {
  FakeDevicesRepository,
  FakeTenantBrandRepository,
  TestClock,
  storedDevice,
} from './devices.fakes';

const CODE = '4KP7RM';
const START = '2026-08-19T10:00:00Z';

describe('Appairer une caisse', () => {
  let clock: TestClock;
  let repository: FakeDevicesRepository;
  let tenants: FakeTenantBrandRepository;
  let useCase: PairDeviceUseCase;

  beforeEach(() => {
    clock = new TestClock(new Date(START));
    repository = new FakeDevicesRepository();
    tenants = new FakeTenantBrandRepository();
    repository.seed(
      storedDevice({
        paired: false,
        pairingCode: CODE,
        pairingCodeExpiresAt: new Date(Date.parse(START) + PAIRING_CODE_TTL_MS),
      }),
    );
    useCase = new PairDeviceUseCase(clock, repository.asRepository(), tenants.asRepository());
  });

  it("remet un jeton long, l'identité de l'appareil ET la marque du restaurant", async () => {
    const paired = await useCase.execute(CODE);

    // C'est LA raison d'être du module : la caisse apprend ici à quel
    // restaurant elle appartient, au lieu de le porter en dur dans son code.
    expect(paired.tenant.slug).toBe('classfood');
    expect(paired.tenant.name).toBe("Class'Food");
    expect(paired.tenant.brandColor).toBe('#c9a15a');
    expect(paired.device).toMatchObject({ name: 'Caisse comptoir', kind: 'pos' });
    expect(paired.device.kindLabel).toBe('Caisse');
    expect(paired.deviceToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await repository.findByDeviceToken(paired.deviceToken)).not.toBeNull();
  });

  it('accepte le code recopié en minuscules avec un tiret', async () => {
    // Le gérant lit « 4KP7RM » sur son écran et tape ce qu'il veut.
    await expect(useCase.execute(' 4kp-7rm ')).resolves.toMatchObject({
      device: { id: 'device-1' },
    });
  });

  it("le code est à usage unique : le second appareil n'obtient rien", async () => {
    await useCase.execute(CODE);
    // La caisse et l'écran cuisine déballés ensemble ne peuvent pas se
    // partager un jeton — sinon deux tablettes portent la même identité.
    await expect(useCase.execute(CODE)).rejects.toThrow(/Code inconnu/);
  });

  it('un code expiré est refusé, avec la marche à suivre', async () => {
    clock.advanceMinutes(PAIRING_CODE_TTL_MS / 60_000 + 1);
    await expect(useCase.execute(CODE)).rejects.toThrow(/expiré/);
  });

  it('le code vaut encore à la dernière seconde du quart d’heure', async () => {
    clock.set(new Date(Date.parse(START) + PAIRING_CODE_TTL_MS - 1_000));
    await expect(useCase.execute(CODE)).resolves.toMatchObject({ device: { id: 'device-1' } });
  });

  it('une saisie qui n’a pas la forme d’un code est refusée avant toute lecture', async () => {
    // `0` et `I` ne font pas partie de l'alphabet : inutile d'aller en base.
    await expect(useCase.execute('4KP7R0')).rejects.toThrow(/6 caractères/);
    await expect(useCase.execute('4KP7R')).rejects.toThrow(/6 caractères/);
  });

  it('appairer date immédiatement le premier signe de vie et efface le code', async () => {
    const paired = await useCase.execute(CODE);
    const device = await repository.findByDeviceToken(paired.deviceToken);
    expect(device?.lastSeenAt?.toISOString()).toBe(new Date(START).toISOString());
    expect(device?.pairingCode).toBeNull();
  });

  it('un établissement introuvable ne brûle pas le code', async () => {
    tenants.set(null);
    await expect(useCase.execute(CODE)).rejects.toThrow(/Établissement introuvable/);

    // Le gérant doit pouvoir réessayer sans repasser par le back-office.
    tenants.set({ slug: 'classfood', name: "Class'Food", brandColor: '#c9a15a', logoUrl: null });
    await expect(useCase.execute(CODE)).resolves.toMatchObject({ device: { id: 'device-1' } });
  });
});
