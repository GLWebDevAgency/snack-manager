import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PAIRING_CODE_TTL_MS, type DeviceKind } from '@sm/contracts';
import { PairDeviceUseCase } from './pair-device.usecase';
import {
  FakeDevicesRepository,
  FakeTenantBrandRepository,
  TestClock,
  storedDevice,
} from './devices.fakes';

const CODE = '4KP7RM';
const START = '2026-08-19T10:00:00Z';
const TENANT = '65f000000000000000000001';

describe('Appairer une caisse ou un écran cuisine', () => {
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

  const pair = (pairingCode = CODE, expectedKind: DeviceKind = 'pos') =>
    useCase.execute({ pairingCode, expectedKind });

  it("remet un jeton long, l'identité de l'appareil ET la marque du restaurant", async () => {
    const paired = await pair();

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

  it("refuse qu'une caisse consomme le code d'un écran cuisine", async () => {
    repository.seed(
      storedDevice({
        name: 'Écran cuisine',
        kind: 'kds',
        paired: false,
        pairingCode: CODE,
        pairingCodeExpiresAt: new Date(Date.parse(START) + PAIRING_CODE_TTL_MS),
      }),
    );

    await expect(pair(CODE, 'pos')).rejects.toThrow(/application Cuisine/i);

    expect(await repository.byId(TENANT, 'device-1')).toMatchObject({
      paired: false,
      pairingCode: CODE,
      lastSeenAt: null,
    });

    // Un refus de mauvaise application ne doit surtout pas brûler le code :
    // le cuisinier doit pouvoir le saisir ensuite sur le bon écran.
    await expect(pair(CODE, 'kds')).resolves.toMatchObject({
      device: { kind: 'kds' },
    });
  });

  it("refuse qu'un écran cuisine consomme le code d'une caisse", async () => {
    await expect(pair(CODE, 'kds')).rejects.toThrow(/application Caisse/i);
    await expect(pair(CODE, 'pos')).resolves.toMatchObject({ device: { kind: 'pos' } });
  });

  it("conditionne aussi atomiquement le claim au type de l'appareil", async () => {
    const claim = repository.claim.bind(repository);
    vi.spyOn(repository, 'claim').mockImplementation(async (...args) => {
      // Simule un changement de type entre le lookup et l'écriture Mongo.
      await repository.update(TENANT, 'device-1', { kind: 'kds' });
      return claim(...args);
    });

    await expect(pair()).rejects.toThrow(/vient d’être utilisé/);
    expect(await repository.byId(TENANT, 'device-1')).toMatchObject({
      kind: 'kds',
      paired: false,
      pairingCode: CODE,
    });
  });

  it('accepte le code recopié en minuscules avec un tiret', async () => {
    // Le gérant lit « 4KP7RM » sur son écran et tape ce qu'il veut.
    await expect(pair(' 4kp-7rm ')).resolves.toMatchObject({
      device: { id: 'device-1' },
    });
  });

  it("le code est à usage unique : le second appareil n'obtient rien", async () => {
    await pair();
    // La caisse et l'écran cuisine déballés ensemble ne peuvent pas se
    // partager un jeton — sinon deux tablettes portent la même identité.
    await expect(pair()).rejects.toThrow(/Code inconnu/);
  });

  it('un code expiré est refusé, avec la marche à suivre', async () => {
    clock.advanceMinutes(PAIRING_CODE_TTL_MS / 60_000 + 1);
    await expect(pair()).rejects.toThrow(/expiré/);
  });

  it('le code vaut encore à la dernière seconde du quart d’heure', async () => {
    clock.set(new Date(Date.parse(START) + PAIRING_CODE_TTL_MS - 1_000));
    await expect(pair()).resolves.toMatchObject({ device: { id: 'device-1' } });
  });

  it('une saisie qui n’a pas la forme d’un code est refusée avant toute lecture', async () => {
    // `0` et `I` ne font pas partie de l'alphabet : inutile d'aller en base.
    await expect(pair('4KP7R0')).rejects.toThrow(/6 caractères/);
    await expect(pair('4KP7R')).rejects.toThrow(/6 caractères/);
  });

  it('appairer date immédiatement le premier signe de vie et efface le code', async () => {
    const paired = await pair();
    const device = await repository.findByDeviceToken(paired.deviceToken);
    expect(device?.lastSeenAt?.toISOString()).toBe(new Date(START).toISOString());
    expect(device?.pairingCode).toBeNull();
  });

  it('un établissement introuvable ne brûle pas le code', async () => {
    tenants.set(null);
    await expect(pair()).rejects.toThrow(/Établissement introuvable/);

    // Le gérant doit pouvoir réessayer sans repasser par le back-office.
    tenants.set({ slug: 'classfood', name: "Class'Food", brandColor: '#c9a15a', logoUrl: null });
    await expect(pair()).resolves.toMatchObject({ device: { id: 'device-1' } });
  });
});
