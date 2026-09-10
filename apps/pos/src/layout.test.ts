import { describe, expect, it } from 'vitest';
import { TOUCH_MIN } from '@sm/client-core';
import {
  COMPACT_W,
  RAIL_REF,
  REFERENCE,
  SCALE_MAX,
  SCALE_MIN,
  SERVICE_COLS_MAX,
  TICKET_MAX,
  TICKET_MIN,
  LARGEUR_NOM_MIN,
  TICKET_REF,
  TOPBAR_REF,
  TOPBAR_SELECTORS_SPLIT_W,
  TOPBAR_SPLIT_W,
  VIGNETTE_MAX,
  VIGNETTE_MIN,
  cadrageVignette,
  cardWidth,
  columnsFor,
  computeLayout,
  serviceColumns,
  vignetteTient,
} from './layout';

/** Largeur de grille telle que la mesure `onLayout` la rendra. */
function gridWidth(w: number, h: number): number {
  const L = computeLayout(w, h);
  return L.width - L.railW - (L.compact ? 0 : L.ticketW) - L.gridPad * 2;
}

/** Largeur d'une tuile telle que la grille la calculera après mesure. */
function cardOf(w: number, h: number): number {
  const L = computeLayout(w, h);
  const grid = gridWidth(w, h);
  return cardWidth(grid, columnsFor(grid, L), L.gridGap);
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

describe('Barre haute — deux sélecteurs, trois compositions', () => {
  it('garde tout sur une rangée sur la tablette de RÉFÉRENCE', () => {
    // C'est la contrainte qui a fixé le seuil à 1180 et non à 1280 : la
    // 10" du comptoir ne devait pas gagner une rangée en même temps que
    // la caisse gagnait une vue.
    const L = computeLayout(REFERENCE.width, REFERENCE.height);
    expect(L.topbarStacked).toBe(false);
    expect(L.topbarSelectorsSplit).toBe(false);
  });

  it('bascule exactement aux deux seuils documentés', () => {
    expect(computeLayout(TOPBAR_SPLIT_W, 800).topbarStacked).toBe(false);
    expect(computeLayout(TOPBAR_SPLIT_W - 1, 800).topbarStacked).toBe(true);
    expect(computeLayout(TOPBAR_SELECTORS_SPLIT_W, 900).topbarSelectorsSplit).toBe(false);
    expect(computeLayout(TOPBAR_SELECTORS_SPLIT_W - 1, 900).topbarSelectorsSplit).toBe(true);
  });

  it('laisse ≈ 100 px par onglet au pire cas de la rangée partagée', () => {
    // Cinq onglets (2 pour la vue, 3 pour le mode) se partagent la seconde
    // rangée entre 560 et 1180 px. À la borne basse, « À emporter » doit
    // encore tenir sans se couper en plein mot.
    const L = computeLayout(TOPBAR_SELECTORS_SPLIT_W, 900);
    const utile = L.width - 16 * 2 - 8; // marges de la barre + gouttière
    expect(utile / 5).toBeGreaterThanOrEqual(96);
  });

  it('ne partage jamais une rangée quand elle n’existe pas', () => {
    // Au-dessus du seuil de repli, la question du partage ne se pose pas :
    // les deux sélecteurs sont sur la rangée d'identité.
    for (let w = TOPBAR_SPLIT_W; w <= 2560; w += 40) {
      const L = computeLayout(w, 900);
      expect(L.topbarStacked).toBe(false);
      expect(L.topbarSelectorsSplit).toBe(false);
    }
  });
});

describe('Vue du service — cartes larges, jamais étirées', () => {
  const cases: [string, number, number, number][] = [
    // écran, largeur, hauteur, colonnes attendues
    ['10" paysage (référence)', 1280, 800, 3],
    ['10" portrait', 820, 1180, 2],
    ['24" comptoir', 1920, 1080, 4],
    ['téléphone du gérant', 390, 844, 1],
  ];

  for (const [label, w, h, expected] of cases) {
    it(`${label} (${w}×${h}) → ${expected} colonne(s)`, () => {
      const L = computeLayout(w, h);
      expect(serviceColumns(w - L.gridPad * 2, L)).toBe(expected);
    });
  }

  it('garde une carte assez large pour un numéro lisible à un mètre', () => {
    for (let w = 320; w <= 2560; w += 20) {
      const L = computeLayout(w, 900);
      const dispo = w - L.gridPad * 2;
      const cols = serviceColumns(dispo, L);
      expect(cols).toBeGreaterThanOrEqual(1);
      expect(cols).toBeLessThanOrEqual(SERVICE_COLS_MAX);
      const carte = (dispo - L.gridGap * (cols - 1)) / cols;
      // Plancher mesuré du parc : 251 px, atteint à 544 px de large, juste
      // après le passage à deux colonnes. C'est encore assez pour porter le
      // numéro (30 px) et le minuteur (20 px) sur la même rangée. Le plafond
      // empêche un très grand écran de rendre quatre cartes presque vides.
      expect(carte).toBeGreaterThanOrEqual(250);
      expect(carte).toBeLessThanOrEqual(640);
    }
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

describe('Vignette produit — carrée, et jamais au détriment du prix', () => {
  it('reste dans ses bornes sur tout le parc', () => {
    for (let w = 320; w <= 2560; w += 20) {
      for (const h of [600, 800, 1080, 1200]) {
        const L = computeLayout(w, h);
        expect(L.vignette).toBeGreaterThanOrEqual(VIGNETTE_MIN);
        expect(L.vignette).toBeLessThanOrEqual(VIGNETTE_MAX);
        // LA contrainte : la vignette ouvre la rangée du nom, la rangée du
        // prix vient dessous, et la tuile est écrêtée. Le prix est le seul
        // chiffre dont l'équipier a besoin — il ne doit jamais sortir.
        const interieur = L.cardH - L.sp(13) * 2;
        const prix = L.fs(19) * 1.3 + 10;
        expect(L.vignette + prix).toBeLessThanOrEqual(interieur);
      }
    }
  });

  it('laisse au nom la place de deux lignes à côté d’elle', () => {
    const L = computeLayout(REFERENCE.width, REFERENCE.height);
    expect(L.vignette).toBe(43);
    // Deux lignes de nom (2 × 18) tiennent dans la hauteur de la vignette :
    // la rangée ne grandit donc pas à cause du texte.
    expect(L.fs(18) * 2).toBeLessThanOrEqual(L.vignette);
  });

  it('tient sur les tablettes et s’efface sur le téléphone du gérant', () => {
    // Tablette de référence : 180 px de tuile, 105 px restent au nom.
    const tablette = computeLayout(REFERENCE.width, REFERENCE.height);
    expect(vignetteTient(cardOf(1280, 800), tablette)).toBe(true);
    expect(vignetteTient(cardOf(1920, 1080), computeLayout(1920, 1080))).toBe(true);
    expect(vignetteTient(cardOf(820, 1180), computeLayout(820, 1180))).toBe(true);
    // Téléphone : 136 px de tuile, il ne resterait que 47 px au nom.
    expect(vignetteTient(cardOf(390, 844), computeLayout(390, 844))).toBe(false);
  });

  it('ne laisse jamais moins que le minimum quand elle s’affiche', () => {
    for (let w = 320; w <= 2560; w += 20) {
      const L = computeLayout(w, 900);
      const cw = cardOf(w, 900);
      if (!vignetteTient(cw, L)) continue;
      expect(cw - L.sp(13) * 2 - L.vignette - 6).toBeGreaterThanOrEqual(LARGEUR_NOM_MIN);
    }
  });
});

describe('Recadrage sur le point d’intérêt — le pendant RN d’object-position', () => {
  it('couvre toujours le carré, sans laisser de liseré', () => {
    for (const [lg, ht] of [[1600, 900], [900, 1600], [800, 800], [1601, 899]]) {
      for (const p of [0, 0.25, 0.5, 0.75, 1]) {
        const c = cadrageVignette(43, lg, ht, p, p);
        expect(c).not.toBeNull();
        if (!c) continue;
        expect(c.width).toBeGreaterThanOrEqual(43);
        expect(c.height).toBeGreaterThanOrEqual(43);
        // Bords : l'image commence à gauche du carré et finit à sa droite.
        expect(c.left).toBeLessThanOrEqual(0);
        expect(c.top).toBeLessThanOrEqual(0);
        expect(c.left + c.width).toBeGreaterThanOrEqual(43);
        expect(c.top + c.height).toBeGreaterThanOrEqual(43);
      }
    }
  });

  it('amène le point d’intérêt au centre quand la photo le permet', () => {
    // Panoramique 2:1 dans un carré de 100 : 100 px débordent horizontalement.
    // Point au quart : 0,25 × 200 = 50, qu'il faut ramener à 50 → décalage 0.
    expect(cadrageVignette(100, 2000, 1000, 0.25, 0.5)).toEqual({
      width: 200,
      height: 100,
      left: 0,
      top: 0,
    });
    // Point au centre : recadrage centré, celui du navigateur sans consigne.
    expect(cadrageVignette(100, 2000, 1000, 0.5, 0.5)?.left).toBe(-50);
    // Point à droite : l'image se cale sur son bord droit, pas au-delà.
    expect(cadrageVignette(100, 2000, 1000, 1, 0.5)?.left).toBe(-100);
    // Et à gauche, symétriquement — le bridage empêche de découvrir le fond.
    expect(cadrageVignette(100, 2000, 1000, 0, 0.5)?.left).toBe(0);
  });

  it('travaille aussi en hauteur sur une photo en portrait', () => {
    expect(cadrageVignette(100, 1000, 2000, 0.5, 0)).toEqual({
      width: 100,
      height: 200,
      left: 0,
      top: 0,
    });
    expect(cadrageVignette(100, 1000, 2000, 0.5, 1)?.top).toBe(-100);
  });

  it('rend null quand les cotes manquent — la surface retombe sur « cover »', () => {
    // `MediaVue.largeur` est `null` quand l'en-tête du fichier ne la donne
    // pas, et une photo héritée du pilote n'est pas un média du tout.
    expect(cadrageVignette(43, null, null, 0.5, 0.5)).toBeNull();
    expect(cadrageVignette(43, 1600, null, 0.5, 0.5)).toBeNull();
    expect(cadrageVignette(43, 0, 900, 0.5, 0.5)).toBeNull();
    expect(cadrageVignette(0, 1600, 900, 0.5, 0.5)).toBeNull();
  });
});


describe('dispositions visuelles v2', () => {
  it('conserve les ancres et borne le configurateur latéral', () => {
    const tablet = computeLayout(1280, 800);
    expect([tablet.railW, tablet.ticketW, tablet.topbarH, tablet.scale]).toEqual([108, 384, 66, 1]);
    expect(tablet.cfgW).toBe(346);
    expect(tablet.railDenseW).toBe(168);
    expect(computeLayout(1920, 1080).cfgW).toBe(420);
  });
  it('ne densifie la liste que si sa largeur utile le permet', () => {
    const layout = computeLayout(1920, 1080);
    expect(layout.listColumnsFor(1039)).toBe(1);
    expect(layout.listColumnsFor(1040)).toBe(2);
  });
});


it('garde un catalogue exploitable à côté du configurateur et replie sinon', () => {
  for (const id of ['B', 'C'] as const) {
    expect(computeLayout(900, 800).configInlineFor(id)).toBe(false);
    expect(computeLayout(1280, 800).configInlineFor(id)).toBe(true);
  }
  expect(computeLayout(1920, 1080).configInlineFor('A')).toBe(false);
});


it('ne réduit jamais le plancher tactile demandé pour encaisser', () => {
  for (const [w, h] of [[320, 568], [390, 844], [820, 1180], [1280, 800], [1920, 1080]]) {
    expect(computeLayout(w, h).touch(52)).toBeGreaterThanOrEqual(52);
  }
});
