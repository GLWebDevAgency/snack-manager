import { beforeEach, describe, expect, it } from 'vitest';
import type { JwtPayload } from '@sm/contracts';
import type { AdminLog, Device, Order, Product, Screen, Tenant, User } from '@sm/db';
import type { SupplyDb } from '@sm/supply';
import { AdminService } from './admin.service';
import { FakeCollection, type Row } from './admin.fakes';
import {
  InsightsService,
  LOW_MARGIN_PCT,
  MARGIN_DROP_POINTS,
  MARGIN_MIN_QTY,
  MIN_COST_COVERAGE_PCT,
  MIN_NETWORK_PANEL,
  MIN_ORDERS_FOR_SLOTS,
  benchmarkFoodCost,
  buildRecommendations,
  buildStockoutLosses,
  findQuietSlots,
  marginPct,
  median,
  mergeCuts,
  productMargins,
  type CrmFoodCostBenchmark,
  type CrmProductMargin,
  type SupplyIndex,
} from './insights.service';

/**
 * Conseil chiffré — jeu d'essai calqué sur le tenant `classfood` réel.
 *
 * La courbe horaire, les produits et les volumes viennent de la base : deux
 * services (11 h-13 h et 18 h-21 h), un pic à 20 h, et quelques commandes
 * isolées à minuit et à 10 h qui sont exactement le piège que la détection de
 * créneaux creux doit ignorer.
 */

const CLASSFOOD = '6a847504c4a551ed35c65ba9';
const VOISIN = '65f000000000000000000002';
const TROISIEME = '65f000000000000000000003';
const TACOS = '6a847505c4a551ed35c65c23';
const FREEZ = '6a847508c4a551ed35c65cbb';
const MONSTER = '6a847508c4a551ed35c65cba';

const SM: JwtPayload = {
  sub: '65f00000000000000000ff01',
  tenantId: null,
  role: 'sm_admin',
  kind: 'user',
};

const NOW = new Date('2026-08-19T15:00:00.000Z');

/** Répartition horaire réelle de Class'Food sur 30 jours (fuseau Paris). */
const CLASSFOOD_HOURS = new Map<number, number>([
  [0, 5],
  [10, 2],
  [11, 75],
  [12, 320],
  [13, 150],
  [14, 8],
  [15, 4],
  [17, 1],
  [18, 174],
  [19, 501],
  [20, 577],
  [21, 224],
  [22, 17],
  [23, 3],
]);
const CLASSFOOD_TOTAL = [...CLASSFOOD_HOURS.values()].reduce((s, n) => s + n, 0);

// ─────────────────────────────────────────────────────────────
// Outils de calcul
// ─────────────────────────────────────────────────────────────

describe('Médiane', () => {
  it('prend la valeur centrale sur un nombre impair', () => {
    expect(median([31, 26, 44])).toBe(31);
  });

  it('moyenne les deux valeurs centrales sur un nombre pair', () => {
    expect(median([26, 30, 32, 44])).toBe(31);
  });

  it('résiste à un restaurant très atypique', () => {
    // C'est tout l'intérêt d'une médiane plutôt qu'une moyenne : un traiteur
    // dont le coût matière est à 70 % ne doit pas déplacer la référence de
    // tous les autres.
    expect(median([28, 29, 30, 31, 70])).toBe(30);
  });

  it('ne rend rien sur une série vide', () => {
    expect(median([])).toBeNull();
  });
});

