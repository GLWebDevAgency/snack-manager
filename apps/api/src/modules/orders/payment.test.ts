import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { resolvePayment } from './payment';
import { newTrackingToken, trackingFilter } from './tracking';

/**
 * Le défaut reproduit en service réel : encaissement carte au POS, écran
 * « Payé (carte bancaire) », base à `method=counter` / `status=pending`.
 * Le Z du soir et la compta partaient donc faux dès la première commande.
 */
describe('Modèle de paiement à la création', () => {
  it('une commande POS réglée par carte est payée immédiatement', () => {
    const payment = resolvePayment('pos', { method: 'counter', tender: 'card' }, 1250);

    expect(payment.status).toBe('paid');
    expect(payment.tender).toBe('card');
    // L'argent est encaissé au comptoir, pas à la remise du plat.
    expect(payment.method).toBe('counter');
  });

  it('un titre-restaurant encaisse sur-le-champ, sans rendu monnaie', () => {
    const payment = resolvePayment('pos', { method: 'counter', tender: 'meal_voucher' }, 1250);

    expect(payment.status).toBe('paid');
    expect(payment.tender).toBe('meal_voucher');
    // Le rendu monnaie n'existe que pour les espèces : un titre ne rend rien.
    expect(payment.cashReceived).toBeNull();
    expect(payment.changeGiven).toBeNull();
  });

  it('un encaissement espèces calcule le rendu monnaie', () => {
    const payment = resolvePayment(
      'pos',
      { method: 'counter', tender: 'cash', cashReceived: 2000 },
      1250,
    );

    expect(payment.status).toBe('paid');
    expect(payment.cashReceived).toBe(2000);
    expect(payment.changeGiven).toBe(750); // 20,00 € − 12,50 €
  });

  it('le rendu vient du total serveur, jamais du montant annoncé par le poste', () => {
    // La file offline rejoue un corps calculé sur un menu qui a pu changer :
    // c'est le total recalculé qui fait foi, pas le `changeGiven` transmis.
    const payment = resolvePayment(
      'pos',
      { method: 'counter', tender: 'cash', cashReceived: 2000, changeGiven: 9999 },
      1800,
    );

    expect(payment.changeGiven).toBe(200);
  });

  it('un compte juste ne rend rien', () => {
    const payment = resolvePayment(
      'pos',
      { method: 'counter', tender: 'cash', cashReceived: 1250 },
      1250,
    );

    expect(payment.changeGiven).toBe(0);
  });

  it('des espèces insuffisantes sont refusées plutôt que rendues en négatif', () => {
    expect(() =>
      resolvePayment('pos', { method: 'counter', tender: 'cash', cashReceived: 500 }, 1250),
    ).toThrow(BadRequestException);
  });

  it('une commande téléphone encaissée à la caisse est payée comme au comptoir', () => {
    expect(resolvePayment('phone', { method: 'counter', tender: 'cash' }, 900).status).toBe('paid');
  });

  it("« à encaisser au retrait » reste en attente : rien n'est encore perçu", () => {
    const payment = resolvePayment('pos', { method: 'counter', tender: null }, 1250);

    expect(payment.status).toBe('pending');
    expect(payment.tender).toBeNull();
  });

  it('le paiement en ligne reste en attente jusqu’à confirmation Stripe', () => {
    const payment = resolvePayment('online', { method: 'online' }, 1250);

    expect(payment.status).toBe('pending');
    expect(payment.tender).toBe('online');
  });

  it("un client en ligne ne peut pas se déclarer payé en espèces", () => {
    // Route publique : le corps vient du navigateur, il ne fait pas foi.
    const payment = resolvePayment(
      'online',
      { method: 'online', tender: 'cash', cashReceived: 5000 },
      1250,
    );

    expect(payment.status).toBe('pending');
    expect(payment.tender).toBe('online');
    expect(payment.changeGiven).toBeNull();
  });
});

describe('Jeton de suivi', () => {
  it('fait 32 caractères URL-safe et ne se répète pas', () => {
    const a = newTrackingToken();
    const b = newTrackingToken();

    expect(a).toHaveLength(32);
    expect(a).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(a).not.toBe(b);
  });

  const id = '68a3f1c2b4d5e6f7a8b9c0d1';

  it('accepte un couple id + jeton', () => {
    expect(trackingFilter(id, 'jeton')).toEqual({ _id: id, trackingToken: 'jeton' });
  });

  it('rejette un jeton absent, vide ou blanc', () => {
    expect(trackingFilter(id, undefined)).toBeNull();
    expect(trackingFilter(id, '')).toBeNull();
    expect(trackingFilter(id, '   ')).toBeNull();
  });

  it('rejette un opérateur Mongo déguisé en paramètre de requête', () => {
    // Express parse `?t[$ne]=null` en objet : passé au filtre, il renverrait
    // la première commande venue.
    expect(trackingFilter(id, { $ne: null })).toBeNull();
    expect(trackingFilter(id, ['a', 'b'])).toBeNull();
  });

  it('rejette un identifiant qui n’est pas un ObjectId', () => {
    expect(trackingFilter('pas-un-id', 'jeton')).toBeNull();
  });
});
