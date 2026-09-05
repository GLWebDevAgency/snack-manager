import { describe, expect, it } from 'vitest';
import { toStored, type RawScreen } from './screens.repository';
import { SCREEN_PRESENTATION_DEFAULT, ScreenPresentationSchema } from '@sm/contracts';

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

  it('la présentation absente ou d’une version inconnue reprend le rendu hérité', () => {
    expect(toStored(brut()).presentation).toEqual(SCREEN_PRESENTATION_DEFAULT);
    expect(toStored(brut({ presentation: { version: 99 } as never })).presentation).toEqual(SCREEN_PRESENTATION_DEFAULT);
  });

  it('les réglages versionnés enregistrés sont relus sans modifier l’identité', () => {
    const presentation = ScreenPresentationSchema.parse({ corners: 'soft', priceScale: 'large', motion: 'subtle' });
    expect(toStored(brut({ scenography: 'premiere', presentation })).presentation).toEqual(presentation);
  });
});
