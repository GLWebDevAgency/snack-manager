import { describe, expect, it } from 'vitest';
import {
  CreateOrderSchema,
  CreatePublicOrderSchema,
  OptionGroupSchema,
  OrderLineInputSchema,
  UpdateOrderStatusSchema,
} from './index';

/**
 * LES BORNES QUI MANQUAIENT AUX SCHÉMAS PARTAGÉS.
 *
 * Un schéma qui laisse passer devient la règle de fait : trois lecteurs
 * différents en tirent trois conclusions, et c'est celle du plus permissif qui
 * finit en base.
 */

const groupe = (over: Record<string, unknown> = {}) => ({
  key: 'sauces',
  name: 'Sauces',
  type: 'multi',
  choices: [
    { key: 'ketchup', name: 'Ketchup', priceDelta: 0 },
    { key: 'mayo', name: 'Mayo', priceDelta: 0 },
  ],
  ...over,
});

describe('un groupe d’options', () => {
  it('« un seul » vaut UN, même quand le maximum est laissé vide', () => {
    // L'éditeur annonce « Vide = autant qu'on veut », ce qui est faux pour un
    // groupe « un seul » : la page en ligne n'autorisait qu'un choix, la caisse
    // et l'API une infinité. Le maximum se déduit du type.
    const r = OptionGroupSchema.parse(groupe({ type: 'single' }));
    expect(r.max).toBe(1);
  });

  it('refuse un « un seul » qui accepterait plusieurs choix', () => {
    // Ce n'est pas une préférence, c'est une contradiction.
    expect(OptionGroupSchema.safeParse(groupe({ type: 'single', max: 3 })).success).toBe(false);
  });

  it('refuse un minimum supérieur au maximum — le produit serait invendable', () => {
    // La commande exigerait plus de choix que le groupe n'en autorise, et
    // refuserait chaque tentative. Aucun écran ne prévenait.
    const r = OptionGroupSchema.safeParse(groupe({ min: 3, max: 2 }));
    expect(r.success).toBe(false);
    expect(JSON.stringify(r)).toMatch(/invendable/);
  });

  it('refuse un maximum supérieur au nombre de choix offerts', () => {
    expect(OptionGroupSchema.safeParse(groupe({ max: 5 })).success).toBe(false);
  });

  it('laisse passer un groupe cohérent', () => {
    expect(OptionGroupSchema.safeParse(groupe({ min: 1, max: 2 })).success).toBe(true);
    // `max` omis sur un « multi » reste « autant qu'on veut » : c'est vrai là.
    expect(OptionGroupSchema.parse(groupe()).max).toBeUndefined();
  });
});

describe('une ligne de commande', () => {
  const ligne = (over: Record<string, unknown> = {}) => ({ productId: 'p1', ...over });

  it('borne les retraits « sans X », comme la note l’était déjà', () => {
    // Un tableau sans longueur de chaînes sans longueur partait tel quel vers
    // l'imprimante du comptoir.
    expect(OrderLineInputSchema.safeParse(ligne({ removed: Array(21).fill('oignons') })).success).toBe(false);
    expect(OrderLineInputSchema.safeParse(ligne({ removed: ['x'.repeat(61)] })).success).toBe(false);
    expect(OrderLineInputSchema.safeParse(ligne({ removed: ['oignons', 'cornichons'] })).success).toBe(true);
  });

  it('plafonne la quantité — sans quoi un tacos fait une commande à 8,9 millions', () => {
    expect(OrderLineInputSchema.safeParse(ligne({ qty: 1_000_000 })).success).toBe(false);
    expect(OrderLineInputSchema.safeParse(ligne({ qty: 50 })).success).toBe(true);
    expect(OrderLineInputSchema.safeParse(ligne({ qty: 0 })).success).toBe(false);
  });
});

describe('le changement de statut', () => {
  it('accepte les avancements', () => {
    for (const status of ['new', 'preparing', 'ready', 'delivered']) {
      expect(UpdateOrderStatusSchema.safeParse({ status }).success).toBe(true);
    }
  });

  it('refuse « annulée » AU LIEU de l’accepter puis de la jeter', () => {
    // Le schéma l'acceptait, la règle d'écriture la rejetait sur son rang −1,
    // et l'API rendait un 200 avec la commande inchangée : l'équipe croyait
    // avoir annulé. Le refus dit maintenant par où passer.
    const r = UpdateOrderStatusSchema.safeParse({ status: 'cancelled' });
    expect(r.success).toBe(false);
    expect(JSON.stringify(r)).toMatch(/Annuler la commande/);
  });
});

describe('une commande publique', () => {
  const publique = (over: Record<string, unknown> = {}) => ({
    clientId: '11111111-1111-4111-8111-111111111111',
    lines: [{ productId: 'produit', options: [], removed: [], qty: 1 }],
    payment: { method: 'counter' },
    pickup: {
      slot: '2026-08-29T18:00:00.000Z',
      customerName: 'Camille',
      customerPhone: '0612345678',
    },
    turnstileToken: 'preuve-a-valider-cote-serveur',
    ...over,
  });

  it('exige un retrait nominatif et une preuve anti-robot bornee', () => {
    expect(CreatePublicOrderSchema.safeParse(publique()).success).toBe(true);
    expect(CreatePublicOrderSchema.safeParse(publique({ pickup: undefined })).success).toBe(false);
    expect(CreatePublicOrderSchema.safeParse(publique({ turnstileToken: '' })).success).toBe(false);
    expect(
      CreatePublicOrderSchema.safeParse(publique({ turnstileToken: 'x'.repeat(2_049) })).success,
    ).toBe(false);
  });

  it.each([
    ['channel', 'pos'],
    ['type', 'surplace'],
    ['status', 'ready'],
    ['paid', true],
    ['tender', 'cash'],
    ['cashReceived', 10_000],
    ['loyaltyMemberId', '22222222-2222-4222-8222-222222222222'],
  ])('refuse le fait serveur %s dans le corps public', (key, value) => {
    const body = publique(
      key === 'tender' || key === 'cashReceived'
        ? { payment: { method: 'counter', [key]: value } }
        : { [key]: value },
    );
    expect(CreatePublicOrderSchema.safeParse(body).success).toBe(false);
  });
});

describe('une commande authentifiée au comptoir', () => {
  const commande = (loyaltyMemberId: unknown) => ({
    clientId: '11111111-1111-4111-8111-111111111111',
    loyaltyMemberId,
    channel: 'pos',
    type: 'surplace',
    lines: [{ productId: 'produit', options: [], removed: [], qty: 1 }],
    payment: { method: 'counter', tender: 'card' },
  });

  it('accepte uniquement un UUID de membre, figé au moment de la vente', () => {
    expect(
      CreateOrderSchema.safeParse(
        commande('22222222-2222-4222-8222-222222222222'),
      ).success,
    ).toBe(true);
    expect(CreateOrderSchema.safeParse(commande('carte-libre')).success).toBe(false);
  });
});
