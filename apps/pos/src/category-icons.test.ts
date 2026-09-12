import { describe, expect, it } from 'vitest';
import { categoryIcon } from './category-icons';

describe('repères de catégories POS du kit', () => {
  it.each([
    ['Compose ton Tacos', 'tacos'], ['Paninis', 'panini'], ['Le Bowl', 'bowl'],
    ['Boissons', 'cup'], ['Milkshakes', 'cup'], ['Desserts', 'dessert'],
    ['Salades', 'leaf'], ['Gourmets Burgers', 'burger'], ['Smash burgers', 'smash'],
    ['Frites', 'fries'], ['Pizza', 'pizza'], ['Nouilles', 'noodles'],
    ['Riz sauté', 'rice'], ['Curry', 'curry'], ['Hot Dogs', 'dog'],
    ['Sandwichs', 'sandwich'], ['Box à Partager', 'box'],
  ])('%s porte son symbole, pas la flamme ou un ticket générique', (category, icon) => {
    expect(categoryIcon(category)).toBe(icon);
  });

  it('normalise uniquement la typographie, sans deviner une recette par sous-chaîne', () => {
    expect(categoryIcon('  CAFÉS  ')).toBe('coffee');
    expect(categoryIcon('Bun’s')).toBe('burger');
    expect(categoryIcon('Signature du chef')).toBe('menu');
    expect(categoryIcon('La boisson du burger')).toBe('menu');
    expect(categoryIcon('Nouvelle catégorie')).toBe('menu');
  });
});
