import { beforeEach, describe, expect, it } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PreviewScreenContent } from './preview-screen-content.usecase';
import {
  FakeMenuBoardRepository,
  FakeScreensRepository,
  TestClock,
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
