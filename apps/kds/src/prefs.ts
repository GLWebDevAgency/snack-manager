/** Préférences du poste : aucun état de commande ni dépendance de plateforme. */
export type KdsTheme = 'dark' | 'light';
export type KdsDensity = 'comfort' | 'dense';

export interface KdsPrefs {
  sound: boolean;
  allDay: boolean;
  theme: KdsTheme;
  density: KdsDensity;
  splash: boolean;
  reduceMotion: boolean;
  reduceTransparency: boolean;
}

export const DEFAULT_PREFS: Readonly<KdsPrefs> = {
  sound: true, allDay: true, theme: 'light', density: 'comfort', splash: true, reduceMotion: false, reduceTransparency: false,
};

/** Un ancien JSON {sound,allDay} conserve ses choix ; un champ invalide retombe seul au défaut. */
export function parsePrefs(raw: string | null): KdsPrefs {
  try {
    const value: unknown = raw === null ? null : JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { ...DEFAULT_PREFS };
    const prefs = value as Record<string, unknown>;
    return {
      sound: typeof prefs.sound === 'boolean' ? prefs.sound : DEFAULT_PREFS.sound,
      allDay: typeof prefs.allDay === 'boolean' ? prefs.allDay : DEFAULT_PREFS.allDay,
      theme: prefs.theme === 'dark' || prefs.theme === 'light' ? prefs.theme : DEFAULT_PREFS.theme,
      density: prefs.density === 'comfort' || prefs.density === 'dense' ? prefs.density : DEFAULT_PREFS.density,
      splash: typeof prefs.splash === 'boolean' ? prefs.splash : DEFAULT_PREFS.splash,
      reduceMotion: typeof prefs.reduceMotion === 'boolean' ? prefs.reduceMotion : DEFAULT_PREFS.reduceMotion,
      reduceTransparency: typeof prefs.reduceTransparency === 'boolean' ? prefs.reduceTransparency : DEFAULT_PREFS.reduceTransparency,
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}
