import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { DIRECTIONS, lireMarque, logoUrlDe, marqueEffective } from '@sm/contracts';
import { TenantSchema } from '@sm/db';
import mongoose from 'mongoose';
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
  it('préserve les accroches omises par un ancien éditeur, et respecte leur retrait explicite', () => {
    const previous = { tagline: 'Fait maison.', taglineSub: 'À emporter.' };
    expect(masqueAEnregistrer(DIRECTIONS.nuit, null, HOTES, previous)).toMatchObject(previous);
    expect(masqueAEnregistrer({ ...DIRECTIONS.nuit, tagline: null }, null, HOTES, previous))
      .toMatchObject({ tagline: null, taglineSub: previous.taglineSub });
  });
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

  /*
   * LE DOMAINE OÙ L'API EST SERVIE EST TOUJOURS ADMIS.
   *
   * Sur staging, la plateforme sert l'API sur son domaine généré, hors du
   * domaine public — et tout dépôt d'image y a été refusé le 03/09/2026 avec
   * « cette requête arrive d'un hôte que nous ne servons pas ». En production
   * le domaine est un sous-domaine du domaine public, donc le défaut ne s'y
   * voyait pas. Il est lu de la plateforme, jamais de la requête.
   */
  it('admet le domaine où l’API est elle-même servie', () => {
    const staging = hotesDImages('staging.snackmanager.fr', undefined, 'api-staging-a5e8.up.railway.app');
    expect(staging).toContain('api-staging-a5e8.up.railway.app');
    expect(
      imageAutorisee('https://api-staging-a5e8.up.railway.app/public/tenants/x/logo?v=1', staging),
    ).toBe(true);
  });

  it('ne double pas le domaine de la plateforme quand il est déjà sous le domaine public', () => {
    expect(hotesDImages('snackmanager.fr', undefined, 'api.snackmanager.fr')).toEqual([
      'snackmanager.fr',
      'api.snackmanager.fr',
    ]);
  });

  it('reste inchangée quand la plateforme ne dit rien', () => {
    expect(hotesDImages('snackmanager.fr', 'localhost', undefined)).toEqual([
      'snackmanager.fr',
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
  it('respecte le retrait des quatre logos après une marque valide, même si le legacy existe encore', () => {
    const previous = avecLogoHerite(DIRECTIONS.marche, NOTRE_LOGO);
    const enregistre = masqueAEnregistrer(DIRECTIONS.marche, NOTRE_LOGO, HOTES, previous);
    expect(enregistre.logo).toEqual(DIRECTIONS.marche.logo);
    const tenant = { brand: enregistre, logoUrl: NOTRE_LOGO };
    expect(lireMarque(tenant).repli).toBeNull();
    expect(logoUrlDe(marqueEffective(tenant))).toBeNull();
    // Une deuxième sauvegarde d'une marque déjà vide ne ressuscite pas le logo.
    expect(masqueAEnregistrer(DIRECTIONS.marche, NOTRE_LOGO, HOTES, enregistre).logo).toEqual(enregistre.logo);
  });

  it('reconnaît également une marque valide hydratée par Mongoose', () => {
    const Model = mongoose.model('BrandRemovalUnitFixture', TenantSchema);
    try {
      const tenant = new Model({ slug: 'fixture', name: 'Fixture', brand: avecLogoHerite(DIRECTIONS.marche, NOTRE_LOGO) });
      expect(typeof Reflect.get(tenant.brand!, 'toObject')).toBe('function');
      expect(masqueAEnregistrer(DIRECTIONS.marche, NOTRE_LOGO, HOTES, tenant.brand).logo).toEqual(DIRECTIONS.marche.logo);
    } finally { mongoose.deleteModel('BrandRemovalUnitFixture'); }
  });

  it('un masque précédent invalide reste un cas de première pose avec héritage sûr', () => {
    const previous = { ...DIRECTIONS.marche, logo: { ...DIRECTIONS.marche.logo, mark: { light: null, dark: 'javascript:invalid' } } };
    expect(lireMarque({ brand: previous }).repli).toBe('invalide');
    expect(masqueAEnregistrer(DIRECTIONS.marche, NOTRE_LOGO, HOTES, previous).logo.mark.dark).toBe(NOTRE_LOGO);
    expect(masqueAEnregistrer(DIRECTIONS.marche, 'javascript:invalid', HOTES, previous).logo.mark.dark).toBeNull();
  });

  it('garde origine et AA obligatoires même après une marque valide', () => {
    const previous = avecLogoHerite(DIRECTIONS.marche, NOTRE_LOGO);
    const forbidden = { ...DIRECTIONS.marche, hero: 'https://foreign.example/hero.png' };
    expect(() => masqueAEnregistrer(forbidden, NOTRE_LOGO, HOTES, previous)).toThrow(BadRequestException);
    const pale = { ...DIRECTIONS.marche, palette: { ...DIRECTIONS.marche.palette, ink: '#9aa79e' } };
    expect(() => masqueAEnregistrer(pale, NOTRE_LOGO, HOTES, previous)).toThrow(BadRequestException);
  });

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
