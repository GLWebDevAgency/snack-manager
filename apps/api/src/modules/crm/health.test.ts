import { beforeEach, describe, expect, it } from 'vitest';
import {
  CLIENT_RISK_DAYS,
  NO_OUTSTANDING,
  summarizeOutstanding,
  type CrmOutstanding,
  type JwtPayload,
} from '@sm/contracts';
import type { AdminLog, Device, Order, Screen, Tenant, User } from '@sm/db';
import type { SupplyDb } from '@sm/supply';
import { AdminService } from './admin.service';
import { FakeCollection, type Row } from './admin.fakes';
import type { BillingService } from './billing.service';
import {
  HEALTH_AXIS_WEIGHTS,
  HealthService,
  STOCKS_SETUP_MIN_INGREDIENTS,
  TREND_MIN_REFERENCE_ORDERS,
  buildFleet,
  buildModules,
  buildWindow,
  compositeScore,
  deltaPct,
  scoreActivite,
  scoreAdoption,
  scoreTechnique,
  toFleetUnit,
  trendFloorFor,
  verdictFor,
  windowBounds,
  type CrmFleetUnit,
  type CrmHealthAxis,
  type CrmHealthAxisKey,
} from './health.service';

/**
 * Fiche de santé et file de travail — jeu d'essai calqué sur le tenant
 * `classfood` réel : une caisse et un écran cuisine appairés, aucun écran de
 * salle, une majorité de commandes en caisse et un flux en ligne minoritaire.
 * Les volumes (≈ 1 700 commandes caisse et ≈ 500 en ligne sur 30 jours) sont
 * ceux de la base, pour que les seuils soient éprouvés sur des ordres de
 * grandeur vrais et non sur des chiffres ronds choisis pour passer.
 */

const CLASSFOOD = '6a847504c4a551ed35c65ba9';
const VOISIN = '65f000000000000000000002';
const CAISSE = '6a85aa88d1a25cf38af91847';
const CUISINE = '6a85ab3dd1a25cf38af91874';

const SM: JwtPayload = {
  sub: '65f00000000000000000ff01',
  tenantId: null,
  role: 'sm_admin',
  kind: 'user',
};

const NOW = new Date('2026-08-19T15:00:00.000Z');
const DAY_MS = 86_400_000;
const hoursAgo = (n: number) => new Date(NOW.getTime() - n * 3_600_000);
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY_MS);

/** Un appareil de terrain tel qu'il sort de la base, réduit à ce qui est lu. */
const unit = (over: Partial<CrmFleetUnit> = {}): CrmFleetUnit => ({
  id: CAISSE,
  name: 'Caisse comptoir',
  kind: 'pos',
  kindLabel: 'Caisse',
  paired: true,
  online: true,
  appVersion: '',
  queueDepth: null,
  lastError: '',
  lastSeenAt: NOW.toISOString(),
  statusLabel: 'En ligne',
  ...over,
});

const axis = (
  key: CrmHealthAxisKey,
  measured: boolean,
  score: number | null,
): CrmHealthAxis => ({
  key,
  label: key,
  weight: HEALTH_AXIS_WEIGHTS[key],
  measured,
  score,
  detail: '',
});

// ─────────────────────────────────────────────────────────────
// Le jugement — fonctions pures
// ─────────────────────────────────────────────────────────────

describe('Variation d’une période à l’autre', () => {
  it('ne renvoie rien quand la période précédente était vide', () => {
    // « +∞ % » n'aide personne : un client qui passe de 0 à 3 commandes n'a
    // pas fait « +300 % », il a démarré.
    expect(deltaPct(3, 0)).toBeNull();
    expect(deltaPct(0, 0)).toBeNull();
  });

  it('chiffre la chute à une décimale', () => {
    expect(deltaPct(120, 200)).toBe(-40);
    expect(deltaPct(97, 143)).toBe(-32.2);
  });
});

describe('Fenêtres de comparaison', () => {
  it('compare deux périodes de durée strictement égale', () => {
    // Sinon la variation mesure la longueur de la fenêtre autant que
    // l'activité du restaurant.
    const b = windowBounds(NOW);
    expect(NOW.getTime() - b.short.getTime()).toBe(b.short.getTime() - b.shortPrev.getTime());
    expect(NOW.getTime() - b.long.getTime()).toBe(b.long.getTime() - b.longPrev.getTime());
  });
});

