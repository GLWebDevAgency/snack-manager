import { describe, expect, it } from 'vitest';
import type { OptionGroup, SelectedOption } from '@sm/client-core';
import { optionsForVariant } from './quick-config-options';

const groups: OptionGroup[] = [{ key: 'fromage', name: 'Fromage', type: 'single', min: 1, max: 1,
  choices: [{ key: 'raclette', name: 'Raclette', priceDelta: 0 }], perVariant: { grand: { priceDelta: 50 } } }];
const options: SelectedOption[] = [
  { groupKey: 'fromage', choiceKey: 'raclette', name: 'Raclette', priceDelta: 0 },
  { groupKey: 'supplements', choiceKey: 'bacon', name: 'Bacon', priceDelta: 100 },
];

describe('options POS au changement de variante', () => {
  it('préserve le supplément dédié, distinct du fromage inclus', () => {
    expect(optionsForVariant(groups, options, 'grand')).toEqual([{ ...options[0], priceDelta: 50 }, options[1]]);
  });
  it('revient au vrai prix inclus après une variante qui avait une surcharge', () => {
    const grand = optionsForVariant(groups, options, 'grand');
    expect(optionsForVariant(groups, grand, 'standard')).toEqual(options);
  });
  it('respecte le nouveau plafond sans tronquer les suppléments hors groupe', () => {
    const muted = [{ ...groups[0], perVariant: { sans: { min: 0, max: 0 } } }];
    expect(optionsForVariant(muted, options, 'sans')).toEqual([options[1]]);
  });
});
