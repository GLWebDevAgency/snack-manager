import { describe, expect, it } from 'vitest';
import { TOUCH_MIN } from '@sm/client-core';
import {
  COMPACT_W,
  RAIL_REF,
  REFERENCE,
  SCALE_MAX,
  SCALE_MIN,
  TICKET_MAX,
  TICKET_MIN,
  TICKET_REF,
  TOPBAR_REF,
  cardWidth,
  columnsFor,
  computeLayout,
} from './layout';

/** Largeur de grille telle que la mesure `onLayout` la rendra. */
function gridWidth(w: number, h: number): number {
  const L = computeLayout(w, h);
  return L.width - L.railW - (L.compact ? 0 : L.ticketW) - L.gridPad * 2;
}

describe('Référence 1280 × 800 — la maquette ne bouge pas', () => {
  const L = computeLayout(REFERENCE.width, REFERENCE.height);

  it('redonne exactement le rail 108 et le ticket 384 de la spécification', () => {
    expect(L.railW).toBe(RAIL_REF);
    expect(L.ticketW).toBe(TICKET_REF);
  });

  it("garde l'échelle typographique neutre", () => {
    expect(L.scale).toBe(1);
    expect(L.fs(15)).toBe(15);
    expect(L.topbarH).toBe(TOPBAR_REF);
    // 13 px : la taille d'origine des libellés du rail.
    expect(L.railFs).toBe(13);
  });

  it('tient 4 colonnes, comme la grille d’origine', () => {
    expect(columnsFor(gridWidth(1280, 800), L)).toBe(4);
    expect(L.cols).toBe(4);
  });
});

describe('Colonnes adaptatives — jamais de cartes étirées', () => {
  const cases: [string, number, number, number][] = [
    // écran, largeur, hauteur, colonnes attendues
    ['10" paysage (référence)', 1280, 800, 4],
    ['10" portrait', 820, 1180, 3],
    ['ancienne 4:3 paysage', 1024, 768, 3],
    ['12–13" paysage', 1600, 900, 5],
    ['24" comptoir', 1920, 1080, 6],
    ['12" haute définition', 2000, 1200, 6],
    ['téléphone du gérant', 390, 844, 2],
  ];

  for (const [label, w, h, expected] of cases) {
    it(`${label} (${w}×${h}) → ${expected} colonnes`, () => {
      const L = computeLayout(w, h);
      const cols = columnsFor(gridWidth(w, h), L);
      expect(cols).toBe(expected);
      // Une carte reste dans une fourchette lisible : ni timbre-poste, ni
      // bandeau vide de 400 px.
      const card = cardWidth(gridWidth(w, h), cols, L.gridGap);
      expect(card).toBeGreaterThanOrEqual(110);
      expect(card).toBeLessThanOrEqual(300);
    });
  }

  it('ne descend jamais sous 2 colonnes ni au-dessus de 6', () => {
    for (let w = 320; w <= 2560; w += 20) {
      const L = computeLayout(w, 900);
      const cols = columnsFor(gridWidth(w, 900), L);
      expect(cols).toBeGreaterThanOrEqual(2);
      expect(cols).toBeLessThanOrEqual(6);
    }
  });
});

describe('Mode compact — le ticket devient escamotable sous 900 px', () => {
  it('bascule exactement au seuil documenté', () => {
    expect(computeLayout(COMPACT_W - 1, 1180).compact).toBe(true);
    expect(computeLayout(COMPACT_W, 1180).compact).toBe(false);
  });

  it('borne la largeur du tiroir à l’écran, sans le coller aux bords', () => {
    const phone = computeLayout(390, 844);
    expect(phone.ticketW).toBeLessThan(390);
    expect(phone.ticketW).toBeGreaterThanOrEqual(300);
    expect(computeLayout(820, 1180).ticketW).toBeLessThanOrEqual(TICKET_MAX);
  });
});

describe('Ticket ancré — largeur fluide bornée 340…460', () => {
  for (const [w, h] of [
    [1024, 768],
    [1280, 800],
    [1440, 900],
    [1920, 1080],
    [2560, 1440],
  ] as const) {
    it(`${w}×${h} reste dans les bornes`, () => {
      const L = computeLayout(w, h);
      expect(L.ticketW).toBeGreaterThanOrEqual(TICKET_MIN);
      expect(L.ticketW).toBeLessThanOrEqual(TICKET_MAX);
    });
  }
});

describe('Échelle typographique', () => {
  it('grossit sur un grand écran, sans jamais dépasser la borne', () => {
    expect(computeLayout(1920, 1080).scale).toBeGreaterThan(1);
    expect(computeLayout(2560, 1440).scale).toBeLessThanOrEqual(SCALE_MAX);
  });

  it('reste bornée en réduction et ne produit pas de texte sous 12 px', () => {
    for (const [w, h] of [
      [320, 568],
      [390, 844],
      [768, 1024],
      [820, 1180],
    ] as const) {
      const L = computeLayout(w, h);
      expect(L.scale).toBeGreaterThanOrEqual(SCALE_MIN);
      expect(L.fs(13)).toBeGreaterThanOrEqual(12);
      expect(L.fs(15)).toBeGreaterThanOrEqual(12);
    }
  });

  it("n'agrandit pas le texte sur un écran large mais court", () => {
    // 1920 × 600 : la diagonale dit « grand », la hauteur dit « attention ».
    expect(computeLayout(1920, 600).scale).toBeLessThanOrEqual(1);
  });
});

describe('Cibles tactiles — plancher absolu', () => {
  it(`ne descend jamais sous ${TOUCH_MIN} px, quelle que soit la taille d'écran`, () => {
    for (let w = 320; w <= 2560; w += 40) {
      for (const h of [568, 800, 1080, 1400]) {
        const L = computeLayout(w, h);
        expect(L.touch()).toBeGreaterThanOrEqual(TOUCH_MIN);
        expect(L.touch(TOUCH_MIN)).toBeGreaterThanOrEqual(TOUCH_MIN);
        expect(L.touch(52)).toBeGreaterThanOrEqual(TOUCH_MIN);
      }
    }
  });
});

describe('Orientation et bornes générales', () => {
  it('reconnaît le portrait', () => {
    expect(computeLayout(820, 1180).orientation).toBe('portrait');
    expect(computeLayout(1280, 800).orientation).toBe('landscape');
  });

  it('ne produit jamais de rail ou de modale plus large que l’écran', () => {
    for (let w = 320; w <= 2560; w += 20) {
      const L = computeLayout(w, 900);
      expect(L.railW).toBeLessThan(w);
      // Un libellé de catégorie reste lisible : jamais sous 11,5 px, et il
      // dispose toujours d'au moins ~5 px de large par point de police.
      expect(L.railFs).toBeGreaterThanOrEqual(11.5);
      expect(L.railW - 28).toBeGreaterThan(L.railFs * 4);
      expect(L.modal(560)).toBeLessThanOrEqual(w);
      expect(L.ticketW).toBeLessThanOrEqual(w);
      // Rail + ticket ancré laissent toujours de la place à la grille.
      if (!L.compact) expect(w - L.railW - L.ticketW).toBeGreaterThan(320);
    }
  });
});
