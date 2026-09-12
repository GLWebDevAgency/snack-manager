import { dark, light } from '@sm/design-tokens';
import { PALETTES, type Palette } from '@sm/client-core';
import type { KdsTheme } from './prefs';

/** Surfaces et encres seulement : les aplats fonctionnels restent ceux du
 * noyau que timerColor et STATUS_TONE utilisent dans les deux thèmes. */
export function visualPalette(mode: KdsTheme): Palette {
  const t = mode === 'light' ? light : dark;
  return {
    ...PALETTES[mode],
    bg: t.canvas,
    surface: t.surface,
    surface2: t.secondary,
    text: t.ink,
    mut: t.muted,
    dimText: t.muted,
    line: t.line,
    line2: mode === 'light' ? 'rgba(37,39,35,0.08)' : 'rgba(245,247,242,0.10)',
    railBg: t.surface,
    footBg: t.surface,
    deep: t.canvas,
    press: t.secondary,
    press2: t.canvas,
    field: t.secondary,
    placeholder: t.muted,
    sheen: 'transparent',
    scrim: t.scrim,
    greenText: t.success,
    redText: t.danger,
    amberText: t.warning,
  };
}
