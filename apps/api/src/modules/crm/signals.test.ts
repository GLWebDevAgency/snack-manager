import { beforeEach, describe, expect, it } from 'vitest';
import {
  NO_OUTSTANDING,
  statutEffectif,
  summarizeOutstanding,
  type CrmOutstanding,
} from '@sm/contracts';
import type { Device, Order, Screen, SignalDismissal, Tenant } from '@sm/db';
import type { SupplyDb } from '@sm/supply';
import { FakeCollection, type Row } from './admin.fakes';
import type { BillingService } from './billing.service';
import {
  buildModules,
  eurosLabel,
  type CrmFleetUnit,
  type CrmModuleAdoption,
} from './health.service';
import {
  ACTIVITY_DROP_CRITICAL_PCT,
  DEVICE_MUTE_MIN_MS,
  MUTED_CRITICAL_ORDERS,
  SUPPLY_OUT_MIN,
  SUPPLY_SETUP_MIN_INGREDIENTS,
  SignalsService,
  TRIAL_DAYS,
  TRIAL_WARNING_DAYS,
  activityPipeline,
  mutedUnits,
  signalsForClient,
  sortQueue,
  stocksModule,
  unitLabel,
  type CrmQueueSignal,
  type SignalClient,
  type SupplySnapshot,
} from './signals.service';

/**
 * LA FILE DE SIGNAUX — jeu d'essai calqué sur le parc réel.
 *
 * Le tenant `classfood` tel qu'il est en base au moment où ce test est écrit :
 * une caisse et un écran cuisine appairés, aucun écran de salle, ≈ 1 200
 * commandes en caisse et ≈ 500 en ligne sur 30 jours, 107 ingrédients suivis
 * chez 3 fournisseurs, et pas un seul mouvement de stock enregistré.
 *
 * Les seuils sont éprouvés sur ces ordres de grandeur-là, pas sur des chiffres
 * ronds choisis pour passer — un seuil calibré sur « 100 commandes » ne dit
 * rien de ce qui se produira sur un parc qui en fait 443.
 *
 * DEUX CHOSES SONT VÉRIFIÉES PARTOUT, parce que ce sont les deux qui coûtent
 * cher si elles cèdent :
 *  · le SILENCE — aucun signal quand la donnée ne le justifie pas ;
 *  · le CHIFFRE — chaque phrase rendue contient le nombre qui la fonde.
 */

const CLASSFOOD = '6a847504c4a551ed35c65ba9';
const VOISIN = '65f000000000000000000002';
const CAISSE = '6a85aa88d1a25cf38af91847';
const CUISINE = '6a85ab3dd1a25cf38af91874';

const NOW = new Date('2026-08-19T16:34:00.000Z');
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const hoursAgo = (n: number) => new Date(NOW.getTime() - n * HOUR_MS);
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY_MS);

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

/** L'écran cuisine de Class'Food : muet depuis la fin du service de midi. */
const kdsMuet = (hours = 3) =>
  unit({
    id: CUISINE,
    name: 'Écran cuisine',
    kind: 'kds',
    kindLabel: 'Écran cuisine',
    online: false,
    lastSeenAt: hoursAgo(hours).toISOString(),
    statusLabel: `Hors ligne depuis ${hours} h`,
  });

const supplySnapshot = (over: Partial<SupplySnapshot> = {}): SupplySnapshot => ({
  ingredients: 107,
  suppliers: 3,
  out: 0,
  starved: 1,
  belowPar: 4,
  movements: 0,
  movements30d: 0,
  lastMovementAt: null,
  ...over,
});

/** Les quatre modules tels que `buildModules` les rend pour Class'Food. */
const classfoodModules = (): CrmModuleAdoption[] =>
  buildModules({
    posOrders: 1_235,
    posLastOrderAt: hoursAgo(3),
    onlineOrders: 512,
    onlineLastOrderAt: hoursAgo(3),
    posDevices: [unit()],
    kdsDevices: [kdsMuet()],
    screens: [],
  });

const client = (over: Partial<SignalClient> = {}): SignalClient => ({
  tenantId: CLASSFOOD,
  tenantName: "CLASS'FOOD",
  tenantSlug: 'classfood',
  plan: 'complet',
  accountStatus: 'active',
  accountSince: daysAgo(1),
  trialEndsAt: null,
  suspendedAt: null,
  since: daysAgo(1),
  activity: {
    // 13 h 31 sur le parc réel, soit deux minutes APRÈS le dernier battement de
    // cœur de l'écran cuisine : c'est cet écart qui prouve que le restaurant
    // travaillait pendant que l'écran se taisait.
    lastOrderAt: hoursAgo(2.9),
    orders7d: 443,
    previousOrders7d: 493,
    revenue7Cents: 887_470,
    previousRevenue7Cents: 1_055_210,
    orders30d: 2_061,
  },
  fleet: [unit(), kdsMuet()],
  ordersSinceSilent: new Map([[CUISINE, 1]]),
  modules: classfoodModules(),
  outstanding: NO_OUTSTANDING,
  supply: supplySnapshot(),
  ...over,
});

