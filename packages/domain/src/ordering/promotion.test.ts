import { describe, expect, it } from 'vitest';
import { appliquerPromotion, type PromotionContext, type PromotionRule } from './promotion';
import { Money } from '../shared/money';

/**
 * LA RÈGLE QUI N'EXISTAIT PAS.
 *
 * Le back-office savait créer, modifier, activer et supprimer une promotion.
 * Aucune ligne ne l'appliquait : `totals.discount` valait `null` en dur à la
 * création de chaque commande. Ces tests sont la règle manquante — et le
 * premier d'entre eux, celui du total négatif, est la raison pour laquelle elle
 * ne doit pas être écrite à la va-vite dans un service.
 */

const NOW = new Date('2026-08-28T12:00:00.000Z');

const regle = (over: Partial<PromotionRule> = {}): PromotionRule => ({
  id: 'promo-1',
  name: 'Offre de bienvenue',
  kind: 'percent',
  value: 10,
  code: 'BIENVENUE10',
  channels: ['online', 'pos'],
  startsAt: null,
  endsAt: null,
  active: true,
  minSubtotalCents: 0,
  maxDiscountCents: 0,
  maxUsage: 0,
  usageCount: 0,
  offeredProductId: null,
  ...over,
});

const contexte = (over: Partial<PromotionContext> = {}): PromotionContext => ({
  subtotal: Money.fromCents(2_000),
  channel: 'online',
  code: 'BIENVENUE10',
  now: NOW,
  prixAuPanier: new Map(),
  ...over,
});

/** Le montant retenu, ou l'échec — les tests lisent l'un ou l'autre sans détour. */
const montant = (r: PromotionRule, c: PromotionContext): number | string => {
  const res = appliquerPromotion(r, c);
  return res.ok ? res.value.amount.cents : res.error.message;
};

describe('une promotion en pourcentage', () => {
  it('retire sa part du sous-total', () => {
    expect(montant(regle(), contexte())).toBe(200);
  });

  it('arrondit en faveur du client', () => {
    // 10 % de 19,99 € = 1,999 € → 1,99 €. Le centime va au client, comme
    // partout ailleurs dans le produit (`Money.percent`, remise fondateur).
    expect(montant(regle({ value: 10 }), contexte({ subtotal: Money.fromCents(1_999) }))).toBe(199);
  });

  it('refuse un taux aberrant plutôt que de le tronquer', () => {
    expect(montant(regle({ value: 150 }), contexte())).toMatch(/Taux de remise invalide/);
    expect(montant(regle({ value: 0 }), contexte())).toMatch(/Taux de remise invalide/);
  });
});

describe('une promotion en montant', () => {
  it('retire exactement ce qu’elle annonce', () => {
    expect(montant(regle({ kind: 'amount', value: 500 }), contexte())).toBe(500);
  });

  /**
   * LE TEST QUI JUSTIFIE TOUT LE MODULE.
   *
   * Un « −20 € » saisi par le restaurateur sur une commande à 12 € produirait
   * un total de −8 €. L'encaissement le lirait comme une somme à RENDRE : huit
   * euros sortis du tiroir pour une commande payée. C'est une erreur de saisie,
   * jamais un cadeau — la remise se borne donc au panier.
   */
  it('ne dépasse jamais le sous-total — un total négatif serait de l’argent rendu', () => {
    const r = regle({ kind: 'amount', value: 2_000 });
    expect(montant(r, contexte({ subtotal: Money.fromCents(1_200) }))).toBe(1_200);
  });

  it('refuse un montant non entier ou négatif', () => {
    expect(montant(regle({ kind: 'amount', value: -100 }), contexte())).toMatch(/invalide/);
    expect(montant(regle({ kind: 'amount', value: 12.5 }), contexte())).toMatch(/invalide/);
  });
});

describe('un produit offert', () => {
  const OFFERT = 'prod-frites';

  it('vaut le prix du produit au panier', () => {
    const r = regle({ kind: 'offered_item', offeredProductId: OFFERT });
    const c = contexte({ prixAuPanier: new Map([[OFFERT, Money.fromCents(390)]]) });
    expect(montant(r, c)).toBe(390);
  });

  /**
   * La nature était INAPPLICABLE par construction : le modèle proposait
   * « produit offert » sans jamais dire lequel. Le champ manquait, et l'écran
   * de création laissait pourtant le choisir dans une liste.
   */
  it('refuse une offre qui ne dit pas quel produit elle offre', () => {
    const r = regle({ kind: 'offered_item', offeredProductId: null });
    expect(montant(r, contexte())).toMatch(/n’indique pas quel produit/);
  });

  it('refuse d’offrir un produit absent du panier', () => {
    const r = regle({ kind: 'offered_item', offeredProductId: OFFERT });
    expect(montant(r, contexte({ prixAuPanier: new Map() }))).toMatch(/n’est pas dans la commande/);
  });
});

