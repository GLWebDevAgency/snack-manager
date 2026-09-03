import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { DIRECTIONS } from '@sm/contracts';
import {
  avecLogoHerite,
  exigerAA,
  exigerOriginesImages,
  masqueAEnregistrer,
  urlsDuMasque,
} from './marque';
import { hotesDImages, imageAutorisee } from './origines-images';

/** La liste telle qu'un déploiement la produit : le domaine public, et l'API locale. */
const HOTES = hotesDImages('snackmanager.fr', 'localhost');
/** Une URL de logo telle que `logo.service.ts` la fabrique vraiment. */
const NOTRE_LOGO = 'https://api.snackmanager.fr/public/tenants/chez-lima/logo?v=17';

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

/**
 * L'API N'HÉBERGE PAS LES IMAGES DES AUTRES.
 *
 * `ImageUrl` borne le schéma (http(s)) et rien de plus : toute origine
 * passait. Ces URL finissent en `src` sur la vitrine, la carte de fidélité et
 * le tableau de menu du restaurant — un hôte tiers y voyait passer l'IP et le
 * navigateur de chacun de ses clients, et gardait la main sur ce qui
 * s'affiche.
 */
describe('la liste blanche d’origines d’images', () => {
  it('lit une configuration écrite comme on l’a sous les yeux', () => {
    expect(hotesDImages('SnackManager.fr', ' https://images.exemple.fr/, localhost:3001 ')).toEqual([
      'snackmanager.fr',
      'images.exemple.fr',
      'localhost',
    ]);
  });

  it('lève plutôt que de rendre une liste vide', () => {
    // Une liste vide refuserait jusqu'au logo hébergé chez nous : mieux vaut
    // une API qui ne démarre pas, tout de suite et bruyamment.
    expect(() => hotesDImages('', '')).toThrow(/origine/i);
    expect(() => hotesDImages(undefined, undefined)).toThrow();
  });

  it('admet le domaine public et ses sous-domaines, et EUX SEULS', () => {
    expect(imageAutorisee(NOTRE_LOGO, HOTES)).toBe(true);
    expect(imageAutorisee('https://snackmanager.fr/x.png', HOTES)).toBe(true);
    expect(imageAutorisee('http://localhost:3001/public/tenants/x/logo?v=1', HOTES)).toBe(true);
    expect(imageAutorisee('https://cdn.mechant.fr/pixel.png', HOTES)).toBe(false);
  });

  it('ne se laisse pas prendre au faux sous-domaine ni à l’user-info', () => {
    // `snackmanager.fr.mechant.fr` n'est pas un sous-domaine, et l'hôte d'une
    // URL n'est pas ce qui précède le `@`.
    expect(imageAutorisee('https://snackmanager.fr.mechant.fr/x.png', HOTES)).toBe(false);
    expect(imageAutorisee('https://evilsnackmanager.fr/x.png', HOTES)).toBe(false);
    expect(imageAutorisee('https://snackmanager.fr@mechant.fr/x.png', HOTES)).toBe(false);
    expect(imageAutorisee('pas-une-url', HOTES)).toBe(false);
  });

  it('regarde les CINQ emplacements d’image du masque, pas seulement le logo principal', () => {
    const complet = {
      ...DIRECTIONS.nuit,
      logo: {
        mark: { light: `${NOTRE_LOGO}&a=1`, dark: `${NOTRE_LOGO}&b=2` },
        lockup: { light: `${NOTRE_LOGO}&c=3`, dark: `${NOTRE_LOGO}&d=4` },
      },
      hero: 'https://cdn.mechant.fr/hero.jpg',
    };
    expect(urlsDuMasque(complet)).toHaveLength(5);
    try {
      exigerOriginesImages(complet, HOTES);
      throw new Error('aurait dû lever');
    } catch (e) {
      expect(e).toBeInstanceOf(BadRequestException);
      const corps = (e as BadRequestException).getResponse() as {
        message: string;
        refusees: string[];
        hotesAutorises: string[];
      };
      expect(corps.message).toBe('Origine d’image non autorisée');
      // Seule l'adresse fautive est nommée, et les hôtes admis avec — sans
      // quoi le restaurateur n'a aucun moyen de comprendre le refus.
      expect(corps.refusees).toEqual(['https://cdn.mechant.fr/hero.jpg']);
      expect(corps.hotesAutorises).toEqual([...HOTES]);
    }
  });

  it('laisse passer un masque sans aucune image — c’est le cas le plus courant', () => {
    expect(() => exigerOriginesImages(DIRECTIONS.marche, HOTES)).not.toThrow();
  });
});

