import { describe, expect, it } from 'vitest';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { OrdersService } from './orders.service';

/**
 * LA PROMOTION DESCEND JUSQU'AU TICKET.
 *
 * Le back-office savait créer une promotion, la modifier, l'activer d'un clic
 * et la supprimer. Rien ne l'appliquait : `totals.discount` était écrit `null`
 * en dur à la création de chaque commande, et `usageCount` restait à zéro pour
 * toujours.
 *
 * Le défaut est du genre le plus coûteux, parce que le logiciel avait l'air
 * complet : un restaurateur créait « BIENVENUE10 », l'imprimait sur ses flyers,
 * et l'apprenait d'un client au téléphone.
 *
 * La règle elle-même est vérifiée dans le domaine
 * (`packages/domain/src/ordering/promotion.test.ts`). Ces tests-ci vérifient le
 * BRANCHEMENT : que le service la consulte, écrive le résultat sur la pièce, et
 * réserve l'utilisation.
 */

const TENANT = '507f1f77bcf86cd799439011';
const PRODUIT = '507f1f77bcf86cd799439012';
const PROMO = '507f1f77bcf86cd799439013';

const produit = {
  _id: PRODUIT,
  name: 'Burger maison',
  price: 1_000,
  variants: [],
  optionGroups: [],
  outOfStock: false,
  active: true,
};

const promoDoc = (over: Record<string, unknown> = {}) => ({
  _id: PROMO,
  tenantId: TENANT,
  name: 'Offre de bienvenue',
  kind: 'percent',
  value: 10,
  code: 'BIENVENUE10',
  channels: ['online', 'pos'],
  startsAt: null,
  endsAt: null,
  active: true,
  usageCount: 0,
  minSubtotalCents: 0,
  maxDiscountCents: 0,
  maxUsage: 0,
  offeredProductId: null,
  ...over,
});

type Creee = {
  loyaltyMemberId?: string | null;
  loyaltyEarnOperationId?: string | null;
  loyaltyEarnState?: string | null;
  totals: { subtotal: number; discount: { amount: number; reason: string } | null; total: number };
  payment: { cashReceived: number | null; changeGiven: number | null };
};

function build(
  promos: Record<string, unknown>[],
  over: { reserveRefusee?: boolean; creationEchoue?: unknown } = {},
) {
  const created: Creee[] = [];
  const incremente: unknown[] = [];
  const rendu: unknown[] = [];
  const vus: number[] = [];
  const published: string[] = [];
  const service = new OrdersService(
    {
      // `null` au PREMIER appel — le contrôle d'idempotence en tête de
      // `create` — puis la commande gagnante au second, celui du rattrapage de
      // course. Rendre la commande dès le premier ferait sortir avant même de
      // toucher à la promotion, et le test ne vérifierait rien.
      findOne: async () => (vus.push(1) > 1 ? { trackingToken: 't' } : null),
      create: async (doc: Record<string, unknown>) => {
        if (over.creationEchoue) throw over.creationEchoue;
        created.push(doc as unknown as Creee);
        return { ...doc, toObject: () => doc };
      },
    } as never,
    { find: () => ({ lean: async () => [produit] }) } as never,
    { findOneAndUpdate: async () => ({ seq: 7 }) } as never,
    {
      find: () => ({ lean: async () => promos }),
      findOneAndUpdate: async (filtre: unknown) => {
        incremente.push(filtre);
        return over.reserveRefusee ? null : { usageCount: 1 };
      },
      updateOne: async (filtre: unknown) => void rendu.push(filtre),
    } as never,
    {
      publish: (_channel: string, payload: string) => {
        published.push(payload);
        return Promise.resolve(1);
      },
    } as never,
    { record: async () => {} } as never,
    {} as never,
    { pourTenant: async () => ["bo"] } as never,
    {} as never,
  );
  // These tests exercise shared pricing, not the authenticated staff route.
  // Online callers enter createWithOutcome; staff creation rejects that channel.
  const pricing = {
    create: async (...args: Parameters<OrdersService['create']>) =>
      (await service.createWithOutcome(...args)).order,
  };
  return { service: pricing, created, incremente, rendu, published };
}

const commande = (over: Record<string, unknown> = {}) =>
  ({
    clientId: '11111111-1111-4111-8111-111111111111',
    channel: 'online',
    type: 'emporter',
    lines: [{ productId: PRODUIT, options: [], removed: [], qty: 1 }],
    payment: { method: 'card' },
    ...over,
  }) as never;

