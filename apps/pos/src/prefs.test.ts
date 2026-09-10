import { describe, expect, it } from 'vitest';
import { DEFAULT_PREFS, parsePrefs, type PosLayoutId, type PosTheme } from './prefs';

describe('Préférences visuelles du poste', () => {
  it.each([null, '', '{', 'null', 'false', '42', '[]', '"light"'])('restaure les défauts si le stockage contient %s', (raw) => {
    expect(parsePrefs(raw)).toEqual({ layout: 'B', theme: 'dark', splash: true });
  });

  it('récupère les champs valides indépendamment des champs absents ou inconnus', () => {
    expect(parsePrefs('{"layout":"inconnu","theme":"light","splash":false}')).toEqual({ layout: 'B', theme: 'light', splash: false });
    expect(parsePrefs('{"layout":"C","theme":"auto","splash":"false"}')).toEqual({ layout: 'C', theme: 'dark', splash: true });
    expect(parsePrefs('{"layout":"A","extra":"ignoré"}')).toEqual({ layout: 'A', theme: 'dark', splash: true });
  });

  it('préserve chaque combinaison après un aller-retour JSON', () => {
    for (const layout of ['A', 'B', 'C'] as PosLayoutId[]) {
      for (const theme of ['dark', 'light'] as PosTheme[]) {
        for (const splash of [true, false]) {
          const prefs = { layout, theme, splash };
          expect(parsePrefs(JSON.stringify(prefs))).toEqual(prefs);
        }
      }
    }
  });

  it('ne laisse pas un consommateur altérer les défauts des prochains chargements', () => {
    const prefs = parsePrefs(null);
    prefs.layout = 'A';
    expect(parsePrefs(null)).toEqual(DEFAULT_PREFS);
  });
});
