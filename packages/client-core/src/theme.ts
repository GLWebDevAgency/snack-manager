/**
 * Thème SM Dark pour les surfaces terrain (POS / KDS), en objets JS
 * plutôt qu'en CSS — react-native n'a pas de variables CSS.
 *
 * Règle marque grise : seul `accent` change par restaurant. Les couleurs
 * FONCTIONNELLES sont identiques sur tous les comptes, parce qu'un cuisinier
 * qui change d'établissement doit lire l'écran de la même façon :
 *   vert = prêt · rouge = urgent/alerte · ambre = en préparation.
 */
export const darkPalette = {
  bg: '#000000',
  surface: '#111111',
  surface2: '#1a1a1a',
  text: '#ffffff',
  mut: '#999999',
  line: 'rgba(255,255,255,0.1)',
  line2: 'rgba(255,255,255,0.06)',
  btnDark: '#262626',
  railBg: '#0a0a0a',
  footBg: '#0c0c0c',
  deep: '#0d0d0d',
  zero: '#3a3a3a',
  dimText: '#7a7a7a',
  press: '#1c1c1c',
  press2: '#282828',
  field: 'rgba(255,255,255,0.05)',
  sheen: 'rgba(255,255,255,0.04)',
  placeholder: 'rgba(255,255,255,0.3)',
  scrim: 'rgba(0,0,0,0.62)',
  greenText: '#6ecf78',
  redText: '#ff776b',
  amberText: '#e0973f',

  // Fonctionnelles — NE JAMAIS personnaliser
  green: '#3fae4a',
  red: '#c94b3f',
  amber: '#e0973f',
  gold: '#c9a15a',
  onAmber: '#1C1612',
} as const;

/** Les mêmes rôles, indépendants de React Native et réutilisables sur mobile. */
export type Palette = { readonly [Key in keyof typeof darkPalette]: string };
export type ColorTheme = 'dark' | 'light';

export const PALETTES: Readonly<Record<ColorTheme, Palette>> = {
  dark: darkPalette,
  light: {
    ...darkPalette,
    bg: '#ececea',
    surface: '#ffffff',
    surface2: '#f2f1ee',
    text: '#111111',
    mut: '#6b6b6b',
    line: 'rgba(0,0,0,0.12)',
    line2: 'rgba(0,0,0,0.07)',
    btnDark: '#1a1a1a',
    railBg: '#e4e3df',
    footBg: '#f6f5f2',
    deep: '#f4f3f0',
    zero: '#c4c2bd',
    dimText: '#8a8a8a',
    press: '#e8e7e3',
    press2: '#dddcd7',
    field: 'rgba(0,0,0,0.04)',
    sheen: 'rgba(255,255,255,0.55)',
    placeholder: 'rgba(0,0,0,0.35)',
    scrim: 'rgba(20,20,20,0.45)',
    greenText: '#2a8a36',
    redText: '#b8362b',
    amberText: '#b86f1a',
  },
};

/** Alias historique : le KDS et les autres surfaces conservent leur thème sombre. */
export const palette = PALETTES.dark;

export const radius = { xs: 8, sm: 10, md: 12, lg: 16, xl: 20, pill: 999 } as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;

/** Cible tactile minimale — gants et écrans gras (exigence transverse §3). */
export const TOUCH_MIN = 44;

export interface Theme {
  accent: string;
  onAccent: string;
}

export const defaultTheme: Theme = { accent: '#c9a15a', onAccent: '#ffffff' };

/** Seuils des minuteurs KDS, en minutes. */
export const TIMER_THRESHOLDS = { warn: 10, late: 15 } as const;

/** Couleur d'un minuteur selon l'ancienneté de la commande. */
export function timerColor(minutes: number): string {
  if (minutes >= TIMER_THRESHOLDS.late) return palette.red;
  if (minutes >= TIMER_THRESHOLDS.warn) return palette.amber;
  return palette.green;
}

/** mm:ss à partir d'un nombre de secondes. */
export function mmss(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
