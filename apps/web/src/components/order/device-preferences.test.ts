import { describe, expect, it } from 'vitest';
import type { MenuProduct } from './api';
import { draftBlocker, draftToLine, newDraft } from './cart';
import { applyDevicePreferences, DEVICE_PREFERENCES_TTL_MS, parseDevicePreferences, reconcileDevicePreferences } from './device-preferences';

const product: MenuProduct = { id: 'a'.repeat(24), name: 'Menu', description: '', price: 800, fromPrice: 800, variants: [], tags: [], isNew: false, outOfStock: false, photoUrl: null, configurable: true,
  removables: [{ key: 'oignons', label: 'Oignons' }], supplements: [{ key: 'samourai', label: 'Extra sauce', priceCents: 50 }],
  groups: [{ key: 'sauces', name: 'Sauces', type: 'multi', min: 1, max: 2, perVariant: { small: { max: 1 } },
    choices: [{ key: 'samourai', name: 'Samouraï', priceDelta: 0 }, { key: 'blanche', name: 'Blanche', priceDelta: 0 }] }] };
const preferences = { removed: ['oignons', 'absent'], sauces: ['absente', 'blanche', 'samourai'] };
describe('préférences explicites de cet appareil', () => {
  it('n’applique que les clés existantes avec les limites de variante, sans toucher aux extras, note ou quantité', () => {
    const draft = { ...newDraft(product), variantKey: 'small', note: 'Saisie conservée', qty: 2 };
    const next = applyDevicePreferences(draft, preferences);
    expect(next.removed).toEqual(['oignons']); expect(next.picked.sauces).toEqual(['blanche']);
    expect(next.picked.supplements).toBeUndefined(); expect(next.note).toBe(draft.note); expect(next.qty).toBe(2); expect(next.variantKey).toBe('small');
    expect(draft.removed).toEqual([]); expect(draft.picked.sauces).toEqual([]);
  });
  it('ne remplace jamais les choix d’une ligne en modification', () => {
    const draft = { ...newDraft(product), lineId: 'existing', removed: [], picked: { sauces: ['samourai'] } };
    expect(applyDevicePreferences(draft, preferences)).toBe(draft);
  });
  it('laisse une réponse obligatoire absente à choisir, sans prix ou voisin inventé', () => {
    const next = applyDevicePreferences(newDraft(product), { removed: [], sauces: ['absente'] });
    expect(draftBlocker(next)).toBe('Choisissez : Sauces');
    const configured = applyDevicePreferences(newDraft(product), preferences);
    expect(draftToLine(configured).unitPrice).toBe(800);
    expect(draftToLine(configured).options.every(option => option.groupKey === 'sauces')).toBe(true);
  });
  it('réconcilie une préférence sans nom contre la carte actuelle', () => {
    expect(reconcileDevicePreferences(preferences, [{ id: 'cat', name: 'Menus', products: [product] }])).toEqual({ removed: ['oignons'], sauces: ['blanche', 'samourai'] });
  });
  it('refuse une autre portée, les données privées, les doublons et une durée altérée ou échue', () => {
    const now = 1_800_000_000_000;
    const value = { v: 1, tenant: 'recette', savedAt: now, expiresAt: now + DEVICE_PREFERENCES_TTL_MS, preferences };
    expect(parseDevicePreferences(JSON.stringify(value), 'recette', now)).toEqual(preferences);
    for (const invalid of [{ ...value, tenant: 'autre' }, { ...value, token: 'secret' }, { ...value, expiresAt: value.expiresAt + 1 },
      { ...value, preferences: { ...preferences, sauces: ['blanche', 'blanche'] } }, { ...value, preferences: { ...preferences, phone: 'private' } }]) {
      expect(parseDevicePreferences(JSON.stringify(invalid), 'recette', now)).toBeNull();
    }
    expect(parseDevicePreferences(JSON.stringify(value), 'recette', value.expiresAt)).toBeNull();
    expect(parseDevicePreferences(JSON.stringify(value), 'recette', now - 1)).toBeNull();
  });
});
