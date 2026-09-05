import { describe, expect, it } from 'vitest';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { REMISE_PLAFOND_CENTS } from '@sm/contracts';
import { OrdersService } from './orders.service';

/**
 * QUI PEUT ACCORDER UNE REMISE, ET JUSQU'À COMBIEN.
 *
 * `POST /orders/:id/discount` re-demandait le PIN — traçabilité NF525 — et
 * s'arrêtait là. Quatre défauts cumulés sur la même route :
 *
 *  1. le RÔLE du valideur n'était pas lu : `verifyPin` rendait le premier
 *     `staffId` dont le code correspondait, cuisine comprise ;
 *  2. aucun PLAFOND hors le sous-total : la commande entière pouvait être
 *     offerte, à 100 % ;
 *  3. le MOTIF était facultatif (`reason ?? ''`), alors que le domaine
 *     l'exige — le service ne passait simplement pas par lui ;
 *  4. le corps n'était pas validé : `amount` acceptait un flottant.
 *
 * Re-saisir un code prouve QUI agit, jamais que cette personne en a le droit.
 * Les deux contrôles sont distincts, et il manquait le second.
 */

const TENANT = '507f1f77bcf86cd799439011';
const ORDER = '507f1f77bcf86cd799439012';

function build(subtotal = 10_000, status = 'new') {
  const enregistre: Record<string, unknown>[] = [];
  const commande = {
    _id: ORDER,
    number: 12,
    status,
    totals: { subtotal, discount: null as unknown, total: subtotal },
    payment: { status: 'pending', stripePaymentIntentId: null as string | null },
    paymentFlow: { version: 1, origin: 'created_v1', phase: 'open', attempt: null },
    save: async () => {},
    toObject: () => ({}),
  };
  const service = new OrdersService(
    { findOne: () => ({ lean: async () => commande }) } as never,
    {} as never,
    {} as never,
    {} as never,
    { publish: () => {} } as never,
    { log: async (l: Record<string, unknown>) => void enregistre.push(l) } as never,
    {} as never,
    { pourTenant: async () => ["bo"] } as never,
    {} as never,
  );
  // `byId` lit la commande par une autre voie que `findOne().lean()` : on la
  // court-circuite pour que le test porte sur la RÈGLE, pas sur l'accès Mongo.
  (service as unknown as { byId: () => Promise<unknown> }).byId = async () => commande;
  return { service, commande, enregistre };
}

const gerant = { staffId: 'staff-1', role: 'gerant' as const };
const caisse = { staffId: 'staff-2', role: 'caisse' as const };
const cuisine = { staffId: 'staff-3', role: 'cuisine' as const };

describe('le plafond de remise par rôle', () => {
  it('la cuisine n’accorde AUCUNE remise, même d’un euro', async () => {
    const { service } = build();
    await expect(
      service.discount(TENANT, ORDER, cuisine, 100, 'Geste commercial'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('la caisse arrange un client jusqu’à son plafond', async () => {
    const { service, commande } = build();
    await service.discount(TENANT, ORDER, caisse, REMISE_PLAFOND_CENTS.caisse!, 'Plat renversé');
    expect((commande.totals.discount as { amount: number }).amount).toBe(1_500);
  });

  it('au-delà, elle est refusée et le message renvoie au gérant', async () => {
    const { service } = build();
    await expect(
      service.discount(TENANT, ORDER, caisse, REMISE_PLAFOND_CENTS.caisse! + 1, 'Geste'),
    ).rejects.toThrow(/demandez au gérant/);
  });

  it('le gérant n’est pas plafonné — les gestes commerciaux sont son métier', async () => {
    const { service, commande } = build();
    await service.discount(TENANT, ORDER, gerant, 10_000, 'Commande offerte, erreur de notre part');
    expect((commande.totals.discount as { amount: number }).amount).toBe(10_000);
    expect(commande.totals.total).toBe(0);
  });

  /**
   * Un refus de DROIT n'est pas une erreur de saisie. Le 403 le dit : confondu
   * avec un 400, il ferait chercher la faute au caissier plutôt qu'au niveau
   * d'autorisation de son code.
   */
  it('distingue le refus de droit (403) du montant invalide (400)', async () => {
    const { service } = build();
    await expect(service.discount(TENANT, ORDER, cuisine, 100, 'Geste')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(service.discount(TENANT, ORDER, caisse, 5_000, 'Geste')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe('ce que la remise exige encore', () => {
  it('ne réécrit pas un montant déjà associé à une intention Stripe', async () => {
    const { service, commande } = build();
    commande.payment.stripePaymentIntentId = 'pi_started';
    await expect(service.discount(TENANT, ORDER, gerant, 500, 'Geste commercial')).rejects.toThrow(/remboursement/i);
    expect(commande.totals.total).toBe(10_000);
  });

  it.each(['delivered', 'cancelled'])(
    'refuse de réécrire le total une fois la commande %s',
    async (status) => {
      const { service } = build(10_000, status);
      await expect(
        service.discount(TENANT, ORDER, gerant, 500, 'Geste commercial'),
      ).rejects.toBeInstanceOf(ConflictException);
    },
  );

  it('un motif — NF525 n’admet pas une minoration de recette sans raison', async () => {
    const { service } = build();
    await expect(service.discount(TENANT, ORDER, gerant, 500, 'ok')).rejects.toThrow(
      /Motif de remise obligatoire/,
    );
  });

  it('ne dépasse jamais le montant de la commande', async () => {
    const { service } = build(1_200);
    await expect(
      service.discount(TENANT, ORDER, gerant, 2_000, 'Geste commercial'),
    ).rejects.toThrow(/ne peut pas dépasser/);
  });

  it('journalise le RÔLE du valideur, pas seulement son identité', async () => {
    const { service, enregistre } = build();
    await service.discount(TENANT, ORDER, gerant, 500, 'Geste commercial');
    // « Qui » ne suffit pas à relire un contrôle six mois plus tard : il faut
    // « à quel titre ».
    expect(enregistre[0]).toMatchObject({
      action: 'order.discount',
      staffId: 'staff-1',
      meta: { role: 'gerant', amount: 500 },
    });
    expect(enregistre[0]!.pinVerifiedAt).toBeInstanceOf(Date);
  });

  it('n’écrit pas de promotion : une remise de comptoir n’en est pas une', async () => {
    const { service, commande } = build();
    await service.discount(TENANT, ORDER, gerant, 500, 'Geste commercial');
    const pose = commande.totals.discount as { staffId: string; promotionId: unknown };
    expect(pose.staffId).toBe('staff-1');
    expect(pose.promotionId).toBeNull();
  });
});
