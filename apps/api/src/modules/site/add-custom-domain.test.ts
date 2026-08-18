import { beforeEach, describe, expect, it } from 'vitest';
import { AddCustomDomain } from './add-custom-domain.usecase';
import { HostResolutionCache } from './host-resolution.cache';
import { FakeRegistrar, FakeRepository, TestClock, testSiteConfig } from './site.fakes';

const CLASSFOOD = '65f000000000000000000001';
const VOISIN = '65f000000000000000000002';

describe('Rattacher un nom de domaine', () => {
  let registrar: FakeRegistrar;
  let repository: FakeRepository;
  let clock: TestClock;
  let useCase: AddCustomDomain;

  beforeEach(() => {
    registrar = new FakeRegistrar();
    repository = new FakeRepository();
    repository.registerTenant(CLASSFOOD, 'classfood');
    repository.registerTenant(VOISIN, 'tacos-du-coin');
    clock = new TestClock();
    useCase = new AddCustomDomain(
      registrar,
      clock,
      repository.asRepository(),
      new HostResolutionCache(clock),
      testSiteConfig(),
    );
  });

  it('un domaine racine est refusé avec le sous-domaine à utiliser', async () => {
    // Contrainte DNS réelle : un apex ne porte pas de CNAME, et le pointer chez
    // nous couperait la messagerie du restaurant.
    await expect(useCase.execute(CLASSFOOD, 'classfood.fr')).rejects.toThrow(
      /commander\.classfood\.fr/,
    );
    expect(registrar.registered).toEqual([]);
  });

  it("une adresse Snack Manager n'est pas un domaine personnalisé", async () => {
    // Elle est déjà servie : proposer d'y poser un CNAME n'aurait aucun sens.
    await expect(
      useCase.execute(CLASSFOOD, 'classfood.snackmanager.app'),
    ).rejects.toThrow(/fonctionne déjà/);
    expect(registrar.registered).toEqual([]);
  });

  it('un nom déjà pris par un autre établissement est refusé', async () => {
    repository.seed(VOISIN, { hostname: 'commander.classfood.fr' });
    await expect(
      useCase.execute(CLASSFOOD, 'commander.classfood.fr'),
    ).rejects.toThrow(/autre établissement/);
    expect(registrar.registered).toEqual([]);
  });

  it('le même établissement ne rattache pas deux fois le même nom', async () => {
    repository.seed(CLASSFOOD, { hostname: 'commander.classfood.fr' });
    await expect(
      useCase.execute(CLASSFOOD, 'commander.classfood.fr'),
    ).rejects.toThrow(/déjà rattaché à votre établissement/);
  });

  it("l'ajout renvoie l'enregistrement DNS exact à recopier", async () => {
    const { domain } = await useCase.execute(CLASSFOOD, 'commander.classfood.fr');

    expect(registrar.registered).toEqual(['commander.classfood.fr']);
    expect(domain.status).toBe('pending_dns');
    expect(domain.statusLabel).toBe('En attente DNS');
    expect(domain.dns).toMatchObject({
      type: 'CNAME',
      name: 'commander',
      fullName: 'commander.classfood.fr',
      value: 'sm-prod.up.railway.app',
    });
  });

  it('une saisie recopiée depuis la barre d’adresse est nettoyée', async () => {
    // Le gérant colle « https://Commander.ClassFood.FR/ » : c'est le même nom.
    const { domain } = await useCase.execute(
      CLASSFOOD,
      '  https://Commander.ClassFood.FR/menu  ',
    );
    expect(domain.hostname).toBe('commander.classfood.fr');
  });

  it('le premier domaine devient le domaine principal, pas le second', async () => {
    const first = await useCase.execute(CLASSFOOD, 'commander.classfood.fr');
    const second = await useCase.execute(CLASSFOOD, 'carte.classfood.fr');
    expect(first.domain.isPrimary).toBe(true);
    expect(second.domain.isPrimary).toBe(false);
  });

  it("la date d'ajout vient de l'horloge injectée, jamais de Date.now()", async () => {
    const { domain } = await useCase.execute(CLASSFOOD, 'commander.classfood.fr');
    expect(domain.addedAt).toBe(clock.now().toISOString());
  });
});
