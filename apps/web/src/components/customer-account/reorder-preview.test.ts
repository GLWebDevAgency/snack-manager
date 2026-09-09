import { describe, expect, it } from 'vitest';
import type { MenuProduct } from '../order/api';
import { previewReorder } from './reorder-preview';

const id = 'a'.repeat(24);
const product: MenuProduct = { id, name: 'Kebab fromage', description: '', price: 850, fromPrice: 850,
  variants: [{ key: 'galette', name: 'Galette', price: 900 }],
  groups: [{ key: 'fromage', name: 'Fromage', type: 'single', min: 1, max: 1, perVariant: null,
    choices: [{ key: 'chevre', name: 'Chèvre', priceDelta: 0 }] }],
  supplements: [{ key: 'extra', label: 'Extra', priceCents: 100 }],
  removables: [{ key: 'oignons', label: 'Oignons' }], tags: [], isNew: false, outOfStock: false, photoUrl: null, configurable: true };
const source = () => ({ productId: id as string | null, name: 'Ancien kebab', variantKey: 'galette' as string | null,
  variantName: 'Galette', qty: 2, unitPrice: 850,
  options: [{ groupKey: 'fromage' as string | null, choiceKey: 'chevre' as string | null }], removed: ['oignons'] });
const preview = (line = source(), current = product) => previewReorder([line], new Map([[id, current]]));

describe('recommander — sélections exactes aux conditions actuelles', () => {
  it('reprend les choix exacts et annonce le nouveau prix, sans recopier instructions ou identité historique', () => {
    const result = preview();
    expect(result.subtotal).toBe(1800);
    expect(result.entries[0]).toMatchObject({ reason: null, priceChanged: true, previousUnitPrice: 850,
      line: { name: 'Kebab fromage', variantKey: 'galette', qty: 2, unitPrice: 900, note: null, removed: ['oignons'] } });
    expect(result.lines[0].options).toEqual([{ groupKey: 'fromage', groupName: 'Fromage', choiceKey: 'chevre', name: 'Chèvre', priceDelta: 0 }]);
  });
  it('inclut les suppléments dans chaque prix affiché', () => {
    const line = source(); line.options.push({ groupKey: 'supplements', choiceKey: 'extra' });
    expect(preview(line).subtotal).toBe(2000);
  });
  it.each(['reference', 'product', 'stock', 'variant', 'option', 'removed', 'required', 'duplicate', 'quantity'] as const)('écarte %s sans substitution silencieuse', fault => {
    const line = source(), current = structuredClone(product);
    if (fault === 'reference') line.options[0].choiceKey = null;
    if (fault === 'product') line.productId = 'b'.repeat(24);
    if (fault === 'stock') current.outOfStock = true;
    if (fault === 'variant') current.variants = [{ key: 'pain', name: 'Pain', price: 850 }];
    if (fault === 'option') current.groups[0].choices = [{ key: 'bleu', name: 'Bleu', priceDelta: 0 }];
    if (fault === 'removed') current.removables = [];
    if (fault === 'required') current.groups.push({ ...current.groups[0], key: 'pain' });
    if (fault === 'duplicate') line.options.push({ ...line.options[0] });
    if (fault === 'quantity') line.qty = 51;
    const result = preview(line, current);
    expect(result.lines).toEqual([]); expect(result.subtotal).toBe(0);
    expect(result.entries[0].reason).not.toBeNull();
  });
  it('préserve les articles encore disponibles et leur ordre, avec une ligne par ancienne ligne', () => {
    const rows = [source(), { ...source(), productId: null }, source()];
    const result = previewReorder(rows, new Map([[id, product]]));
    expect(result.entries).toHaveLength(3); expect(result.lines).toHaveLength(2);
    expect(new Set(result.lines.map(line => line.lineId)).size).toBe(2);
    expect(result.subtotal).toBe(3600);
  });
  it('ne confond pas une absence de variante avec la nouvelle variante par défaut', () => {
    expect(preview({ ...source(), variantKey: null }).lines).toEqual([]);
  });
  it('ne propose aucun total monétaire non sûr', () => {
    expect(preview(source(), { ...product, variants: [{ ...product.variants[0], price: Number.MAX_SAFE_INTEGER }] }).lines).toEqual([]);
  });
  it('respecte la borne de 50 unités du checkout sans tronquer une quantité historique', () => {
    expect(preview({ ...source(), qty: 50 }).lines[0].qty).toBe(50);
    expect(preview({ ...source(), qty: 51 }).lines).toEqual([]);
  });
  it('refuse des retraits historiques au-delà du contrat de commande même si le catalogue les conserve', () => {
    const removed = Array.from({ length: 21 }, (_, i) => `retrait-${i}`);
    expect(preview({ ...source(), removed }, { ...product, removables: removed.map(key => ({ key, label: key })) }).lines).toEqual([]);
  });
});
