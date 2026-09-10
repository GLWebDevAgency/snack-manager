/** Préférences de présentation du poste, sans dépendance à React ou à la plateforme. */
export type PosLayoutId = 'A' | 'B' | 'C';
export type PosTheme = 'dark' | 'light';

export const LAYOUTS: Record<PosLayoutId, { label: string; hint: string }> = {
  A: { label: 'Rail', hint: 'Catégories à gauche, ticket à droite, configuration en fenêtre. La disposition historique.' },
  B: { label: 'Ticket à gauche', hint: 'Ticket à gauche, catégories en onglets, configuration en panneau latéral. Recommandée.' },
  C: { label: 'Liste dense', hint: 'Catégories en liste, produits en lignes avec « + », configuration en panneau.' },
};
export const DEFAULT_LAYOUT: PosLayoutId = 'B';
export const PREFS_KEY = 'sm.pos.prefs.v1';

export interface PosPrefs {
  layout: PosLayoutId;
  theme: PosTheme;
  splash: boolean;
}

export const DEFAULT_PREFS: Readonly<PosPrefs> = { layout: DEFAULT_LAYOUT, theme: 'dark', splash: true };

/** Une valeur invalide ne doit invalider aucune des autres préférences connues. */
export function parsePrefs(raw: string | null): PosPrefs {
  try {
    const value: unknown = raw === null ? null : JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { ...DEFAULT_PREFS };
    const prefs = value as Record<string, unknown>;
    return {
      layout: prefs.layout === 'A' || prefs.layout === 'B' || prefs.layout === 'C' ? prefs.layout : DEFAULT_PREFS.layout,
      theme: prefs.theme === 'dark' || prefs.theme === 'light' ? prefs.theme : DEFAULT_PREFS.theme,
      splash: typeof prefs.splash === 'boolean' ? prefs.splash : DEFAULT_PREFS.splash,
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}
