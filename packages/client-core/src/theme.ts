/**
 * Thème SM Dark pour les surfaces terrain (POS / KDS), en objets JS
 * plutôt qu'en CSS — react-native n'a pas de variables CSS.
 *
 * Règle marque grise : seul `accent` change par restaurant. Les couleurs
 * FONCTIONNELLES sont identiques sur tous les comptes, parce qu'un cuisinier
 * qui change d'établissement doit lire l'écran de la même façon :
 *   vert = prêt · rouge = urgent/alerte · ambre = en préparation.
 */
export const palette = {
  bg: '#000000',
  surface: '#111111',
  surface2: '#1a1a1a',
  text: '#ffffff',
  mut: '#999999',
  line: 'rgba(255,255,255,0.1)',
  line2: 'rgba(255,255,255,0.06)',
  btnDark: '#262626',

  // Fonctionnelles — NE JAMAIS personnaliser
  green: '#3fae4a',
  red: '#c94b3f',
  amber: '#e0973f',
  gold: '#c9a15a',
  onAmber: '#1C1612',
} as const;

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
