import { describe, expect, it } from 'vitest';
import { Money } from './money';
import { InvariantViolation } from './errors';

describe('Money', () => {
  it('additionne sans erreur de flottant', () => {
    // 0.1 + 0.2 en flottant donne 0.30000000000000004 : c'est exactement
    // le bug que le stockage en centimes élimine.
    const total = Money.fromCents(10).plus(Money.fromCents(20));
    expect(total.cents).toBe(30);
  });

  it('lit une saisie française et anglaise', () => {
    const fr = Money.parse('9,50');
    const en = Money.parse('9.50');
    const withCurrency = Money.parse('12,90 €');
    expect(fr.ok && fr.value.cents).toBe(950);
    expect(en.ok && en.value.cents).toBe(950);
    expect(withCurrency.ok && withCurrency.value.cents).toBe(1290);
  });

  it('refuse une saisie illisible', () => {
    const r = Money.parse('à définir');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('money.invalid');
  });

  it('multiplie par une quantité', () => {
    expect(Money.fromCents(890).times(3).cents).toBe(2670);
  });

  it('somme une liste de lignes', () => {
    const lines = [Money.fromCents(950), Money.fromCents(1250), Money.fromCents(350)];
    expect(Money.sum(lines).format()).toBe('25,50 €');
  });

  it('applique une remise arrondie au profit du client', () => {
    // 10 % de 9,95 € = 0,995 € → on retient 0,99 € (le client paie moins).
    expect(Money.fromCents(995).percent(10).cents).toBe(99);
  });

  it('formate à la française', () => {
    expect(Money.fromCents(950).format()).toBe('9,50 €');
    expect(Money.fromCents(1000).format()).toBe('10,00 €');
    expect(Money.fromCents(5).format()).toBe('0,05 €');
    expect(Money.fromCents(-250).format()).toBe('-2,50 €');
  });

  it('calcule une part en pourcentage', () => {
    // Coût matière 1,80 € sur un prix de 7,50 € → 24 % de food cost.
    expect(Money.fromCents(180).ratioOf(Money.fromCents(750))).toBe(24);
  });

  it('rejette un montant non entier', () => {
    expect(() => Money.fromCents(9.5)).toThrow(InvariantViolation);
  });
});
