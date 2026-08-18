import { beforeEach, describe, expect, it } from 'vitest';
import { HostResolutionCache } from './host-resolution.cache';
import { ResolveTenantByHost, normalizeHost } from './resolve-tenant-by-host.usecase';
import { FakeRepository, TestClock, testSiteConfig } from './site.fakes';

const CLASSFOOD = '65f000000000000000000001';

describe('Nettoyage du Host entrant', () => {
  it('le port, la casse et le point final désignent le même établissement', () => {
    expect(normalizeHost('Commander.ClassFood.FR:3000')).toBe('commander.classfood.fr');
    expect(normalizeHost('commander.classfood.fr.')).toBe('commander.classfood.fr');
  });

  it('une URL collée en entier est ramenée au nom d’hôte', () => {
    expect(normalizeHost('https://commander.classfood.fr/menu?x=1')).toBe(
      'commander.classfood.fr',
    );
  });
});

describe('Résoudre une adresse vers un établissement', () => {
  let repository: FakeRepository;
  let clock: TestClock;
  let cache: HostResolutionCache;
  let useCase: ResolveTenantByHost;

  beforeEach(() => {
    repository = new FakeRepository();
    repository.registerTenant(CLASSFOOD, 'classfood');
    clock = new TestClock();
    cache = new HostResolutionCache(clock);
    useCase = new ResolveTenantByHost(repository.asRepository(), cache, testSiteConfig());
  });

  it('le sous-domaine Snack Manager résout sans aucune configuration', async () => {
    const resolved = await useCase.execute('classfood.snackmanager.app');
    expect(resolved.slug).toBe('classfood');
    expect(resolved.matchedBy).toBe('subdomain');
  });

  it('un domaine personnalisé actif résout vers son établissement', async () => {
    repository.seed(CLASSFOOD, { hostname: 'commander.classfood.fr', status: 'active' });
    const resolved = await useCase.execute('commander.classfood.fr');
    expect(resolved.tenantId).toBe(CLASSFOOD);
    expect(resolved.matchedBy).toBe('custom_domain');
  });

  it("un domaine dont le certificat n'est pas émis ne sert encore rien", async () => {
    // Servir avant l'émission afficherait une erreur TLS aux clients : mieux
    // vaut que l'adresse reste inconnue jusqu'à ce qu'elle fonctionne vraiment.
    repository.seed(CLASSFOOD, {
      hostname: 'commander.classfood.fr',
      status: 'issuing_certificate',
    });
    await expect(useCase.execute('commander.classfood.fr')).rejects.toThrow(
      /Aucun établissement/,
    );
  });

  it('un sous-domaine réservé ne peut pas être confondu avec un restaurant', async () => {
    // « admin.snackmanager.app » nous appartient : `TenantSlug` le refuse.
    await expect(useCase.execute('admin.snackmanager.app')).rejects.toThrow(
      /Aucun établissement/,
    );
  });

  it('un sous-domaine à deux niveaux n’est pas une adresse que nous servons', async () => {
    await expect(useCase.execute('demo.classfood.snackmanager.app')).rejects.toThrow(
      /Aucun établissement/,
    );
  });

  it('la racine seule ne désigne aucun établissement', async () => {
    await expect(useCase.execute('snackmanager.app')).rejects.toThrow(/Aucun établissement/);
  });

  it('une seconde requête sur la même adresse ne relit pas la base', async () => {
    // Le middleware du site public appelle cette route à chaque requête, images
    // comprises : sans cache, un service du soir noierait Mongo.
    await useCase.execute('classfood.snackmanager.app');
    const afterFirst = repository.reads;
    await useCase.execute('classfood.snackmanager.app');
    expect(repository.reads).toBe(afterFirst);
  });

  it('une adresse inconnue est mémorisée aussi, puis réessayée plus tard', async () => {
    await expect(useCase.execute('inconnu.snackmanager.app')).rejects.toThrow();
    const afterFirst = repository.reads;
    await expect(useCase.execute('inconnu.snackmanager.app')).rejects.toThrow();
    expect(repository.reads).toBe(afterFirst);

    // Passé le TTL négatif, une activation récente doit pouvoir être vue.
    clock.advanceSeconds(15);
    repository.registerTenant('65f000000000000000000009', 'inconnu');
    const resolved = await useCase.execute('inconnu.snackmanager.app');
    expect(resolved.slug).toBe('inconnu');
  });

  it('le cache est vidé pour cette adresse dès qu’elle change', async () => {
    repository.seed(CLASSFOOD, { hostname: 'commander.classfood.fr', status: 'active' });
    await useCase.execute('commander.classfood.fr');

    await repository.remove(CLASSFOOD, (await repository.list(CLASSFOOD))[0]!.id);
    cache.forget('commander.classfood.fr');

    await expect(useCase.execute('commander.classfood.fr')).rejects.toThrow(
      /Aucun établissement/,
    );
  });
});
