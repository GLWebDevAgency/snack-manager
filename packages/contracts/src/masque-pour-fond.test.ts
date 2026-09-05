import { describe, expect, it } from 'vitest';
import {
  BrandStrictSchema,
  DIRECTIONS,
  FONDS_NEUTRES,
  masquePourFond,
  modePourFond,
  resoudreMarque,
} from './marque';

describe('masquePourFond — le fond de l’écran est une variante du masque', () => {
  it('« vos couleurs » rend le masque lui-même, sans copie', () => {
    const brand = DIRECTIONS.soleil;
    expect(masquePourFond(brand, 'brand')).toBe(brand);
  });

  it('« fond sombre » garde l’accent, son encre, les logos et l’accord, et passe en mode sombre', () => {
    const brand = DIRECTIONS.brasserie; // une direction claire
    const sombre = masquePourFond(brand, 'dark');
    expect(sombre.mode).toBe('dark');
    expect(sombre.palette.ground).toBe(FONDS_NEUTRES.dark.ground);
    expect(sombre.palette.accent).toBe(brand.palette.accent);
    expect(sombre.palette.onAccent).toBe(brand.palette.onAccent);
    expect(sombre.logo).toBe(brand.logo);
    expect(sombre.type).toBe(brand.type);
    expect(sombre.shape).toBe(brand.shape);
    expect(sombre.motion).toBe(brand.motion);
    expect(sombre.entete).toBe(brand.entete);
    expect(sombre.preset).toBeNull();
  });

  it('« fond clair » passe en mode clair et garde l’accent tel quel dans les jetons', () => {
    const brand = DIRECTIONS.neon; // une direction sombre
    const clair = masquePourFond(brand, 'light');
    expect(clair.mode).toBe('light');
    const { vars, colorScheme } = resoudreMarque(clair);
    expect(colorScheme).toBe('light');
    expect(vars['--cf-bg']).toBe(FONDS_NEUTRES.light.ground);
    expect(vars['--cf-accent']).toBe(brand.palette.accent);
  });

  it('les deux variantes passent la garde d’écriture : le mode suit le fond', () => {
    for (const fond of ['dark', 'light'] as const) {
      const variante = masquePourFond(DIRECTIONS.atelier, fond);
      expect(BrandStrictSchema.safeParse(variante).success).toBe(true);
      expect(variante.mode).toBe(modePourFond(variante.palette.ground));
    }
  });
});