describe('la promotion appliquée à la commande', () => {
  it('retire son montant du total et le NOMME sur la pièce', async () => {
    const { service, created } = build([promoDoc()]);
    await service.create(TENANT, commande({ promoCode: 'BIENVENUE10' }), 'client');

    const totals = created[0]!.totals;
    expect(totals.subtotal).toBe(1_000);
    expect(totals.discount?.amount).toBe(100);
    // « Remise » ne se vérifie pas six mois plus tard ; le code et le nom, si.
    expect(totals.discount?.reason).toBe('BIENVENUE10 — Offre de bienvenue');
    expect(totals.total).toBe(900);
  });

  it('sans promotion applicable, la pièce reste au tarif normal', async () => {
    const { service, created } = build([]);
    await service.create(TENANT, commande(), 'client');
    expect(created[0]!.totals.discount).toBeNull();
    expect(created[0]!.totals.total).toBe(1_000);
  });

  it('fige la carte présentée sur la vente sans la dériver du crédit ultérieur', async () => {
    const { service, created, published } = build([]);
    const loyaltyMemberId = '22222222-2222-4222-8222-222222222222';
    const loyaltyEarnOperationId = '33333333-3333-4333-8333-333333333333';

    await service.create(
      TENANT,
      commande({ channel: 'pos', loyaltyMemberId, loyaltyEarnOperationId }),
      'caisse',
    );

    expect(created[0]!.loyaltyMemberId).toBe(loyaltyMemberId);
    expect(created[0]!.loyaltyEarnOperationId).toBe(loyaltyEarnOperationId);
    expect(created[0]!.loyaltyEarnState).toBe('pending');
    expect(published).toHaveLength(1);
    expect(published[0]).not.toContain(loyaltyMemberId);
    expect(published[0]).not.toContain('loyaltyMemberId');
    expect(published[0]).not.toContain(loyaltyEarnOperationId);
  });

  /**
   * L'INCRÉMENT EST UNE COURSE, et la garde vit en base.
   *
   * Deux commandes simultanées sur la dernière utilisation d'un code passeraient
   * toutes deux le contrôle du domaine, qui lit un compteur figé. C'est donc
   * Mongo qui arbitre — d'où la condition dans le filtre de mise à jour, et non
   * un `if` en amont.
   */
  it('réserve l’utilisation avec sa garde de quota, jamais par un simple $inc', async () => {
    const { service, incremente } = build([promoDoc({ maxUsage: 100, usageCount: 40 })]);
    await service.create(TENANT, commande({ promoCode: 'BIENVENUE10' }), 'client');

    expect(incremente).toHaveLength(1);
    const filtre = incremente[0] as { $or?: unknown[] };
    expect(filtre.$or).toEqual([
      { maxUsage: { $lte: 0 } },
      { $expr: { $lt: ['$usageCount', '$maxUsage'] } },
    ]);
  });

  it('refuse la commande quand le quota tombe entre le contrôle et la réservation', async () => {
    const { service } = build([promoDoc({ maxUsage: 1 })], { reserveRefusee: true });
    await expect(
      service.create(TENANT, commande({ promoCode: 'BIENVENUE10' }), 'client'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('un code inconnu est refusé en nommant le code, pas en silence', async () => {
    const { service } = build([]);
    await expect(
      service.create(TENANT, commande({ promoCode: 'INEXISTANT' }), 'client'),
    ).rejects.toThrow(/INEXISTANT/);
  });

  it('un code réel mais inapplicable dit POURQUOI', async () => {
    const { service } = build([promoDoc({ minSubtotalCents: 5_000 })]);
    await expect(
      service.create(TENANT, commande({ promoCode: 'BIENVENUE10' }), 'client'),
    ).rejects.toThrow(/au moins 50,00/);
  });

  /**
   * Une offre SANS code s'applique d'office. Si elle ne passe pas, elle ne
   * regarde personne : la commande se poursuit au tarif normal plutôt que
   * d'échouer sur une condition que le client n'a jamais demandée.
   */
  it('une offre d’office qui ne passe pas ne fait pas échouer la commande', async () => {
    const { service, created } = build([promoDoc({ code: null, minSubtotalCents: 5_000 })]);
    await service.create(TENANT, commande(), 'client');
    expect(created[0]!.totals.discount).toBeNull();
    expect(created[0]!.totals.total).toBe(1_000);
  });

  it('entre deux offres d’office, retient la MEILLEURE pour le client', async () => {
    const { service, created } = build([
      promoDoc({ _id: 'a', code: null, name: 'Petite', kind: 'amount', value: 50 }),
      promoDoc({ _id: 'b', code: null, name: 'Grande', kind: 'amount', value: 200 }),
    ]);
    await service.create(TENANT, commande(), 'client');
    expect(created[0]!.totals.discount?.amount).toBe(200);
    expect(created[0]!.totals.discount?.reason).toBe('Grande');
  });

  /**
   * Le montant n'est JAMAIS repris du corps — même règle que pour les prix.
   * Un client qui enverrait sa propre remise n'obtient rien.
   */
  it('ignore une remise que le client aurait glissée dans le corps', async () => {
    const { service, created } = build([]);
    await service.create(
      TENANT,
      commande({ totals: { subtotal: 1, discount: { amount: 999 }, total: 1 } }),
      'client',
    );
    expect(created[0]!.totals.discount).toBeNull();
    expect(created[0]!.totals.total).toBe(1_000);
  });

  it('le canal est respecté : un code réservé au comptoir est refusé en ligne', async () => {
    const { service } = build([promoDoc({ channels: ['pos'] })]);
    await expect(
      service.create(TENANT, commande({ promoCode: 'BIENVENUE10' }), 'client'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

/**
 * LA RÉSERVATION RENDUE — le quota ne doit pas fondre sans commande.
 *
 * `resoudrePromotion` incrémente `usageCount` AVANT la création, et il le faut :
 * c'est ce qui arbitre la course sur la dernière utilisation d'un code. Mais
 * une réservation sans commande grignote le quota pour rien.
 *
 * Le cas n'est pas théorique. Un POS qui rejoue sa file offline repasse par la
 * création avec le même `clientId`, se fait refuser en doublon (11000) — et
 * aurait consommé une utilisation à CHAQUE tentative. Sur un code à cent
 * utilisations, une tablette qui rejoue sa journée l'épuise seule.
 */
describe('la réservation rendue quand la commande n’existe pas', () => {
  /**
   * Le rejeu offline ORDINAIRE sort plus tôt : le contrôle d'idempotence en
   * tête de `create` rend la commande existante sans jamais toucher à la
   * promotion. Ce test-ci couvre la COURSE — deux rejeux simultanés, dont le
   * perdant a déjà réservé quand il découvre le doublon.
   */
  it('rend l’utilisation quand deux rejeux simultanés se disputent la commande', async () => {
    const { service, rendu } = build([promoDoc()], { creationEchoue: { code: 11000 } });
    await service.create(TENANT, commande({ promoCode: 'BIENVENUE10' }), 'client');
    expect(rendu).toHaveLength(1);
    // Borné à zéro : un décrément sur un compteur déjà nul écrirait
    // « −1 utilisée », qui ne veut rien dire à l'écran.
    expect(rendu[0]).toMatchObject({ usageCount: { $gt: 0 } });
  });

  it('rend l’utilisation sur une panne d’écriture, et laisse remonter l’erreur', async () => {
    const { service, rendu } = build([promoDoc()], {
      creationEchoue: new Error('mongo indisponible'),
    });
    await expect(
      service.create(TENANT, commande({ promoCode: 'BIENVENUE10' }), 'client'),
    ).rejects.toThrow(/mongo indisponible/);
    expect(rendu).toHaveLength(1);
  });

  it('ne rend rien quand aucune promotion n’a été réservée', async () => {
    const { service, rendu } = build([], { creationEchoue: { code: 11000 } });
    await service.create(TENANT, commande(), 'client');
    expect(rendu).toHaveLength(0);
  });
});

/**
 * LE RENDU MONNAIE SUIT LE TOTAL DÛ, JAMAIS LE SOUS-TOTAL.
 *
 * Tant que rien n'appliquait les promotions, `discount` valait toujours `null`
 * et les deux montants coïncidaient : passer l'un pour l'autre était sans
 * conséquence. Brancher les promotions a rendu ce raccourci faux sans qu'une
 * ligne de l'encaissement change — le défaut le plus sournois qui soit, celui
 * qu'on introduit ailleurs.
 *
 * Deux dégâts, aux deux extrémités : le client qui tend le bon montant se fait
 * refuser, celui qui tend le montant facial repart sans sa monnaie.
 */
describe('l’encaissement en espèces d’une commande remisée', () => {
  const especes = (recu: number) =>
    commande({
      promoCode: 'BIENVENUE10',
      channel: 'pos',
      payment: { method: 'cash', tender: 'cash', cashReceived: recu },
    });

  it('accepte le montant RÉELLEMENT dû, pas le tarif plein', async () => {
    const { service, created } = build([promoDoc()]);
    // 1 000 − 100 de remise = 900 dus. Le client tend exactement 900.
    await service.create(TENANT, especes(900), 'caisse');
    expect(created[0]!.payment.cashReceived).toBe(900);
    expect(created[0]!.payment.changeGiven).toBe(0);
  });

  it('rend la monnaie sur le total remisé', async () => {
    const { service, created } = build([promoDoc()]);
    // Le client tend 1 000 sur 900 dus : 100 lui reviennent.
    await service.create(TENANT, especes(1_000), 'caisse');
    expect(created[0]!.payment.changeGiven).toBe(100);
  });

  it('refuse toujours un montant réellement insuffisant', async () => {
    const { service } = build([promoDoc()]);
    await expect(service.create(TENANT, especes(800), 'caisse')).rejects.toThrow(/insuffisant/);
  });
});

/**
 * LE PLAFOND DE LA LISTE SE DIT, au lieu de se faire passer pour un total.
 *
 * `total` valait `rows.length`, c'est-à-dire le plafond lui-même dès qu'il
 * était atteint. Le Z de clôture du POS se calcule sur cette liste : un snack
 * qui passe deux cent cinquante tickets voyait les cinquante plus anciens
 * disparaître du chiffre d'affaires, des espèces, de la carte et des
 * titres-restaurant — sans qu'aucun écran ne signale la coupe. Le gérant
 * recomptait sa caisse contre un total amputé.
 */
describe('la liste des commandes du service', () => {
  function service(enBase: number, rendues: number) {
    return new OrdersService(
      {
        find: () => ({
          sort: () => ({
            limit: () => ({ lean: async () => Array.from({ length: rendues }, () => ({})) }),
          }),
        }),
        countDocuments: async () => enBase,
      } as never,
      {} as never,
      {} as never,
      { find: () => ({ lean: async () => [] }) } as never,
      { publish: () => {} } as never,
      { log: async () => {} } as never,
      {} as never,
      { pourTenant: async () => ["bo"] } as never,
      {} as never,
    );
  }

  it('rend le VRAI total, pas le nombre de lignes servies', async () => {
    const r = await service(250, 200).list(TENANT, {});
    expect(r.total).toBe(250);
    expect(r.truncated).toBe(true);
  });

  it('ne crie pas à la troncature quand tout tient', async () => {
    const r = await service(42, 42).list(TENANT, {});
    expect(r.total).toBe(42);
    expect(r.truncated).toBe(false);
  });
});

/**
 * UNE COMMANDE REMISE A FORCÉMENT ÉTÉ RÉGLÉE.
 *
 * La remise exige un encaissement préalable. Elle ne vaut jamais confirmation
 * de perception, même pour le choix « à régler au retrait » sans tentative bancaire.
 */
describe('le paiement confirmé avant la remise', () => {
  function commandeEn(method: string, statut: string) {
    const doc = {
      _id: 'o1',
      status: 'ready',
      statusHistory: [],
      payment: { method, status: statut, tender: null },
      paymentFlow: { version: 1, origin: 'created_v1', phase: 'open', attempt: null },
      totals: { subtotal: 1_000, total: 1_000 },
      save: async () => {},
      toObject: () => ({}),
    };
    const service = new OrdersService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { publish: () => {} } as never,
      { log: async () => {} } as never,
      {} as never,
      { pourTenant: async () => ["bo"] } as never,
      {} as never,
    );
    (service as unknown as { byId: () => Promise<unknown> }).byId = async () => doc;
    return { service, doc };
  }

  it('ne solde pas au comptoir une commande choisie EN LIGNE, même sans tentative bancaire', async () => {
    const { service, doc } = commandeEn('online', 'pending');
    await expect(service.updateStatus(TENANT, 'o1', 'delivered', {
      sub: 'staff-caisse', tenantId: TENANT, role: 'caisse', kind: 'staff',
    })).rejects.toThrow('Aucun paiement ne sera supposé');
    expect(doc.payment.status).toBe('pending');
  });

  it('exige également l’encaissement explicite du « à régler au retrait »', async () => {
    const { service, doc } = commandeEn('counter', 'pending');
    await expect(service.updateStatus(TENANT, 'o1', 'delivered', {
      sub: 'staff-caisse', tenantId: TENANT, role: 'caisse', kind: 'staff',
    })).rejects.toThrow('Aucun paiement ne sera supposé');
    expect(doc.payment.status).toBe('pending');
    expect(doc.status).toBe('ready');
  });

  it('ne « repaie » pas une commande déjà réglée', async () => {
    const { service, doc } = commandeEn('online', 'paid');
    doc.payment.tender = 'online' as never;
    await service.updateStatus(TENANT, 'o1', 'delivered', {
      sub: 'staff-caisse', tenantId: TENANT, role: 'caisse', kind: 'staff',
    });
    // Le moyen d'origine est conservé : il vaut mieux que rien au Z.
    expect(doc.payment.tender).toBe('online');
  });
});