describe('Marge matière', () => {
  it('se calcule en pourcentage du prix de vente', () => {
    // Tacos XL à 14,50 € pour 4,35 € de matière → 70 % de marge.
    expect(marginPct(1_450, 435)).toBe(70);
  });

  it('ne rend rien quand rien n’a été vendu', () => {
    expect(marginPct(0, 0)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────
// Créneaux creux
// ─────────────────────────────────────────────────────────────

describe('Créneaux creux', () => {
  it('ignore les commandes isolées hors service', () => {
    // Le piège des données réelles : 5 commandes à minuit et 2 à 10 h. Retenir
    // « toute heure avec au moins une commande » étirerait l'amplitude de 0 h à
    // 23 h et désignerait 3 h du matin comme un créneau à travailler.
    const slots = findQuietSlots(CLASSFOOD_HOURS, CLASSFOOD_TOTAL);
    expect(slots.map((s) => s.hour)).not.toContain(0);
    expect(slots.map((s) => s.hour)).not.toContain(3);
    expect(slots.map((s) => s.hour)).not.toContain(15);
  });

  it('désigne le vrai creux du service de Class’Food : l’ouverture du midi', () => {
    // Heures de service retenues : 11, 12, 13, 18, 19, 20, 21 — moyenne 288,7.
    // 11 h fait 75 commandes, soit 74 % de moins.
    const slots = findQuietSlots(CLASSFOOD_HOURS, CLASSFOOD_TOTAL);
    expect(slots[0]?.hour).toBe(11);
    expect(slots[0]?.label).toBe('11h–12h');
    expect(slots[0]?.orders).toBe(75);
    expect(slots[0]?.gapPct).toBe(74);
  });

  it('ne dit rien d’un restaurant qui vend trop peu pour qu’on en déduise quoi que ce soit', () => {
    const petit = new Map([
      [12, 4],
      [13, 3],
      [19, 6],
      [20, 5],
    ]);
    expect(findQuietSlots(petit, MIN_ORDERS_FOR_SLOTS - 1)).toEqual([]);
  });

  it('ne dit rien d’un restaurant qui n’ouvre que sur deux heures', () => {
    // Deux créneaux ne font pas une courbe : il n'y a pas de « propre moyenne »
    // à laquelle se comparer.
    const foodtruck = new Map([
      [12, 200],
      [13, 180],
    ]);
    expect(findQuietSlots(foodtruck, 380)).toEqual([]);
  });

  it('ne compte pas comme un creux une pause d’après-midi assumée', () => {
    // Un restaurant fermé entre 15 h et 18 h ne doit pas se voir conseiller de
    // travailler son après-midi : c'est un choix d'exploitation.
    const slots = findQuietSlots(CLASSFOOD_HOURS, CLASSFOOD_TOTAL);
    expect(slots.map((s) => s.hour)).not.toContain(16);
    expect(slots.map((s) => s.hour)).not.toContain(17);
  });
});

// ─────────────────────────────────────────────────────────────
// Coût matière et comparaison réseau
// ─────────────────────────────────────────────────────────────

/** Index supply minimal : un coût par produit, éventuellement par variante. */
const supplyIndex = (
  costs: Record<string, Record<string, Record<string, number>>>,
  options: Record<string, Record<string, number>> = {},
  cut: Record<string, string[]> = {},
): SupplyIndex => ({
  costs: new Map(
    Object.entries(costs).map(([tenant, products]) => [
      tenant,
      new Map(
        Object.entries(products).map(([product, variants]) => [
          product,
          new Map(Object.entries(variants)),
        ]),
      ),
    ]),
  ),
  options: new Map(Object.entries(options).map(([t, m]) => [t, new Map(Object.entries(m))])),
  cutByIngredient: new Map(Object.entries(cut).map(([t, ids]) => [t, new Set(ids)])),
  available: true,
});

type Sale = {
  tenantId: string;
  productId: string;
  variantKey?: string | null;
  recent?: boolean;
  name?: string;
  qty: number;
  revenueCents: number;
};

const sale = (s: Sale) =>
  ({
    _id: {
      tenantId: s.tenantId,
      productId: s.productId,
      variantKey: s.variantKey ?? null,
      recent: s.recent ?? true,
    },
    name: s.name ?? 'Produit',
    qty: s.qty,
    revenueCents: s.revenueCents,
  }) as never;

const option = (o: {
  tenantId: string;
  productId: string;
  groupKey: string;
  choiceKey: string;
  qty: number;
  recent?: boolean;
}) =>
  ({
    _id: {
      tenantId: o.tenantId,
      productId: o.productId,
      groupKey: o.groupKey,
      choiceKey: o.choiceKey,
      recent: o.recent ?? true,
    },
    qty: o.qty,
  }) as never;

describe('Coût matière comparé au réseau', () => {
  it('rapporte le coût au chiffre d’affaires des seules lignes couvertes', () => {
    // Tacos XL : 1 450 c encaissés, 435 c de matière → 30 % de coût matière.
    const bench = benchmarkFoodCost(
      CLASSFOOD,
      [sale({ tenantId: CLASSFOOD, productId: TACOS, variantKey: 'XL', qty: 100, revenueCents: 145_000 })],
      [],
      supplyIndex({ [CLASSFOOD]: { [TACOS]: { XL: 435 } } }),
    );
    expect(bench.tenantPct).toBe(30);
    expect(bench.coveragePct).toBe(100);
  });

  it('compte les suppléments réellement choisis par les clients', () => {
    // Le tacos gratiné facture 2 € et consomme du fromage : ignorer l'option
    // ferait paraître le produit plus rentable qu'il ne l'est.
    const withOption = benchmarkFoodCost(
      CLASSFOOD,
      [sale({ tenantId: CLASSFOOD, productId: TACOS, variantKey: 'XL', qty: 100, revenueCents: 165_000 })],
      [option({ tenantId: CLASSFOOD, productId: TACOS, groupKey: 'gratine', choiceKey: 'gratine', qty: 100 })],
      supplyIndex(
        { [CLASSFOOD]: { [TACOS]: { XL: 435 } } },
        { [CLASSFOOD]: { [`${TACOS}|gratine|gratine`]: 60 } },
      ),
    );
    // (435 + 60) × 100 / 165 000 = 30 %
    expect(withOption.tenantPct).toBe(30);
  });

  it('replie une variante sans recette propre sur la recette de base', () => {
    // Même règle que `SupplyService.bom` : un « menu maxi » sans recette dédiée
    // ne doit pas sortir du périmètre alors que sa base est connue.
    const bench = benchmarkFoodCost(
      CLASSFOOD,
      [sale({ tenantId: CLASSFOOD, productId: FREEZ, variantKey: 'grand', qty: 10, revenueCents: 3_000 })],
      [],
      supplyIndex({ [CLASSFOOD]: { [FREEZ]: { base: 90 } } }),
    );
    expect(bench.coveragePct).toBe(100);
    expect(bench.tenantPct).toBe(30);
  });

  it('se tait quand la carte est trop peu saisie pour que le chiffre veuille dire quelque chose', () => {
    // Deux tiers du CA sans recette : le ratio décrirait la partie saisie, pas
    // le restaurant. Et c'est précisément la carte mal saisie qui sortirait en
    // tête du classement.
    const bench = benchmarkFoodCost(
      CLASSFOOD,
      [
        sale({ tenantId: CLASSFOOD, productId: TACOS, qty: 10, revenueCents: 10_000 }),
        sale({ tenantId: CLASSFOOD, productId: FREEZ, qty: 100, revenueCents: 30_000 }),
      ],
      [],
      supplyIndex({ [CLASSFOOD]: { [TACOS]: { base: 300 } } }),
    );
    expect(bench.coveragePct).toBeLessThan(MIN_COST_COVERAGE_PCT);
    expect(bench.available).toBe(false);
    expect(bench.tenantPct).toBeNull();
  });

  it('ne publie pas de médiane sur un panel trop petit', () => {
    // Une « médiane » sur deux restaurants, c'est la moyenne de deux
    // restaurants — et un client pourrait en déduire le chiffre de son voisin.
    const bench = benchmarkFoodCost(
      CLASSFOOD,
      [
        sale({ tenantId: CLASSFOOD, productId: TACOS, qty: 100, revenueCents: 145_000 }),
        sale({ tenantId: VOISIN, productId: TACOS, qty: 100, revenueCents: 130_000 }),
      ],
      [],
      supplyIndex({
        [CLASSFOOD]: { [TACOS]: { base: 435 } },
        [VOISIN]: { [TACOS]: { base: 435 } },
      }),
    );
    expect(bench.panel).toBeLessThan(MIN_NETWORK_PANEL);
    expect(bench.networkMedianPct).toBeNull();
    expect(bench.deltaPoints).toBeNull();
  });

  it('compare à la médiane dès que le panel est suffisant', () => {
    const bench = benchmarkFoodCost(
      CLASSFOOD,
      [
        // 40 % de coût matière : ce client est le plus cher des trois.
        sale({ tenantId: CLASSFOOD, productId: TACOS, qty: 100, revenueCents: 100_000 }),
        sale({ tenantId: VOISIN, productId: TACOS, qty: 100, revenueCents: 133_333 }),
        sale({ tenantId: TROISIEME, productId: TACOS, qty: 100, revenueCents: 125_000 }),
      ],
      [],
      supplyIndex({
        [CLASSFOOD]: { [TACOS]: { base: 400 } },
        [VOISIN]: { [TACOS]: { base: 400 } },
        [TROISIEME]: { [TACOS]: { base: 400 } },
      }),
    );
    expect(bench.panel).toBe(3);
    expect(bench.tenantPct).toBe(40);
    expect(bench.networkMedianPct).toBe(32);
    expect(bench.deltaPoints).toBe(8);
  });

  it('n’expose aucun chiffre individuel d’un autre restaurant', () => {
    // Le réseau se résume à une médiane et à une taille de panel. Rien d'autre
    // ne doit pouvoir en sortir.
    const bench = benchmarkFoodCost(
      CLASSFOOD,
      [
        sale({ tenantId: CLASSFOOD, productId: TACOS, qty: 100, revenueCents: 100_000 }),
        sale({ tenantId: VOISIN, productId: TACOS, qty: 100, revenueCents: 133_333 }),
        sale({ tenantId: TROISIEME, productId: TACOS, qty: 100, revenueCents: 125_000 }),
      ],
      [],
      supplyIndex({
        [CLASSFOOD]: { [TACOS]: { base: 400 } },
        [VOISIN]: { [TACOS]: { base: 400 } },
        [TROISIEME]: { [TACOS]: { base: 400 } },
      }),
    );
    const dumped = JSON.stringify(bench);
    expect(dumped).not.toContain(VOISIN);
    expect(dumped).not.toContain(TROISIEME);
    // Le CA renvoyé est celui du client consulté, pas celui du réseau.
    expect(bench.revenueCents).toBe(100_000);
  });
});

// ─────────────────────────────────────────────────────────────
// Marges par produit
// ─────────────────────────────────────────────────────────────

describe('Marges par produit', () => {
  const index = supplyIndex({ [CLASSFOOD]: { [TACOS]: { base: 435 }, [MONSTER]: { base: 250 } } });

  it('ignore un produit dont la recette n’est pas saisie', () => {
    // On ne le note pas « 100 % de marge » : on ne le note pas du tout.
    const margins = productMargins(
      CLASSFOOD,
      [sale({ tenantId: CLASSFOOD, productId: FREEZ, qty: 167, revenueCents: 50_100 })],
      [],
      index,
    );
    expect(margins).toEqual([]);
  });

  it('chiffre la marge d’un produit sur toute la fenêtre', () => {
    const margins = productMargins(
      CLASSFOOD,
      [
        sale({ tenantId: CLASSFOOD, productId: MONSTER, name: 'Monster', qty: 78, recent: true, revenueCents: 27_300 }),
        sale({ tenantId: CLASSFOOD, productId: MONSTER, name: 'Monster', qty: 78, recent: false, revenueCents: 27_300 }),
      ],
      [],
      index,
    );
    // 156 × 250 = 39 000 c de matière pour 54 600 c encaissés → 28,6 % de marge.
    expect(margins[0]?.marginPct).toBe(28.6);
    expect(margins[0]?.qty).toBe(156);
  });

  it('ne parle de chute que si les deux quinzaines pèsent assez', () => {
    // Une marge « en chute » mesurée sur trois ventes n'est pas une chute.
    const margins = productMargins(
      CLASSFOOD,
      [
        sale({ tenantId: CLASSFOOD, productId: TACOS, recent: true, qty: 2, revenueCents: 2_000 }),
        sale({
          tenantId: CLASSFOOD,
          productId: TACOS,
          recent: false,
          qty: MARGIN_MIN_QTY * 10,
          revenueCents: 145_000,
        }),
      ],
      [],
      index,
    );
    expect(margins[0]?.marginDropPoints).toBeNull();
    expect(margins[0]?.recentMarginPct).toBeNull();
  });

  it('détecte une marge qui recule d’une quinzaine à l’autre', () => {
    // Même coût matière, mais le prix encaissé baisse — remises accordées ou
    // bascule du mix vers les variantes les moins chères.
    const margins = productMargins(
      CLASSFOOD,
      [
        sale({ tenantId: CLASSFOOD, productId: TACOS, recent: false, qty: 100, revenueCents: 145_000 }),
        sale({ tenantId: CLASSFOOD, productId: TACOS, recent: true, qty: 100, revenueCents: 120_000 }),
      ],
      [],
      index,
    );
    // 70 % la quinzaine d'avant, 63,7 % la dernière → 6,3 points perdus.
    expect(margins[0]?.previousMarginPct).toBe(70);
    expect(margins[0]?.recentMarginPct).toBe(63.7);
    expect(margins[0]?.marginDropPoints).toBe(6.3);
    expect(margins[0]?.marginDropPoints).toBeGreaterThanOrEqual(MARGIN_DROP_POINTS);
  });

  it('impute le coût des suppléments à la bonne quinzaine', () => {
    const margins = productMargins(
      CLASSFOOD,
      [
        sale({ tenantId: CLASSFOOD, productId: TACOS, recent: false, qty: 100, revenueCents: 145_000 }),
        sale({ tenantId: CLASSFOOD, productId: TACOS, recent: true, qty: 100, revenueCents: 145_000 }),
      ],
      [
        option({
          tenantId: CLASSFOOD,
          productId: TACOS,
          groupKey: 'gratine',
          choiceKey: 'gratine',
          qty: 100,
          recent: true,
        }),
      ],
      supplyIndex(
        { [CLASSFOOD]: { [TACOS]: { base: 435 } } },
        { [CLASSFOOD]: { [`${TACOS}|gratine|gratine`]: 60 } },
      ),
    );
    // Le supplément ne pèse que sur la quinzaine récente.
    expect(margins[0]?.previousMarginPct).toBe(70);
    expect(margins[0]?.recentMarginPct).toBe(65.9);
  });
});

// ─────────────────────────────────────────────────────────────
// Pertes sur ruptures
// ─────────────────────────────────────────────────────────────

const margin = (over: Partial<CrmProductMargin> = {}): CrmProductMargin => ({
  productId: TACOS,
  name: 'Compose ton Tacos',
  qty: 310,
  revenueCents: 449_500,
  costCents: 134_850,
  marginPct: 70,
  recentMarginPct: 70,
  previousMarginPct: 70,
  marginDropPoints: 0,
  ...over,
});

describe('Pertes estimées sur ruptures', () => {
  it('rapporte les ventes aux jours réellement servis, pas aux 30 jours du calendrier', () => {
    // Diviser par 30 les ventes d'un restaurant fermé le dimanche sous-estime
    // la perte d'un septième, tous les jours de la semaine.
    const loss = buildStockoutLosses(
      new Map([[TACOS, { name: 'Compose ton Tacos', cause: 'ingredient' as const }]]),
      [margin()],
      26,
    );
    expect(loss.products[0]?.lossPerDayCents).toBe(17_288);
    expect(loss.products[0]?.qtyPerDay).toBe(11.9);
    expect(loss.totalPerDayCents).toBe(17_288);
  });

  it('n’invente aucune perte pour un produit coupé qui ne se vendait pas', () => {
    const loss = buildStockoutLosses(
      new Map([[FREEZ, { name: 'Freez', cause: 'manuel' as const }]]),
      [margin()],
      26,
    );
    expect(loss.products).toEqual([]);
    expect(loss.totalPerDayCents).toBe(0);
  });

  it('ne rend rien quand le restaurant n’a servi aucun jour', () => {
    const loss = buildStockoutLosses(
      new Map([[TACOS, { name: 'Compose ton Tacos', cause: 'manuel' as const }]]),
      [margin()],
      0,
    );
    expect(loss.products).toEqual([]);
  });

  it('classe les produits coupés par manque à gagner décroissant', () => {
    const loss = buildStockoutLosses(
      new Map([
        [TACOS, { name: 'Compose ton Tacos', cause: 'ingredient' as const }],
        [MONSTER, { name: 'Monster', cause: 'manuel' as const }],
      ]),
      [margin(), margin({ productId: MONSTER, name: 'Monster', qty: 156, revenueCents: 54_600 })],
      30,
    );
    expect(loss.products.map((p) => p.name)).toEqual(['Compose ton Tacos', 'Monster']);
  });

  it('récupère le nom d’un produit coupé par cascade depuis les lignes de commande', () => {
    // La rupture d'ingrédient vient de PostgreSQL, qui ne connaît que la
    // référence du produit ; le libellé est celui dénormalisé sur le ticket.
    const cut = mergeCuts(new Map(), new Set([TACOS]));
    const loss = buildStockoutLosses(cut, [margin()], 30);
    expect(loss.products[0]?.name).toBe('Compose ton Tacos');
    expect(loss.products[0]?.cause).toBe('ingredient');
  });

  it('fait primer la coupure décidée au comptoir sur la cascade', () => {
    // C'est celle qu'un humain a décidée, et celle qu'il faut lui rappeler
    // s'il a oublié de rouvrir le produit.
    const cut = mergeCuts(new Map([[TACOS, 'Compose ton Tacos']]), new Set([TACOS]));
    expect(cut.get(TACOS)?.cause).toBe('manuel');
    expect(cut.size).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────
// Recommandations
// ─────────────────────────────────────────────────────────────

const noBenchmark: CrmFoodCostBenchmark = {
  available: false,
  tenantPct: null,
  networkMedianPct: null,
  panel: 0,
  deltaPoints: null,
  costCents: 0,
  revenueCents: 0,
  coveragePct: 0,
};

const emptyFacts = {
  foodCost: noBenchmark,
  quietSlots: [],
  lowMarginProducts: [],
  fallingMarginProducts: [],
  stockoutLosses: { products: [], totalPerDayCents: 0 },
};

describe('Recommandations', () => {
  it('ne dit rien quand il n’y a rien à dire', () => {
    // Un conseil faux se paie en crédibilité, une seule fois, définitivement.
    expect(buildRecommendations(emptyFacts)).toEqual([]);
  });

  it('se tait sur le coût matière tant que la médiane du réseau manque', () => {
    const recos = buildRecommendations({
      ...emptyFacts,
      foodCost: { ...noBenchmark, available: true, tenantPct: 38, coveragePct: 90, panel: 1 },
    });
    expect(recos).toEqual([]);
  });

  it('ne félicite pas : un client meilleur que le réseau ne produit aucun conseil', () => {
    const recos = buildRecommendations({
      ...emptyFacts,
      foodCost: {
        ...noBenchmark,
        available: true,
        tenantPct: 26,
        networkMedianPct: 31,
        deltaPoints: -5,
        panel: 4,
        coveragePct: 95,
      },
    });
    expect(recos).toEqual([]);
  });

  it('porte un intitulé court, une phrase et un chiffre sur chaque conseil', () => {
    const recos = buildRecommendations({
      foodCost: {
        available: true,
        tenantPct: 38,
        networkMedianPct: 31,
        deltaPoints: 7,
        panel: 4,
        costCents: 380_000,
        revenueCents: 1_000_000,
        coveragePct: 92,
      },
      quietSlots: [{ hour: 11, label: '11h–12h', orders: 75, averageOrders: 288.7, gapPct: 74 }],
      lowMarginProducts: [margin({ name: 'Monster', marginPct: 28.6 })],
      fallingMarginProducts: [
        margin({ name: 'Compose ton Tacos', recentMarginPct: 63.8, previousMarginPct: 70, marginDropPoints: 6.2 }),
      ],
      stockoutLosses: {
        products: [
          {
            productId: TACOS,
            name: 'Compose ton Tacos',
            qtyPerDay: 11.9,
            lossPerDayCents: 17_288,
            cause: 'ingredient',
          },
        ],
        totalPerDayCents: 17_288,
      },
    });

    expect(recos.map((r) => r.key)).toEqual([
      'food_cost_above_network',
      'low_margin_products',
      'falling_margin_products',
      'quiet_slots',
      'stockout_losses',
    ]);
    for (const reco of recos) {
      expect(reco.title, reco.key).toMatch(/\S/);
      expect(reco.detail, reco.key).toMatch(/\S/);
      expect(Number.isFinite(reco.value), reco.key).toBe(true);
    }
  });

  it('cite le chiffre exact dans la phrase, jamais une formule vague', () => {
    const recos = buildRecommendations({
      ...emptyFacts,
      foodCost: {
        available: true,
        tenantPct: 38,
        networkMedianPct: 31,
        deltaPoints: 7,
        panel: 4,
        costCents: 380_000,
        revenueCents: 1_000_000,
        coveragePct: 92,
      },
    });
    expect(recos[0]?.detail).toContain('38 %');
    expect(recos[0]?.detail).toContain('31 %');
    expect(recos[0]?.detail).toContain('4 restaurants');
    expect(recos[0]?.value).toBe(7);
    expect(recos[0]?.severity).toBe('urgent');
  });

  it('parle en euros lisibles pour le manque à gagner', () => {
    const recos = buildRecommendations({
      ...emptyFacts,
      stockoutLosses: {
        products: [
          {
            productId: TACOS,
            name: 'Compose ton Tacos',
            qtyPerDay: 11.9,
            lossPerDayCents: 17_288,
            cause: 'ingredient',
          },
        ],
        totalPerDayCents: 17_288,
      },
    });
    expect(recos[0]?.detail).toContain('Compose ton Tacos');
    expect(recos[0]?.detail).toContain('173 €');
    // Le montant reste en CENTIMES dans le champ chiffré — convention monorepo.
    expect(recos[0]?.value).toBe(17_288);
    expect(recos[0]?.unit).toBe('centimes');
  });

  it('écrit les décimales à la française', () => {
    // Le monorepo est en français sans exception : un « 288.7 » anglo-saxon au
    // milieu d'une phrase est une faute que l'équipe lit cinquante fois par jour.
    const recos = buildRecommendations({
      ...emptyFacts,
      quietSlots: [{ hour: 11, label: '11h–12h', orders: 75, averageOrders: 288.7, gapPct: 74 }],
      fallingMarginProducts: [
        margin({ name: 'Compose ton Tacos', recentMarginPct: 63.7, previousMarginPct: 70, marginDropPoints: 6.3 }),
      ],
    });
    const phrases = recos.map((r) => r.detail).join(' ');
    expect(phrases).toContain('288,7');
    expect(phrases).toContain('6,3');
    expect(phrases).toContain('63,7');
    expect(phrases).not.toMatch(/\d\.\d/);
  });

  it('nomme le produit à marge faible et son pourcentage', () => {
    const recos = buildRecommendations({
      ...emptyFacts,
      lowMarginProducts: [margin({ name: 'Monster', marginPct: 28.6 })],
    });
    expect(recos[0]?.detail).toContain('Monster');
    expect(recos[0]?.detail).toContain(String(LOW_MARGIN_PCT));
    expect(recos[0]?.value).toBe(28.6);
  });
});

// ─────────────────────────────────────────────────────────────
// Le service, avec des doublures de base
// ─────────────────────────────────────────────────────────────

class FakeOrders {
  readonly pipelines: unknown[][] = [];
  constructor(private readonly results: Row[][] = []) {}

  async aggregate<T>(pipeline: unknown[]): Promise<T[]> {
    this.pipelines.push(pipeline);
    return (this.results.shift() ?? []) as T[];
  }

  asModel<T>(): import('mongoose').Model<T> {
    return this as unknown as import('mongoose').Model<T>;
  }
}

/** Contexte supply : une recette de tacos, une option gratinée, rien en rupture. */
function fakeSupply(over?: { throws?: boolean }): SupplyDb {
  if (over?.throws) {
    return {
      query: {
        recipes: { findMany: () => Promise.reject(new Error('ECONNREFUSED 127.0.0.1:5432')) },
        optionIngredients: { findMany: () => Promise.reject(new Error('ECONNREFUSED')) },
      },
    } as unknown as SupplyDb;
  }
  return {
    query: {
      recipes: {
        findMany: async () => [
          {
            tenantRef: CLASSFOOD,
            productRef: TACOS,
            variantKey: 'XL',
            lines: [
              {
                qty: '0.300',
                unit: 'kg',
                ingredient: { costPerUnitCents: 1_450, isOut: false },
              },
            ],
          },
        ],
      },
      optionIngredients: {
        findMany: async () => [
          {
            tenantRef: CLASSFOOD,
            productRef: TACOS,
            groupKey: 'gratine',
            choiceKey: 'gratine',
            qty: '0.050',
            unit: 'kg',
            ingredient: { costPerUnitCents: 1_200 },
          },
        ],
      },
    },
  } as unknown as SupplyDb;
}

const dump = (value: unknown): string =>
  JSON.stringify(value, (_k, v: unknown) => (v instanceof Date ? v.toISOString() : v));

/**
 * Champs qu'aucune requête de cette surface n'a le droit de toucher : le
 * fichier client d'un restaurateur lui appartient.
 */
const FORBIDDEN_FIELDS = ['customerName', 'customerPhone', 'pickup', 'trackingToken', 'author'];

describe('Conseil chiffré', () => {
  let tenants: FakeCollection;
  let products: FakeCollection;
  let devices: FakeCollection;
  let screens: FakeCollection;
  let logs: FakeCollection;
  let users: FakeCollection;
  let orders: FakeOrders;

  const build = (results: Row[][], supply = fakeSupply()) => {
    orders = new FakeOrders(results);
    const admin = new AdminService(
      tenants.asModel<Tenant>(),
      devices.asModel<Device>(),
      screens.asModel<Screen>(),
      logs.asModel<AdminLog>(),
      users.asModel<User>(),
    );
    return new InsightsService(
      tenants.asModel<Tenant>(),
      orders.asModel<Order>(),
      products.asModel<Product>(),
      supply,
      admin,
    );
  };

  beforeEach(() => {
    tenants = new FakeCollection('tenant');
    products = new FakeCollection('product');
    devices = new FakeCollection('device');
    screens = new FakeCollection('screen');
    logs = new FakeCollection('log');
    users = new FakeCollection('user');
    tenants.seed({ _id: CLASSFOOD, name: "CLASS'FOOD", slug: 'classfood' });
    users.seed({ _id: SM.sub, email: 'admin@snackmanager.fr' });
  });

  /** Les trois passes : ventes, options, forme du service. */
  const passes = (over: { sales?: Row[]; options?: Row[]; shape?: Row } = {}): Row[][] => [
    over.sales ?? [
      sale({
        tenantId: CLASSFOOD,
        productId: TACOS,
        variantKey: 'XL',
        name: 'Compose ton Tacos',
        recent: true,
        qty: 155,
        revenueCents: 224_750,
      }) as unknown as Row,
      sale({
        tenantId: CLASSFOOD,
        productId: TACOS,
        variantKey: 'XL',
        name: 'Compose ton Tacos',
        recent: false,
        qty: 155,
        revenueCents: 224_750,
      }) as unknown as Row,
    ],
    over.options ?? [],
    [
      over.shape ?? {
        hours: [...CLASSFOOD_HOURS.entries()].map(([_id, orders]) => ({ _id, orders })),
        days: [{ n: 31 }],
      },
    ],
  ];

  it('chiffre le coût matière du restaurant sur des données réelles', async () => {
    // 0,3 kg de viande à 14,50 €/kg = 435 c par tacos, 310 vendus, 4 495 € de
    // CA → 30 % de coût matière.
    const insights = await build(passes()).tenantInsights(SM, CLASSFOOD, NOW);

    expect(insights.foodCost.available).toBe(true);
    expect(insights.foodCost.tenantPct).toBe(30);
    expect(insights.foodCost.costCents).toBe(134_850);
    expect(insights.serviceDays).toBe(31);
  });

  it('ne compare pas au réseau tant que Snack Manager n’a qu’un client', () => {
    // Cas réel de la base aujourd'hui : un seul tenant. La fiche doit sortir
    // sans médiane et sans recommandation de coût matière — pas avec une
    // comparaison du client à lui-même.
    return build(passes())
      .tenantInsights(SM, CLASSFOOD, NOW)
      .then((insights) => {
        expect(insights.foodCost.networkMedianPct).toBeNull();
        expect(insights.recommendations.map((r) => r.key)).not.toContain(
          'food_cost_above_network',
        );
      });
  });

  it('désigne le créneau creux réel du restaurant', async () => {
    const insights = await build(passes()).tenantInsights(SM, CLASSFOOD, NOW);

    expect(insights.quietSlots[0]?.hour).toBe(11);
    expect(insights.recommendations.map((r) => r.key)).toContain('quiet_slots');
  });

  it('sort sans aucune recommandation quand le coût matière est inconnu', async () => {
    // PostgreSQL injoignable : la réponse est vide plutôt que fausse.
    const insights = await build(passes(), fakeSupply({ throws: true })).tenantInsights(
      SM,
      CLASSFOOD,
      NOW,
    );

    expect(insights.foodCost.available).toBe(false);
    expect(insights.lowMarginProducts).toEqual([]);
    expect(insights.fallingMarginProducts).toEqual([]);
    // Les créneaux creux, eux, ne dépendent que de MongoDB : ils restent.
    expect(insights.quietSlots.length).toBeGreaterThan(0);
  });

  it('journalise la consultation du dossier', async () => {
    await build(passes()).tenantInsights(SM, CLASSFOOD, NOW);

    const entry = logs.rows.at(-1);
    expect(entry?.action).toBe('tenant.detail_view');
    expect(String(entry?.tenantId)).toBe(CLASSFOOD);
  });

  it('rend 404 sur un établissement inconnu ou un identifiant mal formé', async () => {
    await expect(build([]).tenantInsights(SM, 'pas-un-objectid', NOW)).rejects.toThrow(
      'Établissement introuvable',
    );
    await expect(build([]).tenantInsights(SM, VOISIN, NOW)).rejects.toThrow(
      'Établissement introuvable',
    );
  });

  it('cloisonne la forme du service au restaurant demandé', async () => {
    // Les créneaux creux et les jours servis sont propres au client : cette
    // passe-là doit porter son tenantId, contrairement à celle qui construit
    // la médiane du réseau.
    await build(passes()).tenantInsights(SM, CLASSFOOD, NOW);

    const shape = orders.pipelines.at(-1);
    const match = (shape?.[0] as { $match?: Record<string, unknown> }).$match;
    expect(String(match?.tenantId)).toBe(CLASSFOOD);
  });

  it('ne demande à MongoDB aucun champ de consommateur final', async () => {
    const insights = await build(passes()).tenantInsights(SM, CLASSFOOD, NOW);
    const seen = [...orders.pipelines.map(dump), dump(insights)].join(' ');

    for (const field of FORBIDDEN_FIELDS) {
      expect(seen, field).not.toContain(field);
    }
  });
});
