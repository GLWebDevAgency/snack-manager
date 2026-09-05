import { beforeEach, describe, expect, it } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PreviewScreenContent } from './preview-screen-content.usecase';
import { renderScreenContent } from './render-screen-content';
import {
  FakeMenuBoardRepository,
  FakeScreensRepository,
  TestClock,
  boardProduct,
  boardSnapshot,
  scene,
  storedScreen,
} from './screens.fakes';

const CLASSFOOD = '65f000000000000000000001';
const VOISIN = '65f000000000000000000002';
const MERCREDI_MIDI = new Date('2026-08-19T10:30:00Z');

describe('Aperçu d’un écran — le téléviseur miniature du back-office', () => {
  let screens: FakeScreensRepository;
  let useCase: PreviewScreenContent;

  beforeEach(() => {
    screens = new FakeScreensRepository();
    const board = new FakeMenuBoardRepository();
    useCase = new PreviewScreenContent(
      new TestClock(MERCREDI_MIDI),
      screens.asRepository(),
      board.asRepository(),
    );
  });

  it('un brouillon sans écran part des défauts et de la boucle générée depuis la carte', async () => {
    const content = await useCase.execute(CLASSFOOD, {});
    expect(content.screenId).toBe('preview');
    expect(content.scenography).toBe('comptoir');
    expect(content.orientation).toBe('landscape');
    expect(content.scenes.length).toBeGreaterThan(0);
    expect(content.scenes[0]?.kind).toBe('category');
  });

  it('les surcharges du brouillon s’appliquent par-dessus l’écran désigné', async () => {
    screens.seed(
      storedScreen({ id: 'screen-1', tenantId: CLASSFOOD, theme: 'brand', scenography: 'ardoise' }),
    );
    const content = await useCase.execute(CLASSFOOD, {
      screenId: 'screen-1',
      theme: 'light',
      scenography: 'comptoir',
      orientation: 'portrait',
    });
    expect(content.screenId).toBe('screen-1');
    expect(content.theme).toBe('light');
    expect(content.masque.mode).toBe('light');
    expect(content.scenography).toBe('comptoir');
    expect(content.orientation).toBe('portrait');
  });

  it('une boucle fournie remplace celle de l’écran', async () => {
    screens.seed(storedScreen({ id: 'screen-1', tenantId: CLASSFOOD }));
    const content = await useCase.execute(CLASSFOOD, {
      screenId: 'screen-1',
      playlist: [scene({ kind: 'custom', title: 'Bienvenue' })],
    });
    expect(content.scenes.map((s) => s.title)).toEqual(['Bienvenue']);
  });

  it('un écran inconnu, ou celui d’un voisin, vaut 404', async () => {
    screens.seed(storedScreen({ id: 'screen-9', tenantId: VOISIN }));
    await expect(useCase.execute(CLASSFOOD, { screenId: 'nulle-part' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(useCase.execute(CLASSFOOD, { screenId: 'screen-9' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('une boucle illisible est refusée comme à l’enregistrement, pas encaissée en 500', async () => {
    await expect(
      useCase.execute(CLASSFOOD, {
        playlist: [scene({ kind: 'category', categoryId: 'pas-un-identifiant' })],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('Préparer le menu hors service sans modifier le téléviseur', () => {
  const FERME = new Date('2026-08-19T13:30:00Z'); // mercredi 15:30 à Paris
  const snapshot = boardSnapshot({
    products: [
      boardProduct({ id: 'toute-la-journee', tags: [] }),
      boardProduct({ id: 'produit-midi', tags: ['midi'] }),
      boardProduct({ id: 'produit-soir', tags: ['soir'] }),
    ],
  });
  const screen = storedScreen({ id: 'screen-1', tenantId: CLASSFOOD });

  function setup() {
    const screens = new FakeScreensRepository();
    screens.seed(screen);
    return {
      screens,
      preview: new PreviewScreenContent(
        new TestClock(FERME),
        screens.asRepository(),
        new FakeMenuBoardRepository(snapshot).asRepository(),
      ),
    };
  }

  it('« Maintenant » garde la scène de fermeture prévue', async () => {
    const content = await setup().preview.execute(CLASSFOOD, { screenId: screen.id });
    expect(content.open).toBe(false);
    expect(content.service).toBe('closed');
    expect(content.scenes.map((scene) => scene.kind)).toEqual(['closed']);
  });

  it.each([
    ['lunch', 'produit-midi'],
    ['dinner', 'produit-soir'],
  ] as const)('simule %s avec ses produits sans écrire les réglages ni le battement', async (service, product) => {
    const { screens, preview } = setup();
    const before = JSON.stringify(await screens.byId(CLASSFOOD, screen.id));
    const content = await preview.execute(CLASSFOOD, { screenId: screen.id, service });
    expect(content.open).toBe(true);
    expect(content.service).toBe(service);
    expect(content.scenes.flatMap((scene) => scene.products.map((item) => item.id)))
      .toEqual(['toute-la-journee', product]);
    expect(JSON.stringify(await screens.byId(CLASSFOOD, screen.id))).toBe(before);
    // Le même écran et la même horloge restent fermés sur le chemin réel.
    const live = renderScreenContent(screen, snapshot, FERME);
    expect(live.service).toBe('closed');
    expect(live.scenes[0]?.kind).toBe('closed');
  });

  it('un écran réellement désactivé reste en veille, même si un appelant passe un service', () => {
    const content = renderScreenContent({ ...screen, active: false }, snapshot, FERME, 'lunch');
    expect(content.open).toBe(false);
    expect(content.scenes[0]?.id).toBe('standby');
  });
});
