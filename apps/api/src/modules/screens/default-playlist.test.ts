import { describe, expect, it } from 'vitest';
import { buildDefaultPlaylist } from './default-playlist';
import { boardProduct } from './screens.fakes';

const CATEGORIES = [
  { id: 'cat-tacos', name: 'Tacos' },
  { id: 'cat-burgers', name: 'Burgers' },
  { id: 'cat-hiver', name: 'Carte d’hiver' },
];

describe('Playlist par défaut', () => {
  it('ouvre sur les offres, puis déroule une scène par catégorie remplie', () => {
    // La promesse du produit : brancher une clé HDMI, saisir six caractères,
    // et voir sa carte. Rien à configurer.
    const playlist = buildDefaultPlaylist(CATEGORIES, [
      boardProduct({ id: 'p1', categoryId: 'cat-tacos' }),
      boardProduct({ id: 'p2', categoryId: 'cat-burgers' }),
    ]);

    expect(playlist.map((s) => s.kind)).toEqual(['promo', 'category', 'category']);
    expect(playlist.map((s) => s.title)).toEqual(['Offres du moment', 'Tacos', 'Burgers']);
  });

  it('écarte les catégories sans produit actif', () => {
    const playlist = buildDefaultPlaylist(CATEGORIES, [
      boardProduct({ id: 'p1', categoryId: 'cat-tacos' }),
    ]);
    expect(playlist.map((s) => s.categoryId)).toEqual([null, 'cat-tacos']);
  });

  it('pose la scène des offres même sans promotion existante', () => {
    // Sinon la première promo créée par le restaurateur n'apparaîtrait sur
    // aucun écran déjà installé — et il conclurait que ça ne marche pas.
    const playlist = buildDefaultPlaylist([], []);
    expect(playlist.map((s) => s.kind)).toEqual(['promo']);
  });

  it('respecte l’ordre de la carte et un rythme lent', () => {
    const playlist = buildDefaultPlaylist(CATEGORIES, [
      boardProduct({ id: 'p1', categoryId: 'cat-burgers' }),
      boardProduct({ id: 'p2', categoryId: 'cat-tacos' }),
    ]);

    // L'ordre vient des catégories (déjà triées par le dépôt), pas des produits.
    expect(playlist.map((s) => s.title)).toEqual(['Offres du moment', 'Tacos', 'Burgers']);
    // On regarde l'écran 10 à 30 secondes : chaque scène tient 8 s au minimum.
    expect(playlist.every((s) => s.durationMs >= 8_000)).toBe(true);
  });

  it('ne rattache jamais un produit orphelin (categoryId null)', () => {
    const playlist = buildDefaultPlaylist(CATEGORIES, [
      boardProduct({ id: 'p1', categoryId: null }),
    ]);
    expect(playlist.map((s) => s.kind)).toEqual(['promo']);
  });
});
