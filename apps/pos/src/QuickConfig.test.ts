import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { Product } from '@sm/client-core';
import { QuickConfig, type ConfigDraft } from './QuickConfig';
import type { Brand } from './theme';

// Adaptateurs RN/contrôles seulement : la configuration, ses règles et son
// état initial sont ceux du composant utilisé par la caisse.
vi.mock('react-native', () => ({
  View: ({ children }: { children: ReactNode }) => createElement('div', null, children),
  ScrollView: ({ children }: { children: ReactNode }) => createElement('div', null, children),
  Text: ({ children }: { children: ReactNode }) => createElement('span', null, children),
  Platform: { select: (values: Record<string, unknown>) => values.web ?? values.default },
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  useWindowDimensions: () => ({ width: 1280, height: 800 }),
}));
vi.mock('./ui', () => ({
  Overlay: ({ children }: { children: ReactNode }) => createElement('section', null, children),
  PanelHead: () => null, Field: () => null, Stepper: () => null,
  Chip: ({ label, detail, on, disabled }: { label: string; detail?: string; on: boolean; disabled?: boolean }) =>
    createElement('button', { 'aria-pressed': on, disabled }, label, detail ? createElement('small', null, detail) : null),
  Btn: ({ label, disabled }: { label: string; disabled?: boolean }) => createElement('button', { disabled }, label),
}));

const product: Product = {
  _id: 'kebab-fromage', name: 'Kebab Fromage', price: 850, variants: [],
  optionGroups: [{ key: 'fromage', name: 'Fromage', type: 'single', min: 1, max: 1,
    choices: ['Cheddar', 'Chèvre', 'Bleu', 'Boursin', 'Raclette'].map(name => ({ key: name, name, priceDelta: 0 })) }],
  removables: [{ key: 'salade', label: 'Salade' }, { key: 'tomate', label: 'Tomate' },
    { key: 'oignons', label: 'Oignons' }, { key: 'crudites', label: 'Crudités' }],
  supplements: [{ key: 'bacon', label: 'Bacon', priceCents: 100 }],
};
const brand: Brand = { accent: '#dec38e', onAccent: '#12100d', tint: '#222', tintStrong: '#333', name: 'Classfood', initial: 'C' };

function render(p = product, initial?: ConfigDraft) {
  return renderToStaticMarkup(createElement(QuickConfig, { product: p, brand, initial, onClose: vi.fn(), onSubmit: vi.fn() }));
}

describe('configuration POS : fromage inclus et crudités', () => {
  it('rend les choix inclus sans présélection et bloque la validation incomplète', () => {
    const html = render();
    expect(html).toContain('aria-pressed="false">Cheddar<small>Inclus</small>');
    expect(html.match(/>Inclus</g)).toHaveLength(5);
    expect(html).toContain('<button disabled="">Complétez la configuration</button>');
    expect(html).toContain('Bacon +1,00');
  });
  it('propose Complet explicite et seulement les retraits du menu', () => {
    const html = render();
    expect(html).toContain('aria-pressed="true">Complet</button>');
    for (const label of ['salade', 'tomate', 'oignons', 'crudités']) expect(html).toContain(`sans ${label}`);
    expect(render({ ...product, removables: [] })).not.toContain('sans crudités');
  });
  it('restitue sans crudités en modification sans afficher Complet sélectionné', () => {
    const html = render(product, { variantKey: null, qty: 1, note: '', options: [], removed: ['crudites'] });
    expect(html).toContain('aria-pressed="false">Complet</button>');
    expect(html).toContain('aria-pressed="true">sans crudités</button>');
  });
});