describe('Axe activité', () => {
  it('n’est pas mesuré pour un restaurant qui n’a jamais encaissé', () => {
    // Un restaurant signé hier n'est pas un restaurant en train de mourir :
    // lui coller 0 l'afficherait « critique » le jour de sa signature.
    const r = scoreActivite({
      daysSinceLastOrder: null,
      orders7d: 0,
      previousOrders7d: 0,
      hasHistory: false,
    });
    expect(r.measured).toBe(false);
    expect(r.score).toBeNull();
  });

  it('note au maximum un client qui encaisse aujourd’hui et progresse', () => {
    const r = scoreActivite({
      daysSinceLastOrder: 0,
      orders7d: 420,
      previousOrders7d: 380,
      hasHistory: true,
    });
    expect(r.score).toBe(100);
  });

  it('ne récompense pas la croissance au-delà du maximum', () => {
    // Croître n'est pas exigé ; ne pas s'effondrer, si. Un doublement ne peut
    // pas compenser trois semaines de silence sur un autre axe.
    const r = scoreActivite({
      daysSinceLastOrder: 0,
      orders7d: 800,
      previousOrders7d: 380,
      hasHistory: true,
    });
    expect(r.score).toBe(100);
  });

  it('fait chuter la note d’un client qui décroche', () => {
    // 400 → 120 commandes, et plus rien depuis 4 jours : c'est le cas que la
    // fiche doit faire sauter aux yeux.
    const r = scoreActivite({
      daysSinceLastOrder: 4,
      orders7d: 120,
      previousOrders7d: 400,
      hasHistory: true,
    });
    expect(r.score).toBeLessThan(40);
    expect(r.detail).toContain('-70 %');
  });

  it('tombe à zéro au seuil de risque du CRM', () => {
    // Le même seuil que `clientHealth` : un client « à risque » ne peut pas
    // afficher une bonne note d'activité sur la fiche d'à côté.
    const r = scoreActivite({
      daysSinceLastOrder: CLIENT_RISK_DAYS,
      orders7d: 0,
      previousOrders7d: 300,
      hasHistory: true,
    });
    expect(r.score).toBe(0);
  });

  it('écrit la tendance à la française', () => {
    // « -10.9 % » au milieu d'une phrase française est une faute, et l'équipe
    // la lit sur chaque fiche qu'elle ouvre.
    const r = scoreActivite({
      daysSinceLastOrder: 0,
      orders7d: 443,
      previousOrders7d: 497,
      hasHistory: true,
    });
    expect(r.detail).toContain('-10,9 %');
    expect(r.detail).not.toMatch(/\d\.\d/);
  });

  it('se rabat sur la récence quand la semaine précédente était vide', () => {
    const r = scoreActivite({
      daysSinceLastOrder: 0,
      orders7d: 12,
      previousOrders7d: 0,
      hasHistory: true,
    });
    expect(r.measured).toBe(true);
    expect(r.score).toBe(100);
    expect(r.detail).toContain('non mesurable');
  });
});

describe('Axe adoption', () => {
  const module = (key: string, provisioned: boolean, used: boolean) =>
    ({ key, label: key, provisioned, used, lastUsedAt: null, detail: '' }) as never;

  it('ne juge que les modules réellement ouverts chez le client', () => {
    // Reprocher à un restaurant sans téléviseur de ne pas utiliser les écrans
    // de salle n'apprend rien à personne.
    const r = scoreAdoption([
      module('caisse', true, true),
      module('commande_en_ligne', true, true),
      module('ecrans_salle', false, false),
    ]);
    expect(r.score).toBe(100);
  });

  it('nomme les modules ouverts et jamais servis', () => {
    const r = scoreAdoption([
      module('caisse', true, true),
      module('commande_en_ligne', true, false),
    ]);
    expect(r.score).toBe(50);
    expect(r.detail).toContain('commande_en_ligne');
  });

  it('n’est pas mesuré quand rien n’est ouvert', () => {
    expect(scoreAdoption([module('caisse', false, false)]).measured).toBe(false);
  });
});

describe('Axe technique', () => {
  it('ignore les appareils encore en attente d’appairage', () => {
    // Un carton pas encore ouvert n'est pas une panne.
    const fleet = buildFleet([unit(), unit({ id: 'x', paired: false, online: false })]);
    expect(scoreTechnique(fleet).score).toBe(100);
  });

  it('chiffre la part du parc qui répond, et nomme les muets', () => {
    const fleet = buildFleet([
      unit(),
      unit({ id: CUISINE, name: 'Écran cuisine', kind: 'kds', online: false }),
    ]);
    const r = scoreTechnique(fleet);
    expect(r.score).toBe(50);
    expect(r.detail).toContain('Écran cuisine');
  });

  it('n’est pas mesuré sans aucun appareil appairé', () => {
    expect(scoreTechnique(buildFleet([])).measured).toBe(false);
  });
});

/**
 * L'axe PAIEMENT n'est plus jugé ici : sa règle vit dans `@sm/contracts`
 * (`paiementAxis`), avec le reste de la facturation, et `billing.test.ts` la
 * couvre bande par bande. Ce fichier vérifie le BRANCHEMENT — que la fiche lui
 * passe bien l'ardoise réelle du client (voir « Fiche de santé »).
 */

