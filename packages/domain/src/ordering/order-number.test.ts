import { describe, expect, it } from 'vitest';
import { OrderNumber } from './order-number';
import { unwrap } from '../shared/result';

describe('OrderNumber — le numéro qu’on crie au comptoir', () => {
  it('s’affiche sur trois chiffres pour se lire de loin', () => {
    expect(unwrap(OrderNumber.create(42)).format()).toBe('042');
    expect(unwrap(OrderNumber.create(7)).format()).toBe('007');
    expect(unwrap(OrderNumber.create(128)).format()).toBe('128');
  });

  it('refuse un numéro nul ou négatif', () => {
    expect(OrderNumber.create(0).ok).toBe(false);
    const r = OrderNumber.create(-3);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('order.number.invalid');
  });

  it('refuse un numéro non entier', () => {
    expect(OrderNumber.create(12.5).ok).toBe(false);
  });

  it('refuse un numéro hors de la séquence journalière', () => {
    // Au-delà, le compteur n’a pas été remis à zéro : c’est un bug d’infra.
    expect(OrderNumber.create(10_000).ok).toBe(false);
    expect(OrderNumber.create(9999).ok).toBe(true);
  });

  it('deux numéros de même valeur désignent la même commande du jour', () => {
    expect(unwrap(OrderNumber.create(42)).equals(unwrap(OrderNumber.create(42)))).toBe(true);
  });
});
