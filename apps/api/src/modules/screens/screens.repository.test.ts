import { describe, expect, it } from 'vitest';
import { toStored, type RawScreen } from './screens.repository';

/** Un document tel que `.lean()` le rend — sans défaut de schéma appliqué. */
function brut(patch: Partial<RawScreen> = {}): RawScreen {
  return {
    _id: '65f000000000000000000010',
    tenantId: '65f000000000000000000001',
    name: 'Comptoir',
    playlist: [],
    ...patch,
  } as unknown as RawScreen;
}

describe('toStored — un écran antérieur garde son apparence', () => {
  it('sans champ en base, la scénographie vaut Ardoise', () => {
    expect(toStored(brut()).scenography).toBe('ardoise');
  });

  it('avec le champ, elle est lue telle quelle', () => {
    expect(toStored(brut({ scenography: 'comptoir' })).scenography).toBe('comptoir');
  });
});