describe('Plancher de la tendance', () => {
  it('refuse de chiffrer une variation sous le plancher de référence', () => {
    // Le cas réel : CLASS'FOOD, 2 050 commandes sur 30 j contre 11 la période
    // d'avant parce qu'il venait d'arriver — « +18 536,4 % » est exact et ne
    // mesure que son arrivée. Un chiffre pareil occupe la place de la seule
    // chose qu'on voulait lire.
    const w = buildWindow(
      30,
      { orders: 2_050, revenueCents: 4_220_520 },
      { orders: 11, revenueCents: 21_560 },
    );
    expect(w.previousOrders).toBe(11);
    expect(w.ordersDeltaPct).toBeNull();
    // Le CA suit le MÊME plancher : « tendance non mesurable » au-dessus de
    // « +19 475 % » dans le même bloc serait pire que les deux séparément.
    expect(w.revenueDeltaPct).toBeNull();
  });

  it('mesure le plancher en RYTHME, pas en comptage brut', () => {
    // Cinq commandes ne disent pas la même chose sur sept jours et sur trente.
    // Un plancher fixe laissait justement passer le cas ci-dessus.
    expect(trendFloorFor(7)).toBe(TREND_MIN_REFERENCE_ORDERS);
    expect(trendFloorFor(30)).toBe(22);
    const w = buildWindow(30, { orders: 40, revenueCents: 80_000 }, { orders: 22, revenueCents: 44_000 });
    expect(w.ordersDeltaPct).toBe(81.8);
  });

  it('chiffre la tendance dès que la période de référence pèse assez', () => {
    const w = buildWindow(
      7,
      { orders: 439, revenueCents: 877_640 },
      { orders: 492, revenueCents: 1_054_830 },
    );
    expect(w.ordersDeltaPct).toBe(-10.8);
    expect(w.revenueDeltaPct).toBe(-16.8);
  });

  it('applique le même plancher à la phrase de l’axe activité', () => {
    // Sinon la fiche affiche « tendance non mesurable » dans le bloc activité
    // et « +25 562,5 % vs 7 j précédents » trois lignes plus bas, dans le
    // détail de l'axe — le même écran se contredisant tout seul.
    const r = scoreActivite({
      daysSinceLastOrder: 0,
      orders7d: 2_054,
      previousOrders7d: TREND_MIN_REFERENCE_ORDERS - 1,
      hasHistory: true,
    });
    expect(r.detail).toContain('non mesurable');
    expect(r.detail).not.toContain('%');
  });
});

describe('Score composite', () => {
  it('pondère les quatre axes sur 100', () => {
    const total = Object.values(HEALTH_AXIS_WEIGHTS).reduce((s, w) => s + w, 0);
    expect(total).toBe(100);
  });

  it('retire du calcul un axe non mesuré au lieu de le noter zéro', () => {
    // Le piège : un restaurant qui vient de signer n'a ni historique ni parc.
    // Compter 0 sur deux axes l'afficherait « critique » le jour de sa
    // signature — le score doit se calculer sur ce qu'on sait.
    const score = compositeScore([
      axis('activite', false, null),
      axis('adoption', true, 100),
      axis('technique', false, null),
      axis('paiement', true, 100),
    ]);
    expect(score.value).toBe(100);
    expect(score.verdict).toBe('solide');
  });

  it('rend un verdict lisible, pas seulement un nombre', () => {
    const score = compositeScore([
      axis('activite', true, 45),
      axis('adoption', true, 50),
      axis('technique', true, 50),
      axis('paiement', true, 100),
    ]);
    // 0,4×45 + 0,25×50 + 0,2×50 + 0,15×100 = 18 + 12,5 + 10 + 15 = 55,5
    expect(score.value).toBe(56);
    expect(score.verdict).toBe('fragile');
    expect(score.verdictLabel).toMatch(/rappeler/);
  });

  it('sanctionne durement l’arrêt d’activité, même tout le reste au vert', () => {
    // Le piège que ce plafond corrige : une moyenne dilue. Un client qui
    // n'encaisse plus rien ressortait à 60/100 — « client correct » — parce que
    // ses tablettes clignotent et que sa facture est réglée. C'est exactement
    // celui qu'on ne rappelle pas, et qu'on retrouve résilié six semaines plus
    // tard.
    const score = compositeScore([
      axis('activite', true, 0),
      axis('adoption', true, 100),
      axis('technique', true, 100),
      axis('paiement', true, 100),
    ]);
    expect(score.value).toBe(60);
    expect(score.verdict).toBe('critique');
    expect(score.cappedBy).toBe('activite');
  });

  it('ne plafonne rien quand l’activité est le point fort du client', () => {
    const score = compositeScore([
      axis('activite', true, 100),
      axis('adoption', true, 40),
      axis('technique', true, 0),
      axis('paiement', true, 100),
    ]);
    expect(score.cappedBy).toBeNull();
    expect(score.verdict).toBe(verdictFor(score.value));
  });

  it('ne plafonne pas sur un axe qu’on n’a pas pu mesurer', () => {
    // Un restaurant qui vient de signer n'a pas d'historique : l'absence de
    // donnée ne doit jamais valoir une mauvaise note.
    const score = compositeScore([
      axis('activite', false, null),
      axis('adoption', true, 100),
      axis('paiement', true, 100),
    ]);
    expect(score.cappedBy).toBeNull();
    expect(score.verdict).toBe('solide');
  });
});

