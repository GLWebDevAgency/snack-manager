import { describe, expect, it } from 'vitest';
import { SCENE_MAX_LINES } from '@sm/contracts';
import { BuildScreenContent } from './build-screen-content.usecase';
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

/**
 * Heures MURALES du restaurant (Europe/Paris, été = UTC+2). Class'Food sert
 * midi 11:30–14:30 et soir 18:00–22:30, sauf lundi et vendredi : soir seulement.
 */
const MERCREDI_MIDI = new Date('2026-08-19T10:30:00Z'); // mercredi 12:30
const MERCREDI_COUPURE = new Date('2026-08-19T13:30:00Z'); // mercredi 15:30
const MERCREDI_SOIR = new Date('2026-08-19T17:30:00Z'); // mercredi 19:30
const LUNDI_MIDI = new Date('2026-08-17T10:30:00Z'); // lundi 12:30 — pas de service

describe('Dayparting — le contenu suit l’heure réelle', () => {
  it('à 12:30 un mercredi, on est au service du midi', () => {
    const content = renderScreenContent(storedScreen(), boardSnapshot(), MERCREDI_MIDI);
    expect(content.service).toBe('lunch');
    expect(content.serviceLabel).toBe('Service du midi');
    expect(content.open).toBe(true);
  });

  it('à 19:30, on est au service du soir', () => {
    const content = renderScreenContent(storedScreen(), boardSnapshot(), MERCREDI_SOIR);
    expect(content.service).toBe('dinner');
    expect(content.open).toBe(true);
  });

  it('à 15:30, la coupure ferme l’écran et annonce le service du soir', () => {
    // Une plage unique « 11:30 – 22:30 » vendrait la coupure comme ouverte :
    // le passant pousserait une porte fermée.
    const content = renderScreenContent(storedScreen(), boardSnapshot(), MERCREDI_COUPURE);

    expect(content.service).toBe('closed');
    expect(content.open).toBe(false);
    expect(content.scenes).toHaveLength(1);

    const closed = content.scenes[0]!;
    expect(closed.kind).toBe('closed');
    expect(closed.title).toBe('Fermé');
    expect(closed.nextOpening?.dayLabel).toBe("Aujourd'hui");
    expect(closed.nextOpening?.windows).toEqual(['18:00 – 22:30']);
  });

  it('le lundi midi, Class’Food ne sert pas : l’écran annonce le soir même', () => {
    const content = renderScreenContent(storedScreen(), boardSnapshot(), LUNDI_MIDI);
    expect(content.service).toBe('closed');
    expect(content.scenes[0]?.nextOpening).toMatchObject({
      dayLabel: "Aujourd'hui",
      date: '2026-08-17',
      windows: ['18:00 – 22:30'],
    });
  });

  it('après le dernier service, l’écran affiche les horaires du lendemain', () => {
    const content = renderScreenContent(
      storedScreen(),
      boardSnapshot(),
      new Date('2026-08-19T21:00:00Z'), // mercredi 23:00, tout est fermé
    );
    expect(content.scenes[0]?.nextOpening).toMatchObject({
      dayLabel: 'Demain',
      date: '2026-08-20',
      windows: ['11:30 – 14:30', '18:00 – 22:30'],
    });
  });

  it('un produit étiqueté « soir » disparaît de la carte du midi', () => {
    const snapshot = boardSnapshot({
      products: [
        boardProduct({ id: 'p1', name: 'Tacos' }),
        boardProduct({ id: 'p2', name: 'Formule du soir', tags: ['soir'] }),
      ],
    });

    const midi = renderScreenContent(storedScreen(), snapshot, MERCREDI_MIDI);
    const soir = renderScreenContent(storedScreen(), snapshot, MERCREDI_SOIR);

    expect(midi.scenes[0]?.products.map((p) => p.name)).toEqual(['Tacos']);
    expect(soir.scenes[0]?.products.map((p) => p.name)).toEqual(['Tacos', 'Formule du soir']);
  });
});

