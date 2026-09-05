import { describe, expect, it } from 'vitest';
import type { OrderLine } from '@sm/client-core';
import { optionsText } from './format';

describe('libellés des choix en cuisine', () => {
  it('affiche le fromage inclus aussi bien que le supplément payant et le pain', () => {
    const line: OrderLine = {
      productId: 'kebab-fromage', name: 'Kebab Fromage', qty: 1, unitPrice: 1000, lineTotal: 1000,
      options: [
        { groupKey: 'fromage', choiceKey: 'raclette', name: 'Raclette', priceDelta: 0 },
        { groupKey: 'pain', choiceKey: 'galette', name: 'Galette', priceDelta: 50 },
        { groupKey: 'supplements', choiceKey: 'bacon', name: 'Bacon', priceDelta: 100 },
      ],
      removed: ['crudites'],
    };
    expect(optionsText(line)).toBe('Raclette · Galette · Bacon');
  });
});
