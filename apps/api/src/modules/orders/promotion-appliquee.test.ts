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
  totals: { subtotal: number; discount: { amount: number; reason: string } | null; total: number };
};

function build(promos: Record<string, unknown>[], over: { reserveRefusee?: boolean } = {}) {
  const created: Creee[] = [];
  const incremente: unknown[] = [];
  const service = new OrdersService(
    {
      findOne: async () => null,
      create: async (doc: Record<string, unknown>) => {
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
    } as never,
    { publish: () => {} } as never,
    { record: async () => {} } as never,
  );
  return { service, created, incremente };
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
