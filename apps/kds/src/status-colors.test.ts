import { describe, expect, it, vi } from 'vitest';
import { ratioContraste } from '@sm/contracts';

vi.mock('react-native', () => ({ Platform: { OS: 'web' }, StyleSheet: { create: <T>(styles: T) => styles } }));
import { makeUi } from './ui';

describe('encres de statut sur les nouveaux lavis cuisine', () => {
  it.each(['light', 'dark'] as const)('%s conserve AA sur les compteurs, Payé et Marquer prête', (theme) => {
    const ui = makeUi(theme);
    for (const [status, colors] of Object.entries(ui.statusColors)) {
      expect(ratioContraste(colors.ink, colors.wash), `${theme}/${status}`).toBeGreaterThanOrEqual(4.5);
    }
    expect(ratioContraste(ui.palette.text, ui.surface.el), `${theme}/Accepter`).toBeGreaterThanOrEqual(4.5);
  });
});