// ─────────────────────────────────────────────────────────────
// Adoption et parc
// ─────────────────────────────────────────────────────────────

describe('Adoption des modules', () => {
  const classfoodModules = () =>
    buildModules({
      posOrders: 1_729,
      posLastOrderAt: hoursAgo(2),
      onlineOrders: 508,
      onlineLastOrderAt: hoursAgo(5),
      posDevices: [unit()],
      kdsDevices: [unit({ id: CUISINE, name: 'Écran cuisine', kind: 'kds' })],
      screens: [],
    });

  it('compte la commande en ligne comme toujours ouverte', () => {
    // La page de commande est servie dès la création du restaurant, sans
    // aucun geste de sa part : c'est ce qui en fait le module le plus souvent
    // oublié, et c'est pour ça qu'on le surveille chez tout le monde.
    const online = classfoodModules().find((m) => m.key === 'commande_en_ligne');
    expect(online?.provisioned).toBe(true);
  });

  it('n’ouvre pas les écrans de salle chez un client qui n’en a pas', () => {
    const screens = classfoodModules().find((m) => m.key === 'ecrans_salle');
    expect(screens?.provisioned).toBe(false);
    expect(screens?.used).toBe(false);
  });

  it('distingue une tablette appairée d’une tablette utilisée', () => {
    // Un écran cuisine appairé qui n'a jamais émis un signe de vie n'est pas
    // un module utilisé, c'est un carton ouvert.
    const modules = buildModules({
      posOrders: 0,
      posLastOrderAt: null,
      onlineOrders: 0,
      onlineLastOrderAt: null,
      posDevices: [],
      kdsDevices: [unit({ id: CUISINE, kind: 'kds', lastSeenAt: null, online: false })],
      screens: [],
    });
    const cuisine = modules.find((m) => m.key === 'cuisine');
    expect(cuisine?.provisioned).toBe(true);
    expect(cuisine?.used).toBe(false);
    expect(cuisine?.detail).toContain('jamais connecté');
  });

  it('date la dernière utilisation de chaque canal de vente', () => {
    const modules = classfoodModules();
    expect(modules.find((m) => m.key === 'caisse')?.lastUsedAt).toBe(hoursAgo(2).toISOString());
    expect(modules.find((m) => m.key === 'commande_en_ligne')?.lastUsedAt).toBe(
      hoursAgo(5).toISOString(),
    );
  });

  it('ne rend aucun module « stocks » quand l’appro n’a pas répondu', () => {
    // `SignalsService` appelle `buildModules` puis ajoute son propre module
    // stocks : en rendre un ici sans qu'on le demande afficherait la ligne en
    // double dans la file de travail.
    expect(classfoodModules().map((m) => m.key)).toEqual([
      'caisse',
      'cuisine',
      'commande_en_ligne',
      'ecrans_salle',
    ]);
  });

  it('ouvre le suivi des stocks sur un registre monté, et le dit dormant sans mouvement', () => {
    // Le cas réel de CLASS'FOOD : 107 ingrédients, 3 fournisseurs, pas un seul
    // mouvement de stock. La file de signaux le disait déjà ; la fiche, elle,
    // n'avait jamais entendu parler de ce module — le chargé de compte cliquait
    // sur le signal et atterrissait sur un dossier où il n'existait pas.
    const modules = buildModules({
      posOrders: 1_729,
      posLastOrderAt: hoursAgo(2),
      onlineOrders: 508,
      onlineLastOrderAt: hoursAgo(5),
      posDevices: [unit()],
      kdsDevices: [],
      screens: [],
      supply: { ingredients: 107, suppliers: 3, movements: 0, movements30d: 0 },
    });
    const stocks = modules.find((m) => m.key === 'stocks');
    expect(stocks?.label).toBe('Suivi des stocks');
    expect(stocks?.provisioned).toBe(true);
    expect(stocks?.used).toBe(false);
    expect(stocks?.detail).toContain('107 ingrédients');
  });

  it('ne reproche pas un registre à peine ébauché', () => {
    const modules = buildModules({
      posOrders: 0,
      posLastOrderAt: null,
      onlineOrders: 0,
      onlineLastOrderAt: null,
      posDevices: [],
      kdsDevices: [],
      screens: [],
      supply: {
        ingredients: STOCKS_SETUP_MIN_INGREDIENTS - 1,
        suppliers: 1,
        movements: 0,
        movements30d: 0,
      },
    });
    expect(modules.find((m) => m.key === 'stocks')?.provisioned).toBe(false);
  });

  it('garde le suivi des stocks HORS du score, affiché mais non compté', () => {
    // Il se lit dans PostgreSQL, dont l'indisponibilité est un cas prévu :
    // l'y compter ferait bouger le score du client selon qu'une base répond ou
    // non ce matin-là — et la liste `/crm/tenants`, qui ne lit que Mongo,
    // n'afficherait plus le même nombre que la fiche qu'on ouvre en cliquant.
    const base = {
      posOrders: 1_729,
      posLastOrderAt: hoursAgo(2),
      onlineOrders: 508,
      onlineLastOrderAt: hoursAgo(5),
      posDevices: [unit()],
      kdsDevices: [unit({ id: CUISINE, name: 'Écran cuisine', kind: 'kds' })],
      screens: [],
    };
    const sans = scoreAdoption(buildModules(base));
    const avec = scoreAdoption(
      buildModules({
        ...base,
        supply: { ingredients: 107, suppliers: 3, movements: 0, movements30d: 0 },
      }),
    );
    expect(sans.score).toBe(100);
    expect(avec.score).toBe(sans.score);
  });
});

