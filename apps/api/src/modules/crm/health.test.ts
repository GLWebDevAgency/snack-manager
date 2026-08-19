import { beforeEach, describe, expect, it } from 'vitest';
import { CLIENT_RISK_DAYS, type JwtPayload } from '@sm/contracts';
import type { AdminLog, Device, Order, Screen, Tenant, User } from '@sm/db';
import type { SupplyDb } from '@sm/supply';
import { AdminService } from './admin.service';
import { FakeCollection, type Row } from './admin.fakes';
import {
  ACTIVITY_DROP_MIN_ORDERS,
  DEVICE_SILENT_AFTER_MS,
  HEALTH_AXIS_WEIGHTS,
  HealthService,
  buildFleet,
  buildModules,
  buildSignalsFor,
  compositeScore,
  deltaPct,
  scoreActivite,
  scoreAdoption,
  scorePaiement,
  scoreTechnique,
  sortSignals,
  toFleetUnit,
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

describe('Axe paiement', () => {
  it('met à zéro le seul statut qui coupe l’accès', () => {
    expect(scorePaiement('suspended').score).toBe(0);
  });

  it('ne pénalise pas une période d’essai', () => {
    // On ne facture pas encore : il n'y a rien à reprocher.
    expect(scorePaiement('trial').score).toBe(100);
    expect(scorePaiement('active').score).toBe(100);
  });

  it('traite un départ autrement qu’un impayé', () => {
    // « churned » n'est pas un litige, c'est une fin de relation.
    expect(scorePaiement('churned').score).toBe(50);
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
// La file de travail
// ─────────────────────────────────────────────────────────────

describe('File de travail', () => {
  const client = (over: Partial<Parameters<typeof buildSignalsFor>[0]> = {}) => ({
    tenantId: CLASSFOOD,
    tenantName: "CLASS'FOOD",
    accountStatus: 'active' as const,
    suspendedAt: null,
    since: daysAgo(90),
    lastOrderAt: hoursAgo(2),
    orders7d: 430,
    previousOrders7d: 410,
    fleet: [unit()],
    modules: buildModules({
      posOrders: 1_729,
      posLastOrderAt: hoursAgo(2),
      onlineOrders: 508,
      onlineLastOrderAt: hoursAgo(5),
      posDevices: [unit()],
      kdsDevices: [],
      screens: [],
    }),
    ...over,
  });

  it('laisse tranquille un client qui tourne', () => {
    expect(buildSignalsFor(client(), NOW)).toEqual([]);
  });

  it('remonte un impayé en tête de file', () => {
    const signals = buildSignalsFor(
      client({ accountStatus: 'suspended', suspendedAt: daysAgo(3) }),
      NOW,
    );
    expect(signals[0]?.kind).toBe('impaye');
    expect(signals[0]?.value).toBe(3);
  });

  it('signale une caisse muette depuis plus de 24 h', () => {
    const signals = buildSignalsFor(
      client({ fleet: [unit({ online: false, lastSeenAt: hoursAgo(30).toISOString() })] }),
      NOW,
    );
    const mute = signals.find((s) => s.kind === 'appareil_muet');
    expect(mute?.value).toBe(30);
    expect(mute?.detail).toContain('Caisse comptoir');
  });

  it('ne signale pas une caisse hors ligne depuis vingt minutes', () => {
    // Le back-office du gérant l'affiche déjà « hors ligne » ; nous, ce qu'on
    // cherche, c'est la panne que le restaurant ne nous a pas signalée.
    const signals = buildSignalsFor(
      client({
        fleet: [
          unit({
            online: false,
            lastSeenAt: new Date(NOW.getTime() - DEVICE_SILENT_AFTER_MS + 60_000).toISOString(),
          }),
        ],
      }),
      NOW,
    );
    expect(signals.some((s) => s.kind === 'appareil_muet')).toBe(false);
  });

  it('signale une chute d’activité nette', () => {
    const signals = buildSignalsFor(client({ orders7d: 120, previousOrders7d: 400 }), NOW);
    const drop = signals.find((s) => s.kind === 'chute_activite');
    expect(drop?.value).toBe(70);
  });

  it('ne crie pas au loup sur un petit volume', () => {
    // 3 commandes contre 4 la semaine d'avant, c'est la météo — pas un
    // décrochage. Une file pleine de faux positifs ne se lit plus.
    const signals = buildSignalsFor(
      client({ orders7d: 1, previousOrders7d: ACTIVITY_DROP_MIN_ORDERS - 1 }),
      NOW,
    );
    expect(signals.some((s) => s.kind === 'chute_activite')).toBe(false);
  });

  it('remplace la chute par un arrêt franc quand plus rien ne rentre', () => {
    // Deux lignes pour le même client diraient deux fois la même chose.
    const signals = buildSignalsFor(
      client({ lastOrderAt: daysAgo(11), orders7d: 0, previousOrders7d: 400 }),
      NOW,
    );
    expect(signals.map((s) => s.kind)).toContain('arret_activite');
    expect(signals.some((s) => s.kind === 'chute_activite')).toBe(false);
  });

  it('distingue « jamais démarré » de « plus aucune commande »', () => {
    // Dire « aucune commande depuis 40 jours » à un restaurant qui n'en a
    // jamais passé une seule, c'est parler de décrochage à quelqu'un qui n'a
    // jamais commencé : c'est un appel d'onboarding, pas de rétention.
    const signals = buildSignalsFor(
      client({ lastOrderAt: null, since: daysAgo(40), orders7d: 0, previousOrders7d: 0 }),
      NOW,
    );
    const stop = signals.find((s) => s.kind === 'arret_activite');
    expect(stop?.title).toBe('Jamais démarré');
    expect(stop?.value).toBe(40);
    expect(stop?.detail).toContain('l’installation n’a jamais abouti');
  });

  it('laisse s’installer un restaurant qui vient d’arriver', () => {
    // Signé il y a deux jours, pas encore de commande : c'est normal, et une
    // file de travail qui crie dessus n'est plus une file de travail.
    const signals = buildSignalsFor(
      client({ lastOrderAt: null, since: daysAgo(2), orders7d: 0, previousOrders7d: 0 }),
      NOW,
    );
    expect(signals.some((s) => s.kind === 'arret_activite')).toBe(false);
  });

  it('signale un module ouvert et jamais utilisé', () => {
    const signals = buildSignalsFor(
      client({
        modules: buildModules({
          posOrders: 1_729,
          posLastOrderAt: hoursAgo(2),
          onlineOrders: 0,
          onlineLastOrderAt: null,
          posDevices: [unit()],
          kdsDevices: [],
          screens: [],
        }),
      }),
      NOW,
    );
    const idle = signals.find((s) => s.kind === 'module_inutilise');
    expect(idle?.title).toContain('Commande en ligne');
  });

  it('trie par gravité : l’impayé avant la caisse muette, la caisse avant la chute', () => {
    const signals = sortSignals([
      ...buildSignalsFor(client({ orders7d: 100, previousOrders7d: 400 }), NOW),
      ...buildSignalsFor(
        client({
          tenantId: VOISIN,
          tenantName: 'Le Voisin',
          fleet: [unit({ online: false, lastSeenAt: hoursAgo(48).toISOString() })],
        }),
        NOW,
      ),
      ...buildSignalsFor(
        client({ accountStatus: 'suspended', suspendedAt: daysAgo(1), tenantName: 'Impayé' }),
        NOW,
      ),
    ]);
    expect(signals.map((s) => s.kind).slice(0, 3)).toEqual([
      'impaye',
      'appareil_muet',
      'chute_activite',
    ]);
  });

  it('classe deux chutes par ampleur décroissante', () => {
    const signals = sortSignals([
      ...buildSignalsFor(client({ orders7d: 280, previousOrders7d: 400 }), NOW),
      ...buildSignalsFor(
        client({ tenantId: VOISIN, tenantName: 'Le Voisin', orders7d: 40, previousOrders7d: 400 }),
        NOW,
      ),
    ]);
    expect(signals[0]?.tenantName).toBe('Le Voisin');
    expect(signals[0]?.value).toBe(90);
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

/** Contexte supply (PostgreSQL) tel que la fiche de santé l'interroge. */
function fakeSupply(over?: { throws?: boolean }): SupplyDb {
  if (over?.throws) {
    return {
      query: {
        ingredients: { findMany: () => Promise.reject(new Error('ECONNREFUSED 127.0.0.1:5432')) },
        suppliers: { findMany: () => Promise.reject(new Error('ECONNREFUSED 127.0.0.1:5432')) },
      },
    } as unknown as SupplyDb;
  }
  return {
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

  const build = (results: Row[][], supply = fakeSupply()) => {
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
      supply,
      admin,
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

  it('rend l’adoption des quatre modules du produit', async () => {
    const health = await build([[activityRow()]]).tenantHealth(SM, CLASSFOOD, NOW);

    expect(health.modules.map((m) => m.key)).toEqual([
      'caisse',
      'cuisine',
      'commande_en_ligne',
      'ecrans_salle',
    ]);
    expect(health.modules.find((m) => m.key === 'caisse')?.used).toBe(true);
    expect(health.modules.find((m) => m.key === 'ecrans_salle')?.provisioned).toBe(false);
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
  });

  it('sert la fiche même si le contexte appro est injoignable', async () => {
    // Une panne PostgreSQL ne doit pas emporter l'activité, le score et le parc.
    const health = await build([[activityRow()]], fakeSupply({ throws: true })).tenantHealth(
      SM,
      CLASSFOOD,
      NOW,
    );

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

describe('File de travail du parc', () => {
  let tenants: FakeCollection;
  let devices: FakeCollection;
  let screens: FakeCollection;
  let logs: FakeCollection;
  let users: FakeCollection;
  let orders: FakeOrders;

  const build = (results: Row[][]) => {
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
      fakeSupply(),
      admin,
    );
  };

  beforeEach(() => {
    tenants = new FakeCollection('tenant');
    devices = new FakeCollection('device');
    screens = new FakeCollection('screen');
    logs = new FakeCollection('log');
    users = new FakeCollection('user');
    users.seed({ _id: SM.sub, email: 'admin@snackmanager.fr' });
  });

  it('classe le parc entier par gravité, tous clients confondus', async () => {
    tenants.seed({
      _id: CLASSFOOD,
      name: "CLASS'FOOD",
      slug: 'classfood',
      account: { status: 'active', since: daysAgo(1), reason: '', suspendedAt: null },
    });
    tenants.seed({
      _id: VOISIN,
      name: 'Le Voisin',
      slug: 'voisin',
      account: { status: 'suspended', since: daysAgo(2), reason: 'Impayé', suspendedAt: daysAgo(2) },
    });
    devices.seed({
      _id: CAISSE,
      tenantId: CLASSFOOD,
      name: 'Caisse comptoir',
      kind: 'pos',
      paired: true,
      lastSeenAt: hoursAgo(40),
    });

    const signals = await build([
      [
        activityRow(),
        activityRow({ _id: VOISIN, orders7: 12, ordersPrev7: 140, onlineOrders30: 0, onlineLastAt: null }),
      ],
    ]).signals(NOW);

    expect(signals[0]?.kind).toBe('impaye');
    expect(signals[0]?.tenantName).toBe('Le Voisin');
    expect(signals.map((s) => s.kind)).toContain('appareil_muet');
    expect(signals.every((s, i) => i === 0 || s.gravity <= (signals[i - 1]?.gravity ?? 0))).toBe(
      true,
    );
  });

  it('n’oublie pas un client qui n’a jamais rien encaissé', async () => {
    // Aucune ligne dans l'agrégat : sans repli, le restaurant disparaîtrait de
    // la file — or c'est exactement celui qu'il faut rappeler.
    tenants.seed({
      _id: VOISIN,
      name: 'Le Voisin',
      slug: 'voisin',
      createdAt: daysAgo(40),
      account: { status: 'active', since: daysAgo(40), reason: '', suspendedAt: null },
    });
    devices.seed({
      _id: 'device-neuf',
      tenantId: VOISIN,
      name: 'Caisse comptoir',
      kind: 'pos',
      paired: true,
      lastSeenAt: null,
    });

    const signals = await build([[]]).signals(NOW);

    expect(signals.map((s) => s.title)).toContain('Jamais démarré');
    expect(signals.map((s) => s.kind)).toContain('appareil_muet');
    expect(signals.map((s) => s.kind)).toContain('module_inutilise');
  });

  it('ne journalise pas la file de travail', async () => {
    // Cette vue n'ouvre le dossier de personne : elle ne rend que des agrégats
    // et des états de compte. La trace est écrite au clic sur une ligne.
    tenants.seed({ _id: CLASSFOOD, name: "CLASS'FOOD", slug: 'classfood' });
    await build([[activityRow()]]).signals(NOW);

    expect(logs.size).toBe(0);
  });

  it('ne demande à MongoDB aucun champ de consommateur final', async () => {
    tenants.seed({ _id: CLASSFOOD, name: "CLASS'FOOD", slug: 'classfood' });
    const signals = await build([[activityRow()]]).signals(NOW);
    const seen = [...orders.pipelines.map(dump), dump(signals)].join(' ');

    for (const field of FORBIDDEN_FIELDS) {
      expect(seen, field).not.toContain(field);
    }
  });
});
