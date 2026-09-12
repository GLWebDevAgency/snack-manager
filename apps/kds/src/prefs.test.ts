import { describe, expect, it } from 'vitest';
import { DEFAULT_PREFS, parsePrefs, type KdsDensity, type KdsTheme } from './prefs';

describe('préférences visuelles cuisine', () => {
  it.each([null, '', '{', 'null', 'false', '42', '[]', '"light"'])('récupère les défauts sur un stockage invalide : %s', (raw) => {
    expect(parsePrefs(raw)).toEqual({ ...DEFAULT_PREFS });
  });

  it('conserve les bascules d’un ancien poste sans préférences visuelles', () => {
    expect(parsePrefs('{"sound":false,"allDay":false}')).toEqual({ ...DEFAULT_PREFS, sound: false, allDay: false });
    expect(parsePrefs('{"sound":false}')).toEqual({ ...DEFAULT_PREFS, sound: false });
  });

  it('isole les champs inconnus sans effacer les valeurs valides', () => {
    expect(parsePrefs('{"sound":"false","allDay":false,"theme":"auto","density":"dense","splash":false,"extra":1}')).toEqual({
      ...DEFAULT_PREFS, sound: true, allDay: false, density: 'dense', splash: false,
    });
    expect(parsePrefs('{"theme":"light","density":"future","allDay":null}')).toEqual({ ...DEFAULT_PREFS, theme: 'light' });
  });

  it('préserve toutes les bascules et apparences après un aller-retour JSON', () => {
    for (const sound of [true, false]) for (const allDay of [true, false]) for (const splash of [true, false]) {
      for (const theme of ['dark', 'light'] as KdsTheme[]) for (const density of ['comfort', 'dense'] as KdsDensity[]) {
        for (const reduceMotion of [true, false]) for (const reduceTransparency of [true, false]) {
          const prefs = { sound, allDay, splash, theme, density, reduceMotion, reduceTransparency };
          expect(parsePrefs(JSON.stringify(prefs))).toEqual(prefs);
        }
      }
    }
  });

  it('respecte le thème sombre enregistré et isole les deux nouvelles préférences', () => {
    expect(parsePrefs('{"theme":"dark","reduceMotion":true,"reduceTransparency":"true"}')).toEqual({ ...DEFAULT_PREFS, theme: 'dark', reduceMotion: true });
    expect(parsePrefs(null).theme).toBe('light');
  });

  it('ne permet pas à un retour par défaut de modifier les prochains chargements', () => {
    const prefs = parsePrefs(null);
    prefs.sound = false;
    expect(parsePrefs(null)).toEqual(DEFAULT_PREFS);
  });
});
