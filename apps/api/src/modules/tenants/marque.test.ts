import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { DIRECTIONS } from '@sm/contracts';
import { avecLogoHerite, exigerAA } from './marque';

describe('l’API ne fait pas confiance à l’éditeur', () => {
  it('laisse passer une direction dessinée', () => {
    expect(() => exigerAA(DIRECTIONS.marche)).not.toThrow();
  });

  it('refuse en 400 un masque qui échoue AA — avec les couples et les nuances proposées', () => {
    const pale = { ...DIRECTIONS.marche, palette: { ...DIRECTIONS.marche.palette, ink: '#9aa79e' } };
    try {
      exigerAA(pale);
      throw new Error('aurait dû lever');
    } catch (e) {
      expect(e).toBeInstanceOf(BadRequestException);
      const corps = (e as BadRequestException).getResponse() as { message: string; verdicts: { couple: string; ok: boolean; proposition: string | null }[] };
      expect(corps.message).toBe('Contraste insuffisant');
      const rate = corps.verdicts.find((v) => v.couple === 'ink/ground');
      expect(rate?.ok).toBe(false);
      expect(rate?.proposition).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});

describe('un masque sans logo hérite du logo legacy', () => {
  it('pose le logo legacy en mark.dark quand les quatre emplacements sont vides', () => {
    const sansLogo = DIRECTIONS.marche;
    const herite = avecLogoHerite(sansLogo, 'https://r2.example/logos/vieux-logo.png');
    expect(herite.logo.mark.dark).toBe('https://r2.example/logos/vieux-logo.png');
    expect(herite.logo.mark.light).toBeNull();
    expect(herite.logo.lockup.light).toBeNull();
    expect(herite.logo.lockup.dark).toBeNull();
    // Le reste du masque n'est pas retouché.
    expect(herite.palette).toEqual(sansLogo.palette);
    // La validated body n'est pas mutée : un nouvel objet est retourné.
    expect(sansLogo.logo.mark.dark).toBeNull();
  });

  it('ne touche à rien si un emplacement de logo est déjà posé, ou si le legacy est vide', () => {
    const avecUnLogo = {
      ...DIRECTIONS.marche,
      logo: { ...DIRECTIONS.marche.logo, mark: { ...DIRECTIONS.marche.logo.mark, light: 'https://r2.example/logos/actuel.png' } },
    };
    expect(avecLogoHerite(avecUnLogo, 'https://r2.example/logos/vieux-logo.png')).toBe(avecUnLogo);

    expect(avecLogoHerite(DIRECTIONS.marche, null)).toBe(DIRECTIONS.marche);
    expect(avecLogoHerite(DIRECTIONS.marche, undefined)).toBe(DIRECTIONS.marche);
    expect(avecLogoHerite(DIRECTIONS.marche, '')).toBe(DIRECTIONS.marche);
  });
});
