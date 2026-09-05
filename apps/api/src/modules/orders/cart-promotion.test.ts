import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { promotionCandidatesFilter, selectCartPromotion } from './cart-promotion';

const now = new Date('2026-09-05T12:00:00.000Z');
const context = { subtotal: 2000, channel: 'online', now, lines: [{ productId: 'burger', unitPrice: 1000 }] };
const promotion = (over: Record<string, unknown> = {}) => ({
  _id: 'promo', name: 'Bienvenue', kind: 'amount', value: 200, code: null, channels: ['online'], active: true,
  ...over,
});

describe('sélection pure commune aux devis et aux commandes', () => {
  it('isole le tenant et les offres actives, normalise seulement la recherche du code', () => {
    expect(promotionCandidatesFilter('tenant-a', ' bienvenue ')).toEqual({ tenantId: 'tenant-a', active: true, code: 'BIENVENUE' });
    expect(promotionCandidatesFilter('tenant-b')).toEqual({ tenantId: 'tenant-b', active: true, code: null });
  });

  it('choisit la meilleure offre automatique, sans cumul ni mutation des candidats', () => {
    const candidates = Object.freeze([
      Object.freeze(promotion({ _id: 'small', value: 50 })),
      Object.freeze(promotion({ _id: 'large', value: 300, usageCount: 4, maxUsage: 5 })),
      Object.freeze(promotion({ _id: 'counter', value: 1000, channels: ['pos'] })),
    ]);
    expect(selectCartPromotion(candidates, context)).toEqual({ id: 'large', amount: 300, reason: 'Bienvenue' });
    expect(candidates[1]).toMatchObject({ usageCount: 4, maxUsage: 5 });
  });

  it('préserve l’ordre historique en cas de remise égale', () => {
    expect(selectCartPromotion([promotion({ _id: 'first' }), promotion({ _id: 'second' })], context)?.id).toBe('first');
  });

  it('le produit offert vaut le moins cher des exemplaires, options réellement tarifées comprises', () => {
    expect(selectCartPromotion([promotion({ kind: 'offered_item', offeredProductId: 'burger' })], {
      ...context, lines: [{ productId: 'burger', unitPrice: 950 }, { productId: 'burger', unitPrice: 850 }],
    })?.amount).toBe(850);
  });

  it('les anciens champs de borne absents restent illimités et la remise ne dépasse jamais le panier', () => {
    expect(selectCartPromotion([promotion({ value: 10000 })], context)?.amount).toBe(2000);
  });

  it('un code inconnu reste une erreur explicite, sans retomber sur une autre offre', () => {
    expect(() => selectCartPromotion([], { ...context, promoCode: ' INCONNU ' })).toThrow('Le code « INCONNU » ne correspond à aucune offre');
  });

  it.each([
    [{ channels: ['pos'] }, /pas valable.*en ligne/],
    [{ startsAt: new Date('2027-01-01') }, /pas encore commencé/],
    [{ endsAt: now }, /terminée/],
    [{ maxUsage: 1, usageCount: 1 }, /nombre d’utilisations/],
    [{ minSubtotalCents: 5000 }, /au moins 50,00/],
  ] as const)('le code refusé conserve sa raison métier : %j', (over, reason) => {
    const candidates = [promotion({ ...over, code: 'WELCOME' })];
    expect(() => selectCartPromotion(candidates, { ...context, promoCode: ' welcome ' })).toThrow(reason);
    expect(() => selectCartPromotion(candidates, { ...context, promoCode: 'WELCOME' })).toThrow(BadRequestException);
  });

  it('une offre automatique épuisée ou hors canal est ignorée sans bloquer le panier', () => {
    expect(selectCartPromotion([promotion({ maxUsage: 1, usageCount: 1 }), promotion({ channels: ['pos'] })], context)).toBeNull();
  });
});
