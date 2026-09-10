import { describe, expect, it, vi, afterEach } from 'vitest';
import { DIRECTIONS } from '@sm/contracts';
import { parseBrandDraft, readBrandDraft, writeBrandDraft, clearBrandDraft } from './brand-draft';
import { parseNameDraft, readNameDraft, writeNameDraft, clearNameDraft } from './name-draft';
import { menuForPresentation, presentationPatch, readPresentationDrafts } from './menu-presentation';

afterEach(() => vi.unstubAllGlobals());
const now = 1_000_000_000;
const base = DIRECTIONS.nuit;
const draft = { ...base, tagline: 'La cuisine de notre quartier', hero: 'https://media.example/accueil.png' };

describe('brouillons du pilotage : durées, invalidation et séparation établissement', () => {
  it('conserve le masque complet avec sa base pour détecter un conflit de reprise', () => {
    expect(parseBrandDraft(JSON.stringify({ base, draft, at: now - 10 }), now)).toEqual({ base, draft, at: now - 10 });
  });
  it.each([null, '{', JSON.stringify({ base, draft: { ...draft, mode: 'unknown' }, at: now }), JSON.stringify({ base, draft, at: now + 1 }), JSON.stringify({ base, draft, at: now - 8 * 3_600_000 })])('ignore un brouillon marque invalide, expiré ou futur %s', raw => {
    expect(parseBrandDraft(raw, now)).toBeNull();
  });
  it('sépare A/B et efface uniquement le brouillon confirmé ou annulé', () => {
    const values = new Map<string, string>();
    vi.stubGlobal('sessionStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) });
    writeBrandDraft('A', base, draft); writeBrandDraft('B', base, { ...base, tagline: 'B' });
    writeNameDraft('A', 'Restaurant A', 'Nouveau nom A'); writeNameDraft('B', 'Restaurant B', 'Nouveau nom B');
    expect(readBrandDraft('A')?.draft).toEqual(draft); expect(readNameDraft('A')?.draft).toBe('Nouveau nom A');
    clearBrandDraft('A'); clearNameDraft('A');
    expect(readBrandDraft('A')).toBeNull(); expect(readNameDraft('A')).toBeNull();
    expect(readBrandDraft('B')?.draft.tagline).toBe('B'); expect(readNameDraft('B')?.draft).toBe('Nouveau nom B');
  });
  it('ne bloque jamais la sauvegarde serveur si le navigateur refuse sessionStorage', () => {
    const fail = () => { throw new Error('Storage blocked'); };
    vi.stubGlobal('sessionStorage', { getItem: fail, setItem: fail, removeItem: fail });
    expect(() => { writeBrandDraft('A', base, draft); clearBrandDraft('A'); writeNameDraft('A', 'A', 'B'); clearNameDraft('A'); }).not.toThrow();
    expect(readBrandDraft('A')).toBeNull(); expect(readNameDraft('A')).toBeNull();
  });
  it('borne le nom restauré et exige une base utilisable pour la résolution de conflit', () => {
    expect(parseNameDraft(JSON.stringify({ base: 'A', draft: 'B', at: now }), now)?.draft).toBe('B');
    for (const value of [{ draft: 'B', at: now }, { base: 'A', draft: 4, at: now }, { base: 'A', draft: 'B', at: now + 1 }, { base: 'A', draft: 'B', at: now - 8 * 3_600_000 }]) expect(parseNameDraft(JSON.stringify(value), now)).toBeNull();
  });
});

describe('présentation de carte : mutations limitées et brouillons périmés', () => {
  const menu = menuForPresentation({ categories: [{ _id: 'category', name: 'Plats', featuredProductIds: ['p'], featuredRevision: 7, products: [{ _id: 'p', name: 'Plat réel', price: 1290, variants: [{ key: 'large', name: 'Grande', price: 1490 }], optionGroups: [], medias: ['photo'], outOfStock: true, active: true, photoKind: 'cutout', popularOverride: true }] }] });
  const product = menu.categories[0]!.products[0]!;
  it('ne renvoie que le delta photo/badge sans prix, variantes, médias, stock ou éditorial', () => {
    expect(presentationPatch(product, { photoKind: 'cover', popularOverride: null })).toEqual({ photoKind: 'cover', popularOverride: null });
    expect(presentationPatch(product, { photoKind: 'cutout', popularOverride: true })).toEqual({});
    expect(menu.categories[0]!.featuredProductIds).toEqual(['p']); expect(menu.categories[0]!.featuredRevision).toBe(7);
    expect(product).toMatchObject({ price: 1290, variants: [{ key: 'large', name: 'Grande', price: 1490 }], outOfStock: true, medias: ['photo'] });
  });
  it('écarte les anciennes formes sans base, les corruptions et les entrées expirées', () => {
    const record = { base: { photoKind: 'cutout', popularOverride: null }, draft: { photoKind: 'cover', popularOverride: false }, at: now };
    expect(readPresentationDrafts(JSON.stringify({ valid: record, legacy: record.draft, invalid: { ...record, draft: { photoKind: 'stretch', popularOverride: null } }, expired: { ...record, at: now - 8 * 3_600_000 }, future: { ...record, at: now + 1 } }), now)).toEqual({ valid: record });
    expect(readPresentationDrafts('[')).toEqual({}); expect(readPresentationDrafts('[]')).toEqual({});
  });
});
