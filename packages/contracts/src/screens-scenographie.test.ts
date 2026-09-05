import { describe, expect, it } from 'vitest';
import {
  SCENOGRAPHIES,
  SCENOGRAPHY_DEFAULT,
  SCENOGRAPHY_DESCRIPTIONS,
  SCENOGRAPHY_LABELS,
  SCREEN_THEME_HINTS,
  SCREEN_THEME_LABELS,
  SCREEN_THEMES,
  ScreenCreateSchema,
  ScreenPreviewSchema,
  ScreenUpdateSchema,
} from './screens';

describe('Scénographies — le contrat', () => {
  it('un écran neuf reçoit Comptoir sans que personne ne le demande', () => {
    const cree = ScreenCreateSchema.parse({ name: 'Comptoir gauche' });
    expect(cree.scenography).toBe(SCENOGRAPHY_DEFAULT);
    expect(SCENOGRAPHY_DEFAULT).toBe('comptoir');
  });

  it('chaque scénographie a un libellé et une description', () => {
    for (const s of SCENOGRAPHIES) {
      expect(SCENOGRAPHY_LABELS[s].length).toBeGreaterThan(0);
      expect(SCENOGRAPHY_DESCRIPTIONS[s].length).toBeGreaterThan(0);
    }
  });

  it('une scénographie inconnue est refusée à la mise à jour', () => {
    expect(ScreenUpdateSchema.safeParse({ scenography: 'neon' }).success).toBe(false);
    expect(ScreenUpdateSchema.safeParse({ scenography: 'ardoise' }).success).toBe(true);
  });

  it("l'aperçu accepte un brouillon sans écran, avec des surcharges partielles", () => {
    const lu = ScreenPreviewSchema.parse({ theme: 'light' });
    expect(lu.screenId).toBeUndefined();
    expect(lu.theme).toBe('light');
    expect(lu.scenography).toBeUndefined();
  });

  it('les libellés de fond disent ce que le fond fait, et chaque fond a une aide', () => {
    expect(SCREEN_THEME_LABELS.brand).toBe('Vos couleurs');
    expect(SCREEN_THEME_LABELS.dark).toBe('Fond sombre');
    expect(SCREEN_THEME_LABELS.light).toBe('Fond clair');
    for (const t of SCREEN_THEMES) expect(SCREEN_THEME_HINTS[t].length).toBeGreaterThan(0);
  });
});
