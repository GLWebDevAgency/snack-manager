import { describe, expect, it } from 'vitest';
import { unwrap } from '../shared/result';
import { Quantity } from './units';

const qty = (value: number, unit: 'g' | 'kg' | 'ml' | 'l' | 'pcs'): Quantity =>
  unwrap(Quantity.of(value, unit));

describe('Quantity', () => {
  it('ramène les grammes au kilo, unité d’achat de la viande', () => {
    // 150 g de viande kebab se paient sur un prix au kilo : sans conversion,
    // la ligne coûterait 150 fois le prix du kilo.
    expect(qty(150, 'g').toBase().value).toBe(0.15);
    expect(qty(150, 'g').toBase().unit).toBe('kg');
  });

  it('ramène les millilitres au litre', () => {
    expect(qty(40, 'ml').toBase().value).toBe(0.04);
    expect(qty(40, 'ml').toBase().unit).toBe('l');
  });

  it('laisse les pièces telles quelles', () => {
    expect(qty(2, 'pcs').toBase().value).toBe(2);
  });

  it('fait l’aller-retour sans bruit de flottant', () => {
    // 150 / 1000 * 1000 vaut 150.00000000000003 en flottant brut : la fiche
    // recette afficherait une quantité absurde.
    expect(unwrap(qty(150, 'g').in('kg')).value).toBe(0.15);
    expect(unwrap(qty(0.15, 'kg').in('g')).value).toBe(150);
  });

  it('refuse de convertir une masse en volume', () => {
    // Il faudrait la densité de l'ingrédient, que personne ne saisit.
    const impossible = qty(150, 'g').in('l');
    expect(impossible.ok).toBe(false);
    if (!impossible.ok) {
      expect(impossible.error.code).toBe('unit.incompatible');
      expect(impossible.error.message).toContain('densité');
    }
  });

  it('refuse une quantité nulle ou négative', () => {
    // Une ligne à 0 g est une ligne oubliée, pas un choix de recette.
    const zero = Quantity.of(0, 'g');
    expect(zero.ok).toBe(false);
    if (!zero.ok) expect(zero.error.code).toBe('quantity.invalid');
    expect(Quantity.of(-10, 'g').ok).toBe(false);
  });

  it('additionne deux pesées de la même grandeur', () => {
    // 150 g de kebab + 0,1 kg de merguez sur un même tacos.
    const total = unwrap(qty(150, 'g').plus(qty(0.1, 'kg')));
    expect(total.value).toBe(250);
    expect(total.unit).toBe('g');
  });

  it('affiche la quantité à la française', () => {
    expect(qty(1.5, 'kg').format()).toBe('1,5 kg');
    expect(qty(150, 'g').format()).toBe('150 g');
    expect(qty(1, 'pcs').format()).toBe('1 pièce');
    expect(qty(2, 'pcs').format()).toBe('2 pièces');
  });
});
