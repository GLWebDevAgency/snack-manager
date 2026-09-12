import { dark, light, type Mode } from '@sm/design-tokens';
import { PALETTES, type Palette } from '@sm/client-core';

/** Adaptation de présentation : les statuts, préférences et couleurs de marque
 * restent ceux du poste. Aucun changement du socle métier partagé avec le KDS. */
export function visualPalette(mode: Mode): Palette {
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
    zero: t.line,
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
