import { beforeEach, describe, expect, it } from 'vitest';
import { CheckDomainStatus } from './check-domain-status.usecase';
import { RemoveCustomDomain } from './remove-custom-domain.usecase';
import { HostResolutionCache } from './host-resolution.cache';
import { FakeRegistrar, FakeRepository, TestClock } from './site.fakes';

const CLASSFOOD = '65f000000000000000000001';
const VOISIN = '65f000000000000000000002';

describe('Vérifier et détacher un domaine', () => {
  let registrar: FakeRegistrar;
  let repository: FakeRepository;
  let clock: TestClock;
  let cache: HostResolutionCache;
  let check: CheckDomainStatus;
  let remove: RemoveCustomDomain;

  beforeEach(() => {
    registrar = new FakeRegistrar();
    repository = new FakeRepository();
    repository.registerTenant(CLASSFOOD, 'classfood');
    repository.registerTenant(VOISIN, 'tacos-du-coin');
    clock = new TestClock();
    cache = new HostResolutionCache(clock);
    check = new CheckDomainStatus(registrar, clock, repository.asRepository(), cache);
    remove = new RemoveCustomDomain(registrar, repository.asRepository(), cache);
  });

  it("« Vérifier maintenant » reporte le verdict du fournisseur", async () => {
    const seeded = repository.seed(CLASSFOOD, { hostname: 'commander.classfood.fr' });
    registrar.nextCheck = { status: 'active' };

    const updated = await check.execute(CLASSFOOD, seeded.id);
    expect(updated.status).toBe('active');
    expect(updated.statusLabel).toBe('Actif');
    expect(updated.lastCheckedAt).toBe(clock.now().toISOString());
  });

  it("la cause d'un échec est conservée pour être affichée au gérant", async () => {
    const seeded = repository.seed(CLASSFOOD, { hostname: 'commander.classfood.fr' });
    registrar.nextCheck = { status: 'failed', detail: 'CNAME absent de la zone' };

    const updated = await check.execute(CLASSFOOD, seeded.id);
    expect(updated.status).toBe('failed');
    expect(updated.detail).toBe('CNAME absent de la zone');
  });

  it("le domaine d'un autre établissement reste introuvable", async () => {
    // Isolation tenant : deviner un identifiant ne doit rien ouvrir.
    const seeded = repository.seed(VOISIN, { hostname: 'commander.tacos.fr' });
    await expect(check.execute(CLASSFOOD, seeded.id)).rejects.toThrow(/introuvable/);
  });

  it('détacher libère chez le fournisseur avant de retirer de la base', async () => {
    const seeded = repository.seed(CLASSFOOD, {
      hostname: 'commander.classfood.fr',
      status: 'active',
    });

    const result = await remove.execute(CLASSFOOD, seeded.id);
    expect(result.removed).toBe('commander.classfood.fr');
    expect(registrar.released).toEqual([seeded.providerId]);
    expect(await repository.list(CLASSFOOD)).toEqual([]);
  });

  it('un fournisseur injoignable ne fait pas disparaître la ligne', async () => {
    // Sinon le domaine resterait rattaché chez l'hébergeur sans que personne
    // ne le sache : il continuerait à servir au nom d'un restaurant qui ne le
    // contrôle plus.
    const seeded = repository.seed(CLASSFOOD, { hostname: 'commander.classfood.fr' });
    registrar.failRelease = true;

    await expect(remove.execute(CLASSFOOD, seeded.id)).rejects.toThrow(/hébergeur/);
    expect(await repository.list(CLASSFOOD)).toHaveLength(1);
  });
});