const kindsOf = (signals: readonly CrmQueueSignal[]) => signals.map((s) => s.kind);
const only = (signals: readonly CrmQueueSignal[], kind: string) =>
  signals.filter((s) => s.kind === kind);

// ─────────────────────────────────────────────────────────────
// Le parc réel, tel qu'il est
// ─────────────────────────────────────────────────────────────

describe('Le parc réel (Class’Food, client en bonne santé)', () => {
  it('ne sort que ce qui mérite vraiment un geste', () => {
    // Un client solide : il encaisse tous les jours, il paie, ses modules
    // tournent. La file doit rester COURTE — deux lignes, et deux seulement.
    const signals = signalsForClient(client(), NOW);
    expect(kindsOf(signals).sort()).toEqual(['appareil_muet', 'module_dormant']);
  });

  it('signale l’écran cuisine muet avec le nombre de commandes passées depuis', () => {
    const [muet] = only(signalsForClient(client(), NOW), 'appareil_muet');
    expect(muet?.title).toBe('Écran cuisine muet');
    // Le chiffre qui change la conversation : « hors ligne » le gérant le voit
    // déjà, « une commande est passée depuis » non.
    expect(muet?.detail).toContain('3 h');
    expect(muet?.detail).toContain('1 commande');
    expect(muet?.value).toBe(3);
    expect(muet?.since).toBe(hoursAgo(3).toISOString());
    expect(muet?.href).toBe(`/sm/clients/${CLASSFOOD}`);
  });

  it('signale le suivi des stocks configuré et jamais alimenté', () => {
    const [dormant] = only(signalsForClient(client(), NOW), 'module_dormant');
    expect(dormant?.title).toBe('Module ouvert jamais utilisé — Suivi des stocks');
    expect(dormant?.detail).toContain('107 ingrédients');
    expect(dormant?.detail).toContain('3 fournisseurs');
    expect(dormant?.detail).toContain('aucun mouvement de stock');
    // Client facturé : la ligne se perd au renouvellement, on appelle cette
    // semaine — pas « pour information ».
    expect(dormant?.severity).toBe('attention');
  });

  it('ne réclame RIEN sur ce qui va bien', () => {
    const signals = signalsForClient(client(), NOW);
    // −10,1 % sur 7 j, une ardoise à jour, 0 rupture, un compte actif : quatre
    // occasions de crier au loup, quatre silences.
    expect(only(signals, 'chute_activite')).toHaveLength(0);
    expect(only(signals, 'impaye')).toHaveLength(0);
    expect(only(signals, 'rupture_appro')).toHaveLength(0);
    expect(only(signals, 'compte_suspendu')).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────
// Chute d'activité
// ─────────────────────────────────────────────────────────────

describe('Chute d’activité', () => {
  const withActivity = (orders7d: number, previousOrders7d: number, revenue = 500_000) =>
    signalsForClient(
      client({
        activity: {
          lastOrderAt: hoursAgo(2.9),
          orders7d,
          previousOrders7d,
          revenue7Cents: revenue,
          previousRevenue7Cents: 1_000_000,
          orders30d: 1_200,
        },
      }),
      NOW,
    );

  it('se tait sur une baisse ordinaire', () => {
    // −10 % un mois d'août, c'est la météo ou les congés du quartier. Appeler
    // pour ça use le crédit dont on aura besoin pour un vrai décrochage.
    expect(only(withActivity(443, 493), 'chute_activite')).toHaveLength(0);
  });

  it('sort au-delà de −30 %, avec les deux comptages et les euros perdus', () => {
    const [chute] = only(withActivity(300, 493), 'chute_activite');
    expect(chute).toBeDefined();
    expect(chute?.detail).toContain('300 commandes');
    expect(chute?.detail).toContain('493');
    expect(chute?.detail).toContain('-39,1 %');
    // Le manque à gagner de la semaine, en euros : c'est lui qu'on dit au gérant.
    expect(chute?.detail).toContain(eurosLabel(500_000));
    expect(chute?.severity).toBe('attention');
  });

  it('passe en critique quand l’activité est divisée par plus de deux', () => {
    const [chute] = only(withActivity(100, 493), 'chute_activite');
    expect(chute?.severity).toBe('critique');
    expect(chute?.value).toBeGreaterThanOrEqual(ACTIVITY_DROP_CRITICAL_PCT);
  });

  it('ignore une chute calculée sur trois commandes', () => {
    // Passer de 4 à 1 commande n'est pas « −75 % », c'est du bruit : le
    // pourcentage n'a de sens que sur un volume qui en a.
    expect(only(withActivity(1, 4), 'chute_activite')).toHaveLength(0);
  });

  it('cède la place à l’arrêt total, jamais les deux à la fois', () => {
    // « Aucune commande depuis 12 j » et « −80 % cette semaine » décrivent le
    // même client : deux lignes pour un seul appel, c'est une file qu'on
    // n'ouvre plus.
    const signals = signalsForClient(
      client({ activity: { ...client().activity, lastOrderAt: daysAgo(12), orders7d: 0 } }),
      NOW,
    );
    expect(only(signals, 'arret_activite')).toHaveLength(1);
    expect(only(signals, 'chute_activite')).toHaveLength(0);
    expect(only(signals, 'arret_activite')[0]?.detail).toContain('12 j');
  });

  it('distingue « jamais démarré » de « il a arrêté »', () => {
    // Parler de décrochage à quelqu'un qui n'a jamais encaissé, c'est perdre
    // l'appel d'onboarding le plus rentable du parc.
    const [jamais] = only(
      signalsForClient(
        client({
          since: daysAgo(21),
          activity: { ...client().activity, lastOrderAt: null, orders7d: 0, orders30d: 0 },
        }),
        NOW,
      ),
      'arret_activite',
    );
    expect(jamais?.title).toBe('Jamais démarré');
    expect(jamais?.detail).toContain('21 j');
  });

  it('laisse un restaurant signé la veille tranquille', () => {
    const signals = signalsForClient(
      client({
        since: daysAgo(2),
        activity: { ...client().activity, lastOrderAt: null, orders7d: 0, orders30d: 0 },
      }),
      NOW,
    );
    expect(only(signals, 'arret_activite')).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────
// Appareils muets
// ─────────────────────────────────────────────────────────────

describe('Appareil muet', () => {
  it('ne dit rien d’un parc éteint la nuit', () => {
    // TOUTES les tablettes du parc se taisent chaque nuit. Sans la seconde
    // condition — des commandes passées PENDANT le silence —, la file
    // hurlerait à 3 h du matin sur le parc entier, tous les jours.
    const retenus = mutedUnits([kdsMuet(6), unit({ lastSeenAt: hoursAgo(6).toISOString() })], hoursAgo(7), NOW);
    expect(retenus).toHaveLength(0);
  });

  it('retient l’appareil qui s’est tu pendant que le restaurant travaillait', () => {
    const retenus = mutedUnits([kdsMuet(3)], hoursAgo(2), NOW);
    expect(retenus).toHaveLength(1);
    expect(retenus[0]?.longSilence).toBe(false);
  });

  it('retient au-delà de 24 h même sans commande depuis', () => {
    // À ce stade, l'absence d'activité n'excuse plus rien : l'appareil est cassé.
    const retenus = mutedUnits([kdsMuet(30)], daysAgo(3), NOW);
    expect(retenus).toHaveLength(1);
    expect(retenus[0]?.longSilence).toBe(true);
  });

  it('laisse un silence de quelques minutes tranquille', () => {
    // Un wifi qui hoquette n'est pas une panne. Le seuil bas existe pour ça.
    const bref = DEVICE_MUTE_MIN_MS / 2 / HOUR_MS;
    expect(mutedUnits([kdsMuet(bref)], NOW, NOW)).toHaveLength(0);
  });

  it('ignore un appareil pas encore appairé', () => {
    // Il n'est pas en panne, il n'est pas encore installé.
    expect(mutedUnits([{ ...kdsMuet(48), paired: false }], NOW, NOW)).toHaveLength(0);
  });

  it('signale un appareil appairé jamais connecté', () => {
    const jamais = mutedUnits([unit({ lastSeenAt: null, online: false })], null, NOW);
    expect(jamais).toHaveLength(1);
    const [signal] = only(
      signalsForClient(client({ fleet: [unit({ lastSeenAt: null, online: false })] }), NOW),
      'appareil_muet',
    );
    expect(signal?.title).toContain('jamais connecté');
    expect(signal?.since).toBeNull();
  });

  it('traite une CAISSE muette en critique, quelle que soit la durée', () => {
    // Une caisse morte coûte à la minute : le comptoir n'encaisse plus.
    const [signal] = only(
      signalsForClient(
        client({
          fleet: [unit({ online: false, lastSeenAt: hoursAgo(4).toISOString() })],
          ordersSinceSilent: new Map([[CAISSE, 3]]),
        }),
        NOW,
      ),
      'appareil_muet',
    );
    expect(signal?.severity).toBe('critique');
  });

  it('fait passer un écran cuisine en critique quand assez de commandes lui échappent', () => {
    const [signal] = only(
      signalsForClient(client({ ordersSinceSilent: new Map([[CUISINE, MUTED_CRITICAL_ORDERS]]) }), NOW),
      'appareil_muet',
    );
    expect(signal?.severity).toBe('critique');
    expect(signal?.detail).toContain(`${MUTED_CRITICAL_ORDERS} commandes`);
  });

  it('ne bégaie pas quand l’appareil porte le nom de son type', () => {
    expect(unitLabel(kdsMuet())).toBe('Écran cuisine');
    expect(unitLabel(unit())).toBe('Caisse « Caisse comptoir »');
  });
});

// ─────────────────────────────────────────────────────────────
// Impayés
// ─────────────────────────────────────────────────────────────

describe('Impayé', () => {
  const withDue = (over: Partial<CrmOutstanding>) =>
    signalsForClient(client({ outstanding: { ...NO_OUTSTANDING, ...over } }), NOW);

  it('reste muet sur une facture envoyée mais pas encore échue', () => {
    // 139 € dus au 1er du mois prochain, ce n'est pas une créance, c'est un
    // encaissement à venir. Les mêler ferait décrocher le téléphone pour rien.
    const signals = withDue({ totalDueCents: 13_900, totalDueLabel: '139,00 €', invoices: 1 });
    expect(only(signals, 'impaye')).toHaveLength(0);
  });

  it('chiffre la créance et son ancienneté', () => {
    const [impaye] = only(
      withDue({
        overdueInvoices: 2,
        overdueCents: 27_800,
        overdueLabel: '278,00 €',
        oldestOverdueAt: daysAgo(9).toISOString(),
        oldestOverdueDays: 9,
      }),
      'impaye',
    );
    expect(impaye?.title).toBe('Impayé — 278,00 €');
    expect(impaye?.detail).toContain('2 factures');
    expect(impaye?.detail).toContain('9 j');
    expect(impaye?.severity).toBe('attention');
    expect(impaye?.action).toContain('Relance amiable');
  });

  it('durcit le ton avec l’ancienneté', () => {
    const [impaye] = only(
      withDue({
        overdueInvoices: 1,
        overdueCents: 13_900,
        overdueLabel: '139,00 €',
        oldestOverdueAt: daysAgo(41).toISOString(),
        oldestOverdueDays: 41,
      }),
      'impaye',
    );
    expect(impaye?.severity).toBe('critique');
    expect(impaye?.action).toContain('Mise en demeure');
  });

  it('disparaît quand la facturation est injoignable, sans rien inventer', () => {
    // Une file amputée reste utile. Une créance devinée ne l'est jamais.
    const signals = signalsForClient(client({ outstanding: null }), NOW);
    expect(only(signals, 'impaye')).toHaveLength(0);
    expect(only(signals, 'appareil_muet')).toHaveLength(1);
  });

  it('lit la même règle que la file de recouvrement', () => {
    // `summarizeOutstanding` est la fonction partagée : la file de signaux et
    // `/crm/billing/overdue` ne peuvent pas annoncer deux montants différents.
    const invoice = {
      dueCents: 13_900,
      status: 'en_retard' as const,
      dueAt: daysAgo(20).toISOString(),
    };
    const summary = summarizeOutstanding(
      [invoice as unknown as Parameters<typeof summarizeOutstanding>[0][number]],
      NOW,
    );
    const [impaye] = only(signalsForClient(client({ outstanding: summary }), NOW), 'impaye');
    expect(impaye?.detail).toContain(summary.overdueLabel);
    expect(impaye?.value).toBe(20);
  });
});

// ─────────────────────────────────────────────────────────────
// Compte suspendu
// ─────────────────────────────────────────────────────────────

describe('Compte suspendu', () => {
  it('passe devant tout le reste', () => {
    const signals = sortQueue(
      signalsForClient(
        client({ accountStatus: 'suspended', suspendedAt: daysAgo(4), accountSince: daysAgo(4) }),
        NOW,
      ),
    );
    expect(signals[0]?.kind).toBe('compte_suspendu');
    expect(signals[0]?.detail).toContain('4 j');
  });

  it('rappelle l’ardoise quand la facturation la connaît', () => {
    const [suspendu] = only(
      signalsForClient(
        client({
          accountStatus: 'suspended',
          suspendedAt: daysAgo(4),
          outstanding: {
            ...NO_OUTSTANDING,
            totalDueCents: 41_700,
            totalDueLabel: '417,00 €',
            invoices: 3,
          },
        }),
        NOW,
      ),
      'compte_suspendu',
    );
    expect(suspendu?.detail).toContain('417,00 €');
  });
});

// ─────────────────────────────────────────────────────────────
// Fin d'essai
// ─────────────────────────────────────────────────────────────

describe('Essai qui s’achève', () => {
  const trial = (days: number, orders30d = 300) =>
    signalsForClient(
      client({
        accountStatus: 'trial',
        accountSince: daysAgo(days),
        since: daysAgo(days),
        activity: { ...client().activity, orders30d },
      }),
      NOW,
    );

  it('ne dit rien au début de l’essai', () => {
    expect(only(trial(3), 'essai_qui_sacheve')).toHaveLength(0);
  });

  it('prévient dans les derniers jours, avec l’usage réel comme argument', () => {
    const [essai] = only(trial(TRIAL_DAYS - TRIAL_WARNING_DAYS + 2), 'essai_qui_sacheve');
    expect(essai).toBeDefined();
    expect(essai?.detail).toContain('300 commandes');
    expect(essai?.action).toContain('signer');
  });

  it('change d’appel quand l’essai n’a rien produit', () => {
    // Parler abonnement à quelqu'un qui n'a encaissé rien du tout, c'est
    // conclure une vente qui se résiliera : l'appel à passer est l'installation.
    const [essai] = only(trial(TRIAL_DAYS - 2, 0), 'essai_qui_sacheve');
    expect(essai?.severity).toBe('critique');
    expect(essai?.action).toContain('installation');
  });

  it('signale un essai qui court au-delà du terme', () => {
    const [essai] = only(trial(TRIAL_DAYS + 12), 'essai_qui_sacheve');
    expect(essai?.title).toBe('Essai dépassé');
    expect(essai?.detail).toContain('12 j au-delà');
    expect(essai?.severity).toBe('critique');
  });

  it('ne s’applique jamais à un client déjà abonné', () => {
    expect(only(signalsForClient(client({ accountStatus: 'active' }), NOW), 'essai_qui_sacheve'))
      .toHaveLength(0);
  });

  it('ne crie « essai dépassé » que sur un essai SANS terme en base', () => {
    // Le signal lit le statut EFFECTIF (`readAccount` → `statutEffectif`) : un
    // essai dont le terme est écrit vaut « actif » dès ce terme, et la file
    // cesse donc de hurler sur des comptes désormais facturés. Ce qui reste
    // ici, c'est le parc d'avant `trialEndsAt` — qu'aucune date ne peut clore
    // tout seul, et qu'il faut donc continuer de rappeler.
    expect(statutEffectif({ status: 'trial', trialEndsAt: daysAgo(2) }, NOW)).toBe('active');
    expect(only(signalsForClient(client({ accountStatus: 'active' }), NOW), 'essai_qui_sacheve'))
      .toHaveLength(0);
    const [essai] = only(trial(TRIAL_DAYS + 12), 'essai_qui_sacheve');
    expect(essai?.title).toBe('Essai dépassé');
  });
});

// ─────────────────────────────────────────────────────────────
// Approvisionnement
// ─────────────────────────────────────────────────────────────

describe('Ruptures d’ingrédients', () => {
  it('ne réagit pas à un ingrédient manquant', () => {
    // Un ou deux produits coupés, c'est la vie d'un fast-food — et l'écran
    // d'appro du gérant le lui dit déjà. L'appeler pour ça, c'est lui répéter
    // ce qu'il voit.
    const signals = signalsForClient(client({ supply: supplySnapshot({ out: 1, starved: 1 }) }), NOW);
    expect(only(signals, 'rupture_appro')).toHaveLength(0);
  });

  it('sort quand plusieurs ingrédients sont coupés en même temps', () => {
    const [rupture] = only(
      signalsForClient(
        client({ supply: supplySnapshot({ out: SUPPLY_OUT_MIN, starved: 0, belowPar: 9 }) }),
        NOW,
      ),
      'rupture_appro',
    );
    expect(rupture?.detail).toContain(`${SUPPLY_OUT_MIN} ingrédients en rupture`);
    expect(rupture?.detail).toContain('107 suivis');
    expect(rupture?.detail).toContain('9 sous le seuil');
    expect(rupture?.value).toBe(SUPPLY_OUT_MIN);
  });

  it('compte le stock tombé à zéro sans rupture déclarée', () => {
    const [rupture] = only(
      signalsForClient(client({ supply: supplySnapshot({ out: 1, starved: 3 }) }), NOW),
      'rupture_appro',
    );
    expect(rupture?.detail).toContain('3 à stock nul sans rupture déclarée');
  });

  it('disparaît quand PostgreSQL est injoignable', () => {
    const signals = signalsForClient(client({ supply: null }), NOW);
    expect(only(signals, 'rupture_appro')).toHaveLength(0);
    // Et le module « stocks » aussi : on ne juge pas un usage qu'on ne lit pas.
    expect(only(signals, 'module_dormant').map((s) => s.id)).not.toContain(
      `module_dormant:${CLASSFOOD}:stocks`,
    );
  });
});

describe('Module « suivi des stocks »', () => {
  it('n’est pas considéré ouvert sur une ébauche de registre', () => {
    // Trois ingrédients saisis pour essayer, ce n'est pas un module en service.
    const module = stocksModule(
      supplySnapshot({ ingredients: SUPPLY_SETUP_MIN_INGREDIENTS - 1, suppliers: 1 }),
    );
    expect(module.provisioned).toBe(false);
  });

  it('n’est pas considéré ouvert sans fournisseur', () => {
    expect(stocksModule(supplySnapshot({ suppliers: 0 })).provisioned).toBe(false);
  });

  it('est considéré utilisé dès le premier mouvement enregistré', () => {
    const module = stocksModule(supplySnapshot({ movements: 4, movements30d: 4 }));
    expect(module.used).toBe(true);
    expect(module.detail).toContain('4 mouvement');
  });
});

describe('Modules ouverts et jamais servis', () => {
  it('sort un signal PAR module, avec la phrase chiffrée de la fiche de santé', () => {
    // « Former à l'écran cuisine » et « pousser la commande en ligne » ne se
    // disent pas dans le même appel : un signal groupé forcerait l'équipe à
    // rouvrir la fiche pour savoir de quoi il retourne.
    const modules = buildModules({
      posOrders: 0,
      posLastOrderAt: null,
      onlineOrders: 0,
      onlineLastOrderAt: null,
      posDevices: [unit()],
      kdsDevices: [],
      screens: [],
    });
    const dormants = only(
      signalsForClient(client({ modules, supply: supplySnapshot({ movements: 2 }) }), NOW),
      'module_dormant',
    );
    expect(dormants.map((d) => d.title).sort()).toEqual([
      'Module ouvert jamais utilisé — Caisse',
      'Module ouvert jamais utilisé — Commande en ligne',
    ]);
    expect(dormants[0]?.detail).toContain('30 j');
  });

  it('ne reproche pas au client un module qu’il n’a pas', () => {
    // Aucun écran de salle déclaré chez Class'Food : lui reprocher de ne pas
    // s'en servir n'apprend rien à personne et fait mentir la file.
    const dormants = only(signalsForClient(client(), NOW), 'module_dormant');
    expect(dormants.map((d) => d.title)).not.toContain(
      'Module ouvert jamais utilisé — Écrans de salle',
    );
  });

  it('reste « pour information » chez un client qui ne paie pas encore', () => {
    const [dormant] = only(
      signalsForClient(client({ accountStatus: 'trial', accountSince: daysAgo(2) }), NOW),
      'module_dormant',
    );
    expect(dormant?.severity).toBe('info');
  });
});

// ─────────────────────────────────────────────────────────────
// L'ordre d'appel
// ─────────────────────────────────────────────────────────────

describe('Ordre d’appel', () => {
  const signal = (over: Partial<CrmQueueSignal>): CrmQueueSignal =>
    ({
      id: 'x',
      kind: 'module_dormant',
      severity: 'info',
      severityLabel: 'Pour information',
      gravity: 20,
      tenantId: CLASSFOOD,
      tenantName: "CLASS'FOOD",
      tenantSlug: 'classfood',
      planLabel: 'Complet',
      accountStatus: 'active',
      accountStatusLabel: 'Actif',
      title: '',
      detail: '',
      action: '',
      value: 0,
      unit: 'modules',
      since: null,
      ageDays: null,
      href: '',
      ...over,
    }) as CrmQueueSignal;

  it('met la gravité avant tout', () => {
    const out = sortQueue([
      signal({ id: 'a', severity: 'info' }),
      signal({ id: 'b', severity: 'critique' }),
      signal({ id: 'c', severity: 'attention' }),
    ]);
    expect(out.map((s) => s.id)).toEqual(['b', 'c', 'a']);
  });

  it('commence par le plus ancien à gravité égale', () => {
    // Même convention que la file de recouvrement : on commence toujours par
    // ce qui pourrit depuis le plus longtemps.
    const out = sortQueue([
      signal({ id: 'recent', severity: 'critique', gravity: 80, since: daysAgo(2).toISOString() }),
      signal({ id: 'vieux', severity: 'critique', gravity: 80, since: daysAgo(30).toISOString() }),
    ]);
    expect(out.map((s) => s.id)).toEqual(['vieux', 'recent']);
  });

  it('range en dernier ce qui n’a pas de date', () => {
    const out = sortQueue([
      signal({ id: 'sans', severity: 'attention', gravity: 50, since: null }),
      signal({ id: 'avec', severity: 'attention', gravity: 50, since: daysAgo(1).toISOString() }),
    ]);
    expect(out.map((s) => s.id)).toEqual(['avec', 'sans']);
  });

  it('rend deux fois le même ordre sur une file identique', () => {
    const file = [
      signal({ id: 'b', tenantName: 'Bistrot' }),
      signal({ id: 'a', tenantName: 'Ardoise' }),
    ];
    expect(sortQueue(file).map((s) => s.id)).toEqual(sortQueue([...file].reverse()).map((s) => s.id));
  });
});

// ─────────────────────────────────────────────────────────────
// Ce qu'une ligne porte toujours
// ─────────────────────────────────────────────────────────────

describe('Forme d’un signal', () => {
  const all = signalsForClient(
    client({
      accountStatus: 'suspended',
      suspendedAt: daysAgo(3),
      outstanding: {
        ...NO_OUTSTANDING,
        overdueInvoices: 1,
        overdueCents: 13_900,
        overdueLabel: '139,00 €',
        oldestOverdueAt: daysAgo(22).toISOString(),
        oldestOverdueDays: 22,
      },
      supply: supplySnapshot({ out: 4 }),
    }),
    NOW,
  );

  it('couvre les six situations attendues quand elles se présentent', () => {
    expect(kindsOf(all)).toEqual(
      expect.arrayContaining([
        'compte_suspendu',
        'impaye',
        'appareil_muet',
        'rupture_appro',
        'module_dormant',
      ]),
    );
  });

  it('porte partout un chiffre, une action et un lien vers la fiche', () => {
    for (const s of all) {
      expect(s.detail).toMatch(/\d/); // aucun signal sans chiffre réel derrière
      expect(s.action.length).toBeGreaterThan(10);
      expect(s.href).toBe(`/sm/clients/${CLASSFOOD}`);
      expect(s.title.length).toBeLessThanOrEqual(60); // « titre COURT »
      expect(s.tenantName).toBe("CLASS'FOOD");
    }
  });

  it('donne à chaque ligne une clé stable', () => {
    const ids = all.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    const encore = signalsForClient(
      client({
        accountStatus: 'suspended',
        suspendedAt: daysAgo(3),
        outstanding: {
          ...NO_OUTSTANDING,
          overdueInvoices: 1,
          overdueCents: 13_900,
          overdueLabel: '139,00 €',
          oldestOverdueAt: daysAgo(22).toISOString(),
          oldestOverdueDays: 22,
        },
        supply: supplySnapshot({ out: 4 }),
      }),
      NOW,
    );
    expect(encore.map((s) => s.id)).toEqual(ids);
  });

  it('n’écrit jamais un nombre à l’anglaise', () => {
    // Le monorepo est en français, sans exception : « -39.1 % » au milieu d'une
    // phrase lue cinquante fois par jour est une faute, pas un détail.
    const chute = signalsForClient(
      client({
        activity: {
          ...client().activity,
          orders7d: 300,
          previousOrders7d: 493,
        },
      }),
      NOW,
    );
    for (const s of chute) expect(s.detail).not.toMatch(/\d\.\d/);
  });
});

// ─────────────────────────────────────────────────────────────
// Le service, avec des doublures de base
// ─────────────────────────────────────────────────────────────

/** `orders` : la file n'emploie que `aggregate` et `countDocuments`. */
class FakeOrders {
  readonly pipelines: unknown[][] = [];
  readonly counts: Row[] = [];
  constructor(
    private readonly rows: Row[] = [],
    private readonly since = 0,
  ) {}

  async aggregate<T>(pipeline: unknown[]): Promise<T[]> {
    this.pipelines.push(pipeline);
    return this.rows as T[];
  }

  async countDocuments(filter: Row): Promise<number> {
    this.counts.push(filter);
    return this.since;
  }

  asModel<T>(): import('mongoose').Model<T> {
    return this as unknown as import('mongoose').Model<T>;
  }
}

/** Contexte supply (PostgreSQL) tel que la file l'interroge. */
function fakeSupply(over?: { throws?: boolean; movements?: Row[] }): SupplyDb {
  if (over?.throws) {
    const boom = () => Promise.reject(new Error('ECONNREFUSED 127.0.0.1:5432'));
    return {
      query: { ingredients: { findMany: boom }, suppliers: { findMany: boom } },
      select: () => ({ from: () => ({ groupBy: boom }) }),
    } as unknown as SupplyDb;
  }
  return {
    query: {
      // 107 ingrédients chez classfood, 4 sous le seuil dont 1 à zéro.
      ingredients: {
        findMany: async () =>
          Array.from({ length: 107 }, (_, i) => ({
            tenantRef: CLASSFOOD,
            isOut: false,
            currentStock: i === 0 ? '0.000' : i < 4 ? '8.000' : '20.000',
            parLevel: i < 4 ? '30.000' : '10.000',
          })),
      },
      suppliers: {
        findMany: async () => [
          { tenantRef: CLASSFOOD },
          { tenantRef: CLASSFOOD },
          { tenantRef: CLASSFOOD },
        ],
      },
    },
    select: () => ({ from: () => ({ groupBy: async () => over?.movements ?? [] }) }),
  } as unknown as SupplyDb;
}

/** `BillingService`, réduit au seul verbe que la file emploie. */
/** Aucun signal « traité » par défaut — la file sort entière. */
const fakeDismissals = () =>
  ({
    find: () => ({ lean: () => Promise.resolve([]) }),
    updateOne: () => Promise.resolve({}),
  }) as unknown as import('mongoose').Model<SignalDismissal>;

const fakeBilling = (invoices: Row[] = [], throws = false): BillingService =>
  ({
    overdue: async () => {
      if (throws) throw new Error('Invoice model unavailable');
      return { invoices, count: invoices.length } as never;
    },
  }) as unknown as BillingService;

describe('La file, de bout en bout', () => {
  let tenants: FakeCollection;
  let devices: FakeCollection;
  let screens: FakeCollection;
  let orders: FakeOrders;

  const build = (
    rows: Row[],
    opts: { supply?: SupplyDb; billing?: BillingService; missed?: number } = {},
  ) => {
    orders = new FakeOrders(rows, opts.missed ?? 1);
    return new SignalsService(
      tenants.asModel<Tenant>(),
      orders.asModel<Order>(),
      devices.asModel<Device>(),
      screens.asModel<Screen>(),
      fakeDismissals(),
      opts.supply ?? fakeSupply(),
      opts.billing ?? fakeBilling(),
    );
  };

  const activityRow = (over: Row = {}): Row => ({
    _id: CLASSFOOD,
    lastOrderAt: hoursAgo(2.9),
    orders7: 443,
    revenue7: 887_470,
    ordersPrev7: 493,
    revenuePrev7: 1_055_210,
    orders30: 2_061,
    posOrders30: 1_235,
    posLastAt: hoursAgo(3),
    onlineOrders30: 512,
    onlineLastAt: hoursAgo(3),
    ...over,
  });

  beforeEach(() => {
    tenants = new FakeCollection('tenant');
    devices = new FakeCollection('device');
    screens = new FakeCollection('screen');
    tenants.seed({
      _id: CLASSFOOD,
      slug: 'classfood',
      name: "CLASS'FOOD",
      plan: 'complet',
      createdAt: new Date('2026-08-18T15:06:44.415Z'),
      account: { status: 'active', since: daysAgo(1), reason: '', suspendedAt: null },
    });
    devices.seed({
      _id: CAISSE,
      tenantId: CLASSFOOD,
      name: 'Caisse comptoir',
      kind: 'pos',
      paired: true,
      lastSeenAt: new Date(NOW.getTime() - 60_000),
    });
    devices.seed({
      _id: CUISINE,
      tenantId: CLASSFOOD,
      name: 'Écran cuisine',
      kind: 'kds',
      paired: true,
      lastSeenAt: hoursAgo(3),
    });
  });

  it('rend le parc réel : l’écran cuisine muet et le suivi des stocks endormi', async () => {
    const queue = await build([activityRow()]).queue(NOW);
    expect(kindsOf(queue)).toEqual(['appareil_muet', 'module_dormant']);
    expect(queue[0]?.title).toBe('Écran cuisine muet');
    expect(queue[0]?.detail).toContain('1 commande');
    expect(queue[1]?.detail).toContain('107 ingrédients');
  });

  it('ne compte les commandes ratées que pour les appareils retenus', async () => {
    // Une requête par appareil signalé, et pas une de plus : sur un parc en
    // bonne santé, la file ne déclenche AUCUNE lecture supplémentaire.
    await build([activityRow()]).queue(NOW);
    expect(orders.counts).toHaveLength(1);
    expect(String(orders.counts[0]?.tenantId)).toBe(CLASSFOOD);
  });

  it('ne lit jamais un champ de consommateur final ni un secret d’appareil', async () => {
    await build([activityRow()]).queue(NOW);
    const dump = JSON.stringify(orders.pipelines);
    for (const forbidden of [
      'customerName',
      'customerPhone',
      'pickup',
      'trackingToken',
      'deviceToken',
      'pairingCode',
    ]) {
      expect(dump).not.toContain(forbidden);
    }
  });

  it('balaie le parc entier, sans filtre de tenant', async () => {
    // La file est TRANS-TENANT par nature : le cloisonnement se joue sur le
    // rôle du contrôleur, pas sur un `$match` qu'on oublierait un jour.
    await build([activityRow()]).queue(NOW);
    const [match] = orders.pipelines[0] ?? [];
    expect(JSON.stringify(match)).not.toContain('tenantId');
  });

  it('reste debout quand PostgreSQL tombe', async () => {
    const queue = await build([activityRow()], { supply: fakeSupply({ throws: true }) }).queue(NOW);
    // L'appareil muet sort toujours ; le volet appro disparaît sans un mot faux.
    expect(kindsOf(queue)).toEqual(['appareil_muet']);
  });

  it('reste debout quand la facturation tombe', async () => {
    const queue = await build([activityRow()], { billing: fakeBilling([], true) }).queue(NOW);
    expect(kindsOf(queue)).toContain('appareil_muet');
    expect(kindsOf(queue)).not.toContain('impaye');
  });

  it('reprend les impayés de la file de recouvrement, sans les recalculer', async () => {
    const queue = await build([activityRow()], {
      billing: fakeBilling([
        {
          tenantId: CLASSFOOD,
          dueCents: 13_900,
          status: 'en_retard',
          dueAt: daysAgo(33).toISOString(),
        },
      ]),
    }).queue(NOW);
    const [impaye] = only(queue, 'impaye');
    expect(impaye?.detail).toContain('139,00 €');
    expect(impaye?.value).toBe(33);
    expect(impaye?.severity).toBe('critique');
  });

  it('trie la file avant de la rendre', async () => {
    tenants.seed({
      _id: VOISIN,
      slug: 'voisin',
      name: 'Le Voisin',
      plan: 'essentiel',
      createdAt: daysAgo(120),
      account: { status: 'suspended', since: daysAgo(9), suspendedAt: daysAgo(9) },
    });
    const queue = await build([activityRow()]).queue(NOW);
    expect(queue[0]?.kind).toBe('compte_suspendu');
    expect(queue[0]?.tenantName).toBe('Le Voisin');
  });

  it('compare deux fenêtres de durée strictement égale', () => {
    // Sinon la variation mesure la longueur de la fenêtre autant que
    // l'activité du restaurant.
    const bounds = {
      short: hoursAgo(24 * 7),
      shortPrev: hoursAgo(24 * 14),
      long: daysAgo(30),
      longPrev: daysAgo(60),
    };
    const dump = JSON.stringify(activityPipeline(bounds));
    expect(dump).toContain('ready');
    expect(dump).toContain('delivered');
    expect(dump).toContain('cancelled');
  });
});