describe('État d’un appareil', () => {
  it('rédige l’état plutôt que de laisser une soustraction à faire', () => {
    const view = toFleetUnit(
      { _id: CAISSE, name: 'Caisse comptoir', paired: true, lastSeenAt: hoursAgo(3) },
      'pos',
      5 * 60_000,
      NOW,
    );
    expect(view.online).toBe(false);
    expect(view.statusLabel).toBe('Hors ligne depuis 3 h');
  });

  it('distingue « jamais connecté » de « hors ligne »', () => {
    const view = toFleetUnit({ _id: CAISSE, paired: true, lastSeenAt: null }, 'pos', 5 * 60_000, NOW);
    expect(view.statusLabel).toBe('Jamais connecté');
  });

  it('signale un appareil révoqué au lieu de le dire simplement non appairé', () => {
    // L'équipe doit lire « on a coupé cette tablette », pas « installation en
    // cours » : ce n'est pas la même conversation avec le restaurateur.
    const view = toFleetUnit(
      { _id: CAISSE, paired: false, lastSeenAt: null, revokedAt: daysAgo(1) },
      'pos',
      5 * 60_000,
      NOW,
    );
    expect(view.statusLabel).toContain('Révoqué');
  });
});

// ─────────────────────────────────────────────────────────────
// Le service, avec des doublures de base
// ─────────────────────────────────────────────────────────────

/**
 * Doublure de la collection `orders`, réduite au seul verbe qu'emploie ce
 * service : `aggregate`. Elle MÉMORISE les pipelines reçus — c'est ce qui
 * permet de vérifier, sans base, les deux règles non négociables : jamais de
 * lecture hors du tenant demandé, jamais un champ de consommateur final.
 */
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

/**
 * Contexte supply (PostgreSQL) tel que la fiche de santé l'interroge.
 *
 * Trois lectures : les ingrédients, les fournisseurs et leurs tarifs, et le
 * COMPTAGE des mouvements de stock — ce dernier en SQL, jamais rapatrié, parce
 * que la table grossit à chaque réception et à chaque vente.
 */
function fakeSupply(over?: { throws?: boolean; movements?: number }): SupplyDb {
  if (over?.throws) {
    return {
      query: {
        ingredients: { findMany: () => Promise.reject(new Error('ECONNREFUSED 127.0.0.1:5432')) },
        suppliers: { findMany: () => Promise.reject(new Error('ECONNREFUSED 127.0.0.1:5432')) },
      },
      select: () => ({
        from: () => ({
          where: () => Promise.reject(new Error('ECONNREFUSED 127.0.0.1:5432')),
        }),
      }),
    } as unknown as SupplyDb;
  }
  const movements = over?.movements ?? 0;
  return {
    select: () => ({
      from: () => ({
        where: async () => [
          {
            total: movements,
            recent: movements,
            lastAt: movements > 0 ? hoursAgo(6) : null,
          },
        ],
      }),
    }),
    query: {
      // 107 ingrédients chez classfood, dont 4 sous le seuil de réassort.
      ingredients: {
        findMany: async () =>
          Array.from({ length: 107 }, (_, i) => ({
            id: `ing-${i}`,
            isOut: i === 0,
            currentStock: i < 4 ? '1.000' : '20.000',
            parLevel: i < 4 ? '5.000' : '10.000',
          })),
      },
      suppliers: {
        findMany: async () => [
          {
            id: 'sup-1',
            name: 'Metro Nancy',
            items: [
              {
                id: 'item-1',
                active: true,
                packPriceCents: 2_400,
                ingredient: { name: 'Viande kebab' },
                priceHistory: [{ packPriceCents: 2_000, recordedAt: daysAgo(6) }],
              },
              {
                // Hausse trop ancienne : elle n'est plus une nouvelle.
                id: 'item-2',
                active: true,
                packPriceCents: 900,
                ingredient: { name: 'Cheddar' },
                priceHistory: [{ packPriceCents: 800, recordedAt: daysAgo(80) }],
              },
            ],
          },
        ],
      },
    },
  } as unknown as SupplyDb;
}