describe('Contenu résolu', () => {
  it('marque la rupture au lieu de retirer le produit', () => {
    // Retirer la ligne laisserait croire que le produit n'existe pas, et le
    // client le redemanderait au comptoir.
    const snapshot = boardSnapshot({
      products: [
        boardProduct({ id: 'p1', name: 'Tacos' }),
        boardProduct({ id: 'p2', name: 'Bicky', outOfStock: true }),
      ],
    });
    const content = renderScreenContent(storedScreen(), snapshot, MERCREDI_MIDI);

    expect(content.scenes[0]?.products.map((p) => [p.name, p.outOfStock])).toEqual([
      ['Tacos', false],
      ['Bicky', true],
    ]);
  });

  it('omet une catégorie vide plutôt que d’afficher dix secondes de blanc', () => {
    const content = renderScreenContent(
      storedScreen({
        playlist: [
          scene({ kind: 'category', categoryId: 'cat-tacos', title: 'Tacos' }),
          scene({ kind: 'category', categoryId: 'cat-desserts', title: 'Desserts' }),
        ],
      }),
      boardSnapshot(), // aucun produit rattaché aux desserts
      MERCREDI_MIDI,
    );

    expect(content.scenes.map((s) => s.title)).toEqual(['Tacos']);
  });

  it('omet la scène des offres tant qu’aucune promotion n’est active', () => {
    const playlist = [
      scene({ kind: 'promo', title: 'Offres du moment' }),
      scene({ kind: 'category', categoryId: 'cat-tacos', title: 'Tacos' }),
    ];

    const sans = renderScreenContent(
      storedScreen({ playlist }),
      boardSnapshot(),
      MERCREDI_MIDI,
    );
    expect(sans.scenes.map((s) => s.kind)).toEqual(['category']);

    const avec = renderScreenContent(
      storedScreen({ playlist }),
      boardSnapshot({
        promos: [
          { id: 'promo-1', name: 'Menu étudiant', description: 'Sur présentation', kind: 'percent', value: 20 },
        ],
      }),
      MERCREDI_MIDI,
    );
    expect(avec.scenes[0]?.kind).toBe('promo');
    expect(avec.scenes[0]?.promos[0]?.label).toBe('−20 %');
  });

  it('annonce une fourchette de prix pour un produit à variantes', () => {
    const content = renderScreenContent(
      storedScreen(),
      boardSnapshot({
        products: [boardProduct({ id: 'p1', name: 'Tacos', variantPrices: [850, 1050, 1200] })],
      }),
      MERCREDI_MIDI,
    );
    expect(content.scenes[0]?.products[0]?.priceLabel).toBe('8,50 – 12,00 €');
    expect(content.scenes[0]?.products[0]?.priceCents).toBe(850);
  });

  it('découpe une catégorie trop longue en pages équilibrées', () => {
    // À trois mètres, au-delà de huit lignes plus rien n'est lisible.
    const products = Array.from({ length: 17 }, (_, i) =>
      boardProduct({ id: `p${i}`, name: `Produit ${i}` }),
    );
    const content = renderScreenContent(
      storedScreen(),
      boardSnapshot({ products }),
      MERCREDI_MIDI,
    );

    expect(content.scenes).toHaveLength(3);
    expect(content.scenes.map((s) => s.products.length)).toEqual([6, 6, 5]);
    expect(content.scenes.every((s) => s.products.length <= SCENE_MAX_LINES)).toBe(true);
    expect(content.scenes.map((s) => s.subtitle)).toEqual(['1 / 3', '2 / 3', '3 / 3']);
  });

  it('ne laisse jamais l’écran noir : carte vide ⇒ plaque de marque', () => {
    const content = renderScreenContent(
      storedScreen(),
      boardSnapshot({ categories: [], products: [] }),
      MERCREDI_MIDI,
    );
    expect(content.scenes).toHaveLength(1);
    expect(content.scenes[0]?.title).toBe("Class'Food");
  });

  it('un écran désactivé repasse en veille sans cesser de répondre', () => {
    const content = renderScreenContent(
      storedScreen({ active: false }),
      boardSnapshot(),
      MERCREDI_MIDI,
    );
    expect(content.scenes.map((s) => s.id)).toEqual(['standby']);
  });

  it('planifie le rechargement de nuit aux heures creuses', () => {
    const content = renderScreenContent(storedScreen(), boardSnapshot(), MERCREDI_SOIR);
    const reload = new Date(content.dailyReloadAt);
    const parts = new Intl.DateTimeFormat('fr-CA', {
      timeZone: 'Europe/Paris',
      hour: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(reload);
    const parisHour = Number(parts.find((p) => p.type === 'hour')?.value);
    expect(parisHour).toBe(4);
    expect(reload.getTime()).toBeGreaterThan(MERCREDI_SOIR.getTime());
  });
});

describe('Empreinte de contenu', () => {
  it('ne bouge pas quand rien ne bouge', () => {
    // L'écran interroge l'API toutes les minutes, douze heures par jour : une
    // empreinte instable le ferait se repeindre en permanence.
    const a = renderScreenContent(storedScreen(), boardSnapshot(), MERCREDI_MIDI);
    const b = renderScreenContent(storedScreen(), boardSnapshot(), MERCREDI_MIDI);
    expect(a.contentHash).toBe(b.contentHash);
  });

  it('ignore l’horodatage : deux instants du même service donnent la même empreinte', () => {
    const a = renderScreenContent(storedScreen(), boardSnapshot(), MERCREDI_MIDI);
    const b = renderScreenContent(
      storedScreen(),
      boardSnapshot(),
      new Date(MERCREDI_MIDI.getTime() + 47_000),
    );
    expect(a.generatedAt).not.toBe(b.generatedAt);
    expect(a.contentHash).toBe(b.contentHash);
  });

  it('change dès qu’un prix change', () => {
    const avant = renderScreenContent(storedScreen(), boardSnapshot(), MERCREDI_MIDI);
    const apres = renderScreenContent(
      storedScreen(),
      boardSnapshot({
        products: [
          boardProduct({ id: 'p1', name: 'Tacos M', priceCents: 900 }),
          boardProduct({ id: 'p2', name: 'Tacos L', priceCents: 1050 }),
        ],
      }),
      MERCREDI_MIDI,
    );
    expect(apres.contentHash).not.toBe(avant.contentHash);
  });

  it('change dès qu’une rupture est cochée', () => {
    const avant = renderScreenContent(storedScreen(), boardSnapshot(), MERCREDI_MIDI);
    const apres = renderScreenContent(
      storedScreen(),
      boardSnapshot({
        products: [
          boardProduct({ id: 'p1', name: 'Tacos M', outOfStock: true }),
          boardProduct({ id: 'p2', name: 'Tacos L', priceCents: 1050 }),
        ],
      }),
      MERCREDI_MIDI,
    );
    expect(apres.contentHash).not.toBe(avant.contentHash);
  });

  it('change au passage du midi au soir', () => {
    const midi = renderScreenContent(storedScreen(), boardSnapshot(), MERCREDI_MIDI);
    const soir = renderScreenContent(storedScreen(), boardSnapshot(), MERCREDI_SOIR);
    expect(soir.contentHash).not.toBe(midi.contentHash);
  });
});

describe('Accès par jeton d’appareil', () => {
  const TOKEN = 'jeton-de-test';

  function build() {
    const clock = new TestClock(MERCREDI_MIDI);
    const screens = new FakeScreensRepository();
    screens.seed(storedScreen(), TOKEN);
    const board = new FakeMenuBoardRepository();
    return {
      clock,
      screens,
      useCase: new BuildScreenContent(clock, screens.asRepository(), board.asRepository()),
    };
  }

  it('un jeton valide obtient tout le contenu en un appel', async () => {
    const content = await build().useCase.execute(TOKEN);
    expect(content.brand.name).toBe("Class'Food");
    expect(content.brand.accent).toBe('#c9a15a');
    expect(content.scenes.length).toBeGreaterThan(0);
    expect(content.timezone).toBe('Europe/Paris');
  });

  it('un jeton inconnu n’obtient rien — l’écran n’a pas d’autre identité', async () => {
    await expect(build().useCase.execute('jeton-inventé')).rejects.toThrow(/non appairé/);
  });
});
