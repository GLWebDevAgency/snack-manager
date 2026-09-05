import { describe, expect, it } from 'vitest';
import { ScreenPresentationSchema } from '@sm/contracts';
import { renderScreenContent } from './render-screen-content';
import { boardProduct, boardSnapshot, scene, storedScreen } from './screens.fakes';

const midi = new Date('2026-08-19T10:30:00Z');
const cat = 'cat-tacos';
const category = scene({ kind: 'category', categoryId: cat });
const products = ['p1', 'p2', 'p3'].map((id) => boardProduct({ id }));
const snapshot = () => boardSnapshot({ categories: [{ id: cat, name: 'Tacos', featuredProductIds: ['p3', 'p1', 'p2'] }], products: [...products] });

describe('Les mises en avant de la carte composent les scènes TV', () => {
  it('garde un groupe de trois, dans l’ordre choisi, après toutes les pages de sa catégorie', () => {
    const data = snapshot();
    data.products.push(...Array.from({ length: 7 }, (_, i) => boardProduct({ id: `extra-${i}` })));
    const content = renderScreenContent(storedScreen({ playlist: [category] }), data, midi);
    expect(content.scenes.map((s) => s.kind)).toEqual(['category', 'category', 'featured']);
    expect(content.scenes[2]?.products.map((p) => p.id)).toEqual(['p3', 'p1', 'p2']);
    expect(content.scenes[2]?.id).toBe(`featured:category:${cat}`);
  });
  it('une catégorie répétée n’ajoute pas deux mises en avant et leur id survit à un déplacement dans la boucle', () => {
    const content = renderScreenContent(storedScreen({ playlist: [scene({ kind: 'custom', title: 'Bonjour' }), category, category] }), snapshot(), midi);
    expect(content.scenes.filter((s) => s.kind === 'featured').map((s) => s.id)).toEqual([`featured:category:${cat}`]);
  });
  it('écarte ruptures, mauvais service, catégories absentes et références déplacées', () => {
    const data = { ...snapshot(), products: [boardProduct({ id: 'p1', outOfStock: true }), boardProduct({ id: 'p2', tags: ['soir'] }), boardProduct({ id: 'p3', categoryId: 'cat-desactivee' })] };
    expect(renderScreenContent(storedScreen(), data, midi).scenes.some((s) => s.kind === 'featured')).toBe(false);
    expect(renderScreenContent(storedScreen(), { ...data, categories: [] }, midi).scenes.flatMap((s) => s.products)).toEqual([]);
  });
  it('évite les doublons avec une sélection manuelle existante sans lui imposer trois produits', () => {
    const data = snapshot();
    data.products.push(...Array.from({ length: 5 }, (_, i) => boardProduct({ id: `extra-${i}` })));
    const manual = scene({ kind: 'featured', productIds: ['p1', ...data.products.slice(3).map((p) => p.id)] });
    const content = renderScreenContent(storedScreen({ playlist: [category, manual] }), data, midi);
    const groups = content.scenes.filter((s) => s.kind === 'featured');
    expect(groups.map((s) => s.products.map((p) => p.id))).toEqual([['p3', 'p2'], manual.productIds]);
  });
  it('Nouveau ne sélectionne rien et la rupture reste indiquée dans la carte ordinaire', () => {
    const data = boardSnapshot({ products: [boardProduct({ id: 'new', isNew: true, outOfStock: true })] });
    const content = renderScreenContent(storedScreen(), data, midi);
    expect(content.scenes.map((s) => s.kind)).toEqual(['category']);
    expect(content.scenes[0]?.products[0]?.outOfStock).toBe(true);
  });
  it('la présentation change l’empreinte, sans altérer l’identité globale', () => {
    const screen = storedScreen();
    const data = snapshot();
    const original = renderScreenContent(screen, data, midi);
    const changed = renderScreenContent({ ...screen, presentation: ScreenPresentationSchema.parse({ priceScale: 'large' }) }, data, midi);
    expect(changed.contentHash).not.toBe(original.contentHash);
    expect(changed.masque).toEqual(original.masque);
  });
});