describe('un masque sans logo hérite du logo legacy', () => {
  it('pose le logo legacy en mark.dark quand les quatre emplacements sont vides', () => {
    const sansLogo = DIRECTIONS.marche;
    const herite = avecLogoHerite(sansLogo, NOTRE_LOGO);
    expect(herite.logo.mark.dark).toBe(NOTRE_LOGO);
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
      logo: { ...DIRECTIONS.marche.logo, mark: { ...DIRECTIONS.marche.logo.mark, light: `${NOTRE_LOGO}&x=1` } },
    };
    expect(avecLogoHerite(avecUnLogo, NOTRE_LOGO)).toBe(avecUnLogo);

    expect(avecLogoHerite(DIRECTIONS.marche, null)).toBe(DIRECTIONS.marche);
    expect(avecLogoHerite(DIRECTIONS.marche, undefined)).toBe(DIRECTIONS.marche);
    expect(avecLogoHerite(DIRECTIONS.marche, '')).toBe(DIRECTIONS.marche);
  });
});

describe('masqueAEnregistrer — hérite AVANT de juger, rien ne s’écrit sans AA', () => {
  it('hérite le logo legacy puis rejoue AA sur le résultat', () => {
    const enregistre = masqueAEnregistrer(DIRECTIONS.marche, NOTRE_LOGO, HOTES);
    expect(enregistre.logo.mark.dark).toBe(NOTRE_LOGO);
  });

  it('un logo legacy mal formé n’est PAS greffé — le masque reste lisible, sans lever', () => {
    // `avecLogoHerite` grefferait 'pas-une-url' telle quelle ; `masqueAEnregistrer`
    // vérifie que le résultat reste un `Brand` valide avant de le retenir.
    const enregistre = masqueAEnregistrer(DIRECTIONS.marche, 'pas-une-url', HOTES);
    expect(enregistre).toBe(DIRECTIONS.marche);
    expect(enregistre.logo.mark.dark).toBeNull();
    expect(() => masqueAEnregistrer(DIRECTIONS.marche, 'pas-une-url', HOTES)).not.toThrow();
  });

  it('un logo legacy d’une origine non admise n’est pas greffé non plus — et ne bloque pas le restaurateur', () => {
    // Cette colonne plate a été écrite par des chemins plus anciens que la
    // liste blanche. Refuser l'écriture punirait le restaurateur pour une URL
    // qu'il n'a pas posée ; ne pas la greffer suffit.
    const enregistre = masqueAEnregistrer(DIRECTIONS.marche, 'https://cdn.mechant.fr/vieux.png', HOTES);
    expect(enregistre).toBe(DIRECTIONS.marche);
    expect(enregistre.logo.mark.dark).toBeNull();
  });

  it('refuse en 400 une image envoyée depuis une origine non admise', () => {
    const espion = {
      ...DIRECTIONS.nuit,
      logo: {
        ...DIRECTIONS.nuit.logo,
        mark: { light: null, dark: 'https://cdn.mechant.fr/pixel.png' },
      },
    };
    expect(() => masqueAEnregistrer(espion, null, HOTES)).toThrow(BadRequestException);
  });

  it('rejette malgré un héritage réussi, si le masque final échoue AA', () => {
    const pale = { ...DIRECTIONS.marche, palette: { ...DIRECTIONS.marche.palette, ink: '#9aa79e' } };
    expect(() => masqueAEnregistrer(pale, NOTRE_LOGO, HOTES)).toThrow(BadRequestException);
  });
});