describe('les conditions', () => {
  it('exige le code quand la promotion en porte un', () => {
    expect(montant(regle(), contexte({ code: null }))).toMatch(/demande un code/);
    expect(montant(regle(), contexte({ code: 'AUTRE' }))).toMatch(/ne correspond à aucune offre/);
  });

  it('accepte le code à la casse et aux espaces près', () => {
    expect(montant(regle(), contexte({ code: '  bienvenue10 ' }))).toBe(200);
  });

  /**
   * Une promotion SANS code s'applique d'office. Elle ne doit surtout pas se
   * « débloquer » avec une chaîne vide envoyée au hasard — d'où deux branches
   * distinctes et non une comparaison unique.
   */
  it('s’applique d’office quand elle n’a pas de code', () => {
    expect(montant(regle({ code: null }), contexte({ code: null }))).toBe(200);
    expect(montant(regle({ code: null }), contexte({ code: 'PEU IMPORTE' }))).toBe(200);
  });

  it('respecte le canal', () => {
    const r = regle({ channels: ['pos'] });
    expect(montant(r, contexte({ channel: 'online' }))).toMatch(/pas valable pour les commandes en ligne/);
    expect(montant(r, contexte({ channel: 'pos' }))).toBe(200);
  });

  it('respecte les dates, bornes comprises', () => {
    const debut = new Date('2026-09-01T00:00:00.000Z');
    const fin = new Date('2026-08-20T00:00:00.000Z');
    expect(montant(regle({ startsAt: debut }), contexte())).toMatch(/pas encore commencé/);
    expect(montant(regle({ endsAt: fin }), contexte())).toMatch(/terminée/);
    // La borne haute est stricte : à la seconde exacte, l'offre est finie.
    expect(montant(regle({ endsAt: NOW }), contexte())).toMatch(/terminée/);
    // La borne basse est inclusive : à la seconde exacte, elle commence.
    expect(montant(regle({ startsAt: NOW }), contexte())).toBe(200);
  });

  it('exige le panier minimum, et dit lequel', () => {
    const r = regle({ minSubtotalCents: 2_500 });
    expect(montant(r, contexte())).toMatch(/au moins 25,00/);
    expect(montant(r, contexte({ subtotal: Money.fromCents(2_500) }))).toBe(250);
  });

  it('plafonne la remise', () => {
    const r = regle({ value: 50, maxDiscountCents: 500 });
    expect(montant(r, contexte({ subtotal: Money.fromCents(10_000) }))).toBe(500);
  });

  it('s’arrête au quota d’utilisations', () => {
    expect(montant(regle({ maxUsage: 100, usageCount: 100 }), contexte())).toMatch(
      /nombre d’utilisations/,
    );
    expect(montant(regle({ maxUsage: 100, usageCount: 99 }), contexte())).toBe(200);
    // `0` vaut illimité, jamais « épuisée dès la première commande ».
    expect(montant(regle({ maxUsage: 0, usageCount: 9_999 }), contexte())).toBe(200);
  });

  it('refuse une promotion désactivée', () => {
    expect(montant(regle({ active: false }), contexte())).toMatch(/n’est pas active/);
  });

  it('refuse une offre qui ne change rien plutôt que d’écrire une remise à zéro', () => {
    // Un pourcentage sur un panier vide : le total ne bouge pas, la ligne
    // « remise 0,00 € » sur le ticket n'apprendrait rien à personne.
    expect(montant(regle(), contexte({ subtotal: Money.fromCents(0) }))).toMatch(/ne change rien/);
  });
});

describe('ce que le ticket porte', () => {
  it('nomme l’offre et son code — « Remise » ne se vérifie pas', () => {
    const res = appliquerPromotion(regle(), contexte());
    expect(res.ok && res.value.toJSON()).toEqual({
      amount: 200,
      reason: 'BIENVENUE10 — Offre de bienvenue',
      promotionId: 'promo-1',
    });
  });

  it('sans code, le libellé reste lisible', () => {
    const res = appliquerPromotion(regle({ code: null, name: 'Happy hour' }), contexte());
    expect(res.ok && res.value.reason).toBe('Happy hour');
  });
});
