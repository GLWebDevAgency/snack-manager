import { afterEach, describe, expect, it, vi } from 'vitest';
import { retourVitrine, siteConfigure } from './demo-retour';

/**
 * LA CAISSE D'UN COMMERÇANT NE PORTE PAS DE LIEN VERS NOTRE SITE DE VENTE.
 *
 * C'est l'objet principal de ce fichier, et ce n'est pas une question de goût :
 * un poste en service tourne toute la journée devant un équipier, à portée de
 * doigt, souvent sur une tablette où un lien sortant est un aller SANS retour
 * (pas de barre d'adresse, pas d'historique visible). Poser là une porte vers
 * snackmanager.fr, c'est offrir à un coup de coude la possibilité de vider
 * l'écran de vente en plein coup de feu.
 *
 * D'où la règle épinglée ici : le bandeau existe si, et seulement si, l'URL
 * portait `?demo=1`. Et sa destination ne sort JAMAIS de cette URL.
 */

const visite = (href: string, extra: Record<string, unknown> = {}) => {
  vi.stubGlobal('location', { href, origin: origineDe(href), ...extra });
};

const origineDe = (href: string) => {
  const trouve = /^https?:\/\/[^/?#]+/i.exec(href);
  return trouve ? trouve[0] : '';
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('le bandeau n’existe qu’en démonstration', () => {
  it('reste absent sur une caisse en service', () => {
    for (const href of [
      'https://caisse.snackmanager.fr/',
      'https://caisse.snackmanager.fr/?api=http://localhost:3001',
      'https://caisse.snackmanager.fr/?demo=0',
      'https://caisse.snackmanager.fr/?demo=true',
      'https://caisse.snackmanager.fr/?demo=11',
      'https://caisse.snackmanager.fr/?demonstration=1',
      'https://caisse.snackmanager.fr/#/ecran?demo=1',
    ]) {
      visite(href);
      expect(retourVitrine(), href).toBeNull();
    }
  });

  it('reste absent sur une tablette native, qui n’a pas d’URL', () => {
    // Aucune `location` : l'application native ne peut ni demander la
    // démonstration, ni l'obtenir — donc aucun bandeau, jamais.
    expect(retourVitrine()).toBeNull();
  });

  it('reste absent même si l’environnement crie « démonstration »', () => {
    // Un défaut d'environnement mal propagé ne doit pas suffire : c'est la
    // même promesse que `mode.ts` tient sur le mode lui-même.
    vi.stubEnv('EXPO_PUBLIC_DEMO', '1');
    vi.stubEnv('EXPO_PUBLIC_DEMO_MODE', 'true');
    vi.stubEnv('EXPO_PUBLIC_SITE_URL', 'https://snackmanager.fr');
    visite('https://caisse.snackmanager.fr/');
    expect(retourVitrine()).toBeNull();
  });

  it('apparaît sur ?demo=1, et lui seul', () => {
    visite('https://caisse.snackmanager.fr/?demo=1');
    expect(retourVitrine()).not.toBeNull();
  });

  it('disparaît dans le cadre de la vitrine', () => {
    // Embarquée dans l'iframe de la page d'accueil, la caisse n'a pas à
    // proposer un retour vers la page qui l'affiche.
    const cadre = {};
    vi.stubGlobal('self', cadre);
    vi.stubGlobal('top', {});
    visite('https://caisse.snackmanager.fr/?demo=1');
    expect(retourVitrine()).toBeNull();
  });
});

describe('la destination vient de la configuration', () => {
  it('lit EXPO_PUBLIC_SITE_URL', () => {
    vi.stubEnv('EXPO_PUBLIC_SITE_URL', 'https://snackmanager.fr');
    expect(siteConfigure()).toBe('https://snackmanager.fr');
    visite('https://caisse.snackmanager.fr/?demo=1');
    expect(retourVitrine()?.href).toBe('https://snackmanager.fr');
  });

  it('tient debout sans configuration du tout', () => {
    // Un export sans variable ne doit pas produire un bouton mort : le repli
    // est une adresse de production qui répond.
    visite('https://caisse.snackmanager.fr/?demo=1');
    expect(retourVitrine()?.href).toMatch(/^https:\/\//);
  });

  it('n’accepte AUCUNE adresse de retour posée sur l’URL', () => {
    // Le cœur du sujet : un `?retour=` accepté ferait de la caisse une
    // redirection ouverte, c'est-à-dire un tremplin vers un site pirate
    // depuis un lien qui porte notre nom de domaine.
    vi.stubEnv('EXPO_PUBLIC_SITE_URL', 'https://snackmanager.fr');
    for (const suffixe of [
      '&retour=https://pirate.example',
      '&returnTo=https://pirate.example',
      '&next=//pirate.example',
      '&redirect_uri=https://pirate.example',
      '&site=https://pirate.example',
      '&url=javascript:alert(1)',
    ]) {
      visite(`https://caisse.snackmanager.fr/?demo=1${suffixe}`);
      expect(retourVitrine()?.href, suffixe).toBe('https://snackmanager.fr');
    }
  });

  it('refuse une configuration qui n’est pas une adresse web', () => {
    vi.stubEnv('EXPO_PUBLIC_SITE_URL', 'javascript:alert(1)');
    visite('https://caisse.snackmanager.fr/?demo=1');
    expect(retourVitrine()?.href).toMatch(/^https:\/\//);
  });
});

describe('le libellé s’adapte à la provenance', () => {
  it('propose un RETOUR quand le visiteur vient de la vitrine', () => {
    vi.stubEnv('EXPO_PUBLIC_SITE_URL', 'https://snackmanager.fr');
    vi.stubGlobal('document', { referrer: 'https://snackmanager.fr/' });
    visite('https://caisse.snackmanager.fr/?demo=1');
    const vu = retourVitrine();
    expect(vu?.retour).toBe(true);
    expect(vu?.libelle).toBe('Retour au site');
  });

  it('propose une DÉCOUVERTE quand le lien a circulé ailleurs', () => {
    vi.stubEnv('EXPO_PUBLIC_SITE_URL', 'https://snackmanager.fr');
    vi.stubGlobal('document', { referrer: 'https://www.google.com/' });
    visite('https://caisse.snackmanager.fr/?demo=1');
    const vu = retourVitrine();
    expect(vu?.retour).toBe(false);
    expect(vu?.libelle).toBe('Découvrir Snack Manager');
  });
});
