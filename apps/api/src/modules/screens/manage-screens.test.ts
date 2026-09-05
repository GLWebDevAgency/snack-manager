import { beforeEach, describe, expect, it } from 'vitest';
import { PAIRING_CODE_TTL_MS, isPairingCodeShape, ScreenPresentationSchema } from '@sm/contracts';
import { ManageScreens } from './manage-screens.usecase';
import {
  FakeMenuBoardRepository,
  FakeScreensRepository,
  TestClock,
  scene,
  storedScreen,
} from './screens.fakes';

const CLASSFOOD = '65f000000000000000000001';
const VOISIN = '65f000000000000000000002';
const NOW = '2026-08-19T10:30:00Z';

describe('Back-office des écrans', () => {
  let clock: TestClock;
  let screens: FakeScreensRepository;
  let board: FakeMenuBoardRepository;
  let useCase: ManageScreens;

  beforeEach(() => {
    clock = new TestClock(new Date(NOW));
    screens = new FakeScreensRepository();
    board = new FakeMenuBoardRepository();
    useCase = new ManageScreens(clock, screens.asRepository(), board.asRepository());
  });

  it('un écran créé est immédiatement utilisable : code affichable, carte déjà dedans', async () => {
    const view = await useCase.create(CLASSFOOD, {
      name: 'Écran comptoir gauche',
      orientation: 'portrait',
      theme: 'brand',
      scenography: 'comptoir',
    });

    expect(view.paired).toBe(false);
    expect(view.statusLabel).toBe("En attente d'appairage");
    expect(view.orientationLabel).toBe('Portrait');
    expect(isPairingCodeShape(view.pairing?.code ?? '')).toBe(true);
    expect(view.pairing?.expiresAt).toBe(
      new Date(Date.parse(NOW) + PAIRING_CODE_TTL_MS).toISOString(),
    );
    // Promo en tête, puis la seule catégorie qui contient des produits.
    expect(view.playlist.map((s) => s.kind)).toEqual(['promo', 'category']);
  });

  it('une playlist fournie explicitement remplace la génération automatique', async () => {
    const view = await useCase.create(CLASSFOOD, {
      name: 'Écran vitrine',
      orientation: 'landscape',
      theme: 'dark',
      scenography: 'comptoir',
      playlist: [scene({ kind: 'custom', title: 'Bienvenue' })],
    });

    expect(view.playlist).toHaveLength(1);
    expect(view.playlist[0]?.title).toBe('Bienvenue');
  });

  it('sauvegarde la présentation, la relit, et la conserve lors d’un autre correctif', async () => {
    const presentation = ScreenPresentationSchema.parse({ corners: 'round', motion: 'off' });
    const created = await useCase.create(CLASSFOOD, {
      name: 'Salle', orientation: 'landscape', theme: 'brand', scenography: 'halo', presentation,
    });
    expect(created.presentation).toEqual(presentation);
    await useCase.update(CLASSFOOD, created.id, { name: 'Salle centrale' });
    expect((await useCase.get(CLASSFOOD, created.id)).presentation).toEqual(presentation);
    const changed = ScreenPresentationSchema.parse({ priceScale: 'large' });
    await useCase.update(CLASSFOOD, created.id, { presentation: changed });
    expect((await useCase.get(CLASSFOOD, created.id)).presentation).toEqual(changed);
    await expect(useCase.update(VOISIN, created.id, { presentation })).rejects.toThrow('Écran introuvable');
  });

  it('un identifiant de scène illisible est refusé, pas encaissé en 500', async () => {
    await expect(
      useCase.create(CLASSFOOD, {
        name: 'Écran',
        orientation: 'landscape',
        theme: 'brand',
        scenography: 'comptoir',
        playlist: [scene({ kind: 'category', categoryId: 'cat-tacos' })],
      }),
    ).rejects.toThrow(/Identifiants de scène invalides/);
  });

  it('régénérer le code révoque le jeton de l’ancienne clé HDMI', async () => {
    // Le cas réel : la clé a été remplacée, ou volée. Un nouveau code sans
    // révocation laisserait l'ancien appareil afficher la carte indéfiniment.
    screens.seed(storedScreen({ tenantId: CLASSFOOD }), 'ancien-jeton');
    expect(await screens.findByDeviceToken('ancien-jeton')).not.toBeNull();

    const view = await useCase.regenerateCode(CLASSFOOD, 'screen-1');

    expect(view.paired).toBe(false);
    expect(isPairingCodeShape(view.pairing?.code ?? '')).toBe(true);
    expect(await screens.findByDeviceToken('ancien-jeton')).toBeNull();
  });

  it('un écran muet est daté en clair pour le gérant', async () => {
    screens.seed(
      storedScreen({
        tenantId: CLASSFOOD,
        lastSeenAt: new Date(Date.parse(NOW) - 20 * 60_000),
      }),
      'jeton',
    );

    const [view] = await useCase.list(CLASSFOOD);
    expect(view?.online).toBe(false);
    expect(view?.statusLabel).toBe('Hors ligne depuis 20 min');
  });

  it('un écran qui vient de battre est en ligne', async () => {
    screens.seed(
      storedScreen({ tenantId: CLASSFOOD, lastSeenAt: new Date(Date.parse(NOW) - 30_000) }),
      'jeton',
    );
    const [view] = await useCase.list(CLASSFOOD);
    expect(view?.online).toBe(true);
    expect(view?.statusLabel).toBe('En ligne');
  });

  it('le tenantId du token isole les écrans d’un établissement à l’autre', async () => {
    screens.seed(storedScreen({ tenantId: CLASSFOOD }));

    expect(await useCase.list(VOISIN)).toEqual([]);
    await expect(useCase.get(VOISIN, 'screen-1')).rejects.toThrow(/introuvable/);
    await expect(useCase.update(VOISIN, 'screen-1', { name: 'Piraté' })).rejects.toThrow(
      /introuvable/,
    );
    await expect(useCase.regenerateCode(VOISIN, 'screen-1')).rejects.toThrow(/introuvable/);
    await expect(useCase.remove(VOISIN, 'screen-1')).rejects.toThrow(/introuvable/);
  });

  it('renommer un écran ne touche pas à sa playlist', async () => {
    screens.seed(storedScreen({ tenantId: CLASSFOOD }));
    const view = await useCase.update(CLASSFOOD, 'screen-1', { name: 'Écran salle' });
    expect(view.name).toBe('Écran salle');
    expect(view.sceneCount).toBe(1);
  });
  it('la scénographie choisie est stockée et relue avec son libellé', async () => {
    const created = await useCase.create(CLASSFOOD, {
      name: 'Vitrine',
      orientation: 'landscape',
      theme: 'brand',
      scenography: 'comptoir',
    });
    expect(created.scenography).toBe('comptoir');
    expect(created.scenographyLabel).toBe('Comptoir');

    const updated = await useCase.update(CLASSFOOD, created.id, { scenography: 'ardoise' });
    expect(updated.scenography).toBe('ardoise');
    expect(updated.scenographyLabel).toBe('Ardoise');
  });
});