/**
 * `BillingService`, réduit au seul verbe que la fiche de santé emploie.
 *
 * Même doublure que dans `signals.test.ts` : l'ardoise est une DONNÉE d'entrée
 * du score, sa règle de calcul est éprouvée dans `billing.test.ts`.
 */
const fakeBilling = (outstanding: CrmOutstanding = NO_OUTSTANDING): BillingService =>
  ({ outstandingFor: async () => outstanding }) as unknown as BillingService;

/** Une facture échue telle que `summarizeOutstanding` la lit. */
const overdueInvoice = (dueDaysAgo: number, cents: number) => ({
  status: 'en_retard' as const,
  dueAt: daysAgo(dueDaysAgo).toISOString(),
  dueCents: cents,
});

/** Une passe d'agrégat d'activité telle que MongoDB la rendrait. */
const activityRow = (over: Row = {}): Row => ({
  _id: CLASSFOOD,
  lastOrderAt: hoursAgo(2),
  orders7: 430,
  revenue7: 512_000,
  ordersPrev7: 410,
  revenuePrev7: 489_000,
  orders30: 1_729,
  revenue30: 2_050_000,
  ordersPrev30: 1_600,
  revenuePrev30: 1_940_000,
  posOrders30: 1_221,
  posLastAt: hoursAgo(2),
  onlineOrders30: 508,
  onlineLastAt: hoursAgo(5),
  ...over,
});

/** Sérialisation tolérante aux ObjectId et aux dates, pour inspecter un pipeline. */
const dump = (value: unknown): string =>
  JSON.stringify(value, (_k, v: unknown) => (v instanceof Date ? v.toISOString() : v));

/**
 * Champs qu'aucune requête de cette surface n'a le droit de toucher.
 *
 * Les quatre premiers appartiennent aux consommateurs du restaurateur : son
 * fichier client lui appartient, et le détenir nous rendrait responsables de sa
 * protection sans qu'aucune décision d'accompagnement ne l'exige. Les deux
 * derniers sont des secrets d'appareil, qui n'ont rien à faire dans une vue de
 * pilotage.
 */
const FORBIDDEN_FIELDS = [
  'customerName',
  'customerPhone',
  'pickup',
  'trackingToken',
  'deviceToken',
  'pairingCode',
];

