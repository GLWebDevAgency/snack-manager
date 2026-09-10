import { ajusterJusquaAA } from '@sm/contracts';
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { makeUi } from './ui';
import type { KdsTheme } from './prefs';

const ThemeContext = createContext(makeUi('dark'));

/** Le thème change les tokens sans remonter le tableau ni sa session. */
export function ThemeProvider({ theme = 'dark', children }: { theme?: KdsTheme; children: ReactNode }) {
  const ui = useMemo(() => makeUi(theme), [theme]);
  return <ThemeContext.Provider value={ui}>{children}</ThemeContext.Provider>;
}

export function useUi() { return useContext(ThemeContext); }

/** L’encre garde la teinte du restaurant et se lit aussi sur les surfaces claires. */
export function useAccentText(accent: string) {
  const { surface } = useUi();
  return useMemo(() => ajusterJusquaAA(accent, [surface.card, surface.el, surface.el2]).couleur, [accent, surface]);
}