describe('Fiche de santé', () => {
  let tenants: FakeCollection;
  let devices: FakeCollection;
  let screens: FakeCollection;
  let logs: FakeCollection;
  let users: FakeCollection;
  let orders: FakeOrders;

  const build = (
    results: Row[][],
    opts: { supply?: SupplyDb; billing?: BillingService } = {},
  ) => {
    orders = new FakeOrders(results);
    const admin = new AdminService(
      tenants.asModel<Tenant>(),
      devices.asModel<Device>(),
      screens.asModel<Screen>(),
      logs.asModel<AdminLog>(),
      users.asModel<User>(),
    );
    return new HealthService(
      tenants.asModel<Tenant>(),
      orders.asModel<Order>(),
      devices.asModel<Device>(),
      screens.asModel<Screen>(),
      opts.supply ?? fakeSupply(),
      admin,
      opts.billing ?? fakeBilling(),
    );
  };

  beforeEach(() => {
    tenants = new FakeCollection('tenant');
    devices = new FakeCollection('device');
    screens = new FakeCollection('screen');
    logs = new FakeCollection('log');
    users = new FakeCollection('user');

    tenants.seed({
      _id: CLASSFOOD,
      slug: 'classfood',
      name: "CLASS'FOOD",
      plan: 'complet',
      founderSeat: true,
      createdAt: new Date('2026-08-18T15:06:44.415Z'),
      account: { status: 'active', since: daysAgo(1), reason: '', suspendedAt: null },
    });
    tenants.seed({ _id: VOISIN, slug: 'voisin', name: 'Le Voisin', plan: 'essentiel' });
    users.seed({ _id: SM.sub, email: 'admin@snackmanager.fr' });
    devices.seed({
      _id: CAISSE,
      tenantId: CLASSFOOD,
      name: 'Caisse comptoir',
      kind: 'pos',
      paired: true,
      lastSeenAt: hoursAgo(0),
      createdAt: daysAgo(30),
    });
    devices.seed({
      _id: CUISINE,
      tenantId: CLASSFOOD,
      name: 'Écran cuisine',
      kind: 'kds',
      paired: true,
      lastSeenAt: hoursAgo(2),
      createdAt: daysAgo(30),
    });
  });

  it('rend l’activité 7 et 30 jours comparée à la période précédente', async () => {
    const health = await build([[activityRow()]]).tenantHealth(SM, CLASSFOOD, NOW);

    expect(health.activity.last7d.orders).toBe(430);
    expect(health.activity.last7d.previousOrders).toBe(410);
    expect(health.activity.last7d.ordersDeltaPct).toBe(4.9);
    expect(health.activity.last30d.orders).toBe(1_729);
    // Panier moyen : 512 000 c / 430 commandes.
    expect(health.activity.last7d.avgBasketCents).toBe(1_191);
    expect(health.activity.lastOrderAt).toBe(hoursAgo(2).toISOString());
    expect(health.activity.daysSinceLastOrder).toBe(0);
  });

  it('fait sauter aux yeux un client qui décroche', async () => {
    const health = await build([
      [activityRow({ orders7: 90, ordersPrev7: 410, lastOrderAt: daysAgo(3), revenue7: 98_000 })],
    ]).tenantHealth(SM, CLASSFOOD, NOW);

    expect(health.activity.last7d.ordersDeltaPct).toBe(-78);
    // La moyenne pondérée reste flatteuse (tablettes en ligne, facture réglée),
    // mais le verdict est plafonné par l'activité : c'est précisément ce client
    // qu'on ne doit pas classer « correct » et oublier de rappeler.
    expect(health.score.value).toBeGreaterThan(60);
    expect(health.score.verdict).toBe('fragile');
    expect(health.score.cappedBy).toBe('activite');
  });

  it('explique la composition du score, axe par axe', async () => {
    // Un score que personne ne comprend ne sert à rien : chaque axe sort avec
    // son poids, sa note et la phrase qui la justifie.
    const health = await build([[activityRow()]]).tenantHealth(SM, CLASSFOOD, NOW);

    expect(health.score.axes.map((a) => a.key)).toEqual([
      'activite',
      'adoption',
      'technique',
      'paiement',
    ]);
    for (const a of health.score.axes) {
      expect(a.detail, a.key).toMatch(/\S/);
      expect(a.weight, a.key).toBe(HEALTH_AXIS_WEIGHTS[a.key]);
    }
    expect(health.score.verdictLabel).toMatch(/\S/);
  });

  it('rend l’adoption des cinq modules, suivi des stocks compris', async () => {
    // Le cinquième vient du contexte appro, et il n'apparaît que si celui-ci a
    // répondu : c'est ce module-là que la file de signaux savait nommer alors
    // que la fiche l'ignorait.
    const health = await build([[activityRow()]]).tenantHealth(SM, CLASSFOOD, NOW);

    expect(health.modules.map((m) => m.key)).toEqual([
      'caisse',
      'cuisine',
      'commande_en_ligne',
      'ecrans_salle',
      'stocks',
    ]);
    expect(health.modules.find((m) => m.key === 'caisse')?.used).toBe(true);
    expect(health.modules.find((m) => m.key === 'ecrans_salle')?.provisioned).toBe(false);
    // 107 ingrédients, un fournisseur, aucun mouvement : ouvert et dormant.
    expect(health.modules.find((m) => m.key === 'stocks')).toMatchObject({
      provisioned: true,
      used: false,
    });
  });

  it('retire le module stocks quand l’appro n’a pas répondu, au lieu de l’inventer', async () => {
    const health = await build([[activityRow()]], {
      supply: fakeSupply({ throws: true }),
    }).tenantHealth(SM, CLASSFOOD, NOW);

    expect(health.modules.map((m) => m.key)).not.toContain('stocks');
  });

  it('branche l’axe paiement sur l’ardoise réelle, pas sur le statut de compte', async () => {
    // LA DETTE QUE CET AXE PORTAIT : il relisait `account.status`, c'est-à-dire
    // la CONSÉQUENCE d'un impayé et jamais sa cause. Un client qui devait trois
    // mois mais qu'on n'avait pas encore suspendu ressortait « Abonnement à
    // jour », 100/100 — et la suspension qui finissait par tomber paraissait
    // arbitraire, puisque rien sur la fiche ne l'avait annoncée.
    const ardoise = summarizeOutstanding(
      [overdueInvoice(45, 13_900), overdueInvoice(15, 13_900)] as never,
      NOW,
    );
    const health = await build([[activityRow()]], {
      billing: fakeBilling(ardoise),
    }).tenantHealth(SM, CLASSFOOD, NOW);

    const paiement = health.score.axes.find((a) => a.key === 'paiement');
    expect(paiement?.score).toBe(20);
    expect(paiement?.detail).toContain('2 factures en retard');
    expect(paiement?.detail).toContain('45 jour(s)');
  });

  it('dit « à jour » quand le client ne doit rien — et le dit sur des chiffres', async () => {
    const health = await build([[activityRow()]]).tenantHealth(SM, CLASSFOOD, NOW);
    const paiement = health.score.axes.find((a) => a.key === 'paiement');

    expect(paiement?.score).toBe(100);
    expect(paiement?.detail).toBe('Abonnement à jour.');
  });

  it('rend le parc avec l’état en ligne et le dernier contact', async () => {
    const health = await build([[activityRow()]]).tenantHealth(SM, CLASSFOOD, NOW);

    expect(health.fleet.total).toBe(2);
    expect(health.fleet.units.map((u) => u.name)).toEqual(['Caisse comptoir', 'Écran cuisine']);
    expect(health.fleet.units[0]?.online).toBe(true);
    expect(health.fleet.units[1]?.lastSeenAt).toBe(hoursAgo(2).toISOString());
  });

  it('rend l’approvisionnement : sous seuil, ruptures, hausses récentes', async () => {
    const health = await build([[activityRow()]]).tenantHealth(SM, CLASSFOOD, NOW);

    expect(health.supply.available).toBe(true);
    expect(health.supply.belowPar).toBe(4);
    expect(health.supply.ruptures).toBe(1);
    // Une seule hausse dans les 30 jours : celle d'il y a 80 jours n'est plus
    // une nouvelle.
    expect(health.supply.priceIncreases30d).toBe(1);
    expect(health.supply.topPriceIncreases[0]?.ingredientName).toBe('Viande kebab');
    expect(health.supply.topPriceIncreases[0]?.increasePct).toBe(20);
    // Le registre lui-même : c'est lui qui dit si le module « stocks » est
    // monté, et s'il vit.
    expect(health.supply.ingredients).toBe(107);
    expect(health.supply.suppliers).toBe(1);
    expect(health.supply.movements).toBe(0);
  });

  it('sert la fiche même si le contexte appro est injoignable', async () => {
    // Une panne PostgreSQL ne doit pas emporter l'activité, le score et le parc.
    const health = await build([[activityRow()]], {
      supply: fakeSupply({ throws: true }),
    }).tenantHealth(SM, CLASSFOOD, NOW);

    expect(health.supply.available).toBe(false);
    expect(health.activity.last30d.orders).toBe(1_729);
    expect(health.score.value).toBeGreaterThan(0);
  });

  it('journalise la consultation du dossier', async () => {
    // Ouvrir le dossier d'un client est un accès à ses données, pas un geste
    // neutre — c'est la contrepartie assumée d'un outil qui voit tout le parc.
    await build([[activityRow()]]).tenantHealth(SM, CLASSFOOD, NOW);

    const entry = logs.rows.at(-1);
    expect(entry?.action).toBe('tenant.detail_view');
    expect(String(entry?.tenantId)).toBe(CLASSFOOD);
    expect(entry?.actorEmail).toBe('admin@snackmanager.fr');
  });

  it('rend 404 sur un établissement inconnu ou un identifiant mal formé', async () => {
    await expect(build([]).tenantHealth(SM, 'pas-un-objectid', NOW)).rejects.toThrow(
      'Établissement introuvable',
    );
    await expect(
      build([]).tenantHealth(SM, '65f0000000000000000000ff', NOW),
    ).rejects.toThrow('Établissement introuvable');
  });

  it('ne lit jamais hors du restaurant demandé', async () => {
    // CLOISONNEMENT : la fiche d'un client ne doit pas pouvoir mélanger deux
    // restaurants, même sur un identifiant deviné.
    await build([[activityRow()]]).tenantHealth(SM, CLASSFOOD, NOW);

    for (const pipeline of orders.pipelines) {
      const match = (pipeline[0] as { $match?: Record<string, unknown> }).$match;
      expect(match?.tenantId).toBeDefined();
      expect(String(match?.tenantId)).toBe(CLASSFOOD);
    }
  });

  it('ne demande à MongoDB aucun champ de consommateur final', async () => {
    // RESPECT DES CLIENTS DE NOS CLIENTS : la règle se vérifie sur les
    // requêtes elles-mêmes, pas seulement sur ce qu'on choisit d'afficher.
    const health = await build([[activityRow()]]).tenantHealth(SM, CLASSFOOD, NOW);
    const seen = [...orders.pipelines.map(dump), dump(health)].join(' ');

    for (const field of FORBIDDEN_FIELDS) {
      expect(seen, field).not.toContain(field);
    }
  });
});
