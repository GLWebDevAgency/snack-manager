import { afterEach, describe, expect, it, vi } from 'vitest';
import { retourVitrine, siteConfigure } from './demo-retour';

/**
 * UN MURAL DE CUISINE NE PORTE PAS DE LIEN VERS NOTRE SITE DE VENTE.
 *
 * L'écran cuisine est le pire endroit du parc pour une porte de sortie : il est
 * touché avec des gants, souvent en passant, sans regarder — c'est même sa
 * qualité, un geste franc fait avancer un ticket. Un lien qui remplacerait le
 * tableau par une page commerciale au milieu d'un coup de feu ferait perdre la
 * vue de production à toute la brigade, sans que personne comprenne pourquoi.
 *
 * D'où la règle épinglée ici : le bandeau existe si, et seulement si, l'URL
 * portait `?demo=1`. Et sa destination ne sort JAMAIS de cette URL.
 */

const origineDe = (href: string) => {
  const trouve = /^https?:\/\/[^/?#]+/i.exec(href);
  return trouve ? trouve[0] : '';
};

const visite = (href: string) => {
  vi.stubGlobal('location', { href, origin: origineDe(href) });
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('le bandeau n’existe qu’en démonstration', () => {
  it('reste absent sur un écran cuisine en service', () => {
    for (const href of [
      'https://cuisine.snackmanager.fr/',
      'https://cuisine.snackmanager.fr/?api=http://localhost:3001',
      'https://cuisine.snackmanager.fr/?demo=0',
      'https://cuisine.snackmanager.fr/?demo=true',
      'https://cuisine.snackmanager.fr/?demo=11',
      'https://cuisine.snackmanager.fr/?demonstration=1',
      'https://cuisine.snackmanager.fr/#/ecran?demo=1',
    ]) {
      visite(href);
      expect(retourVitrine(), href).toBeNull();
    }
  });

  it('reste absent sur une tablette native, qui n’a pas d’URL', () => {
    expect(retourVitrine()).toBeNull();
  });

  it('reste absent même si l’environnement crie « démonstration »', () => {
    vi.stubEnv('EXPO_PUBLIC_DEMO', '1');
    vi.stubEnv('EXPO_PUBLIC_DEMO_MODE', 'true');
    vi.stubEnv('EXPO_PUBLIC_SITE_URL', 'https://snackmanager.fr');
    visite('https://cuisine.snackmanager.fr/');
    expect(retourVitrine()).toBeNull();
  });

  it('apparaît sur ?demo=1, et lui seul', () => {
    visite('https://cuisine.snackmanager.fr/?demo=1');
    expect(retourVitrine()).not.toBeNull();
  });

  it('disparaît dans le cadre de la vitrine', () => {
    vi.stubGlobal('self', {});
    vi.stubGlobal('top', {});
    visite('https://cuisine.snackmanager.fr/?demo=1');
    // `self` et `top` distincts = cadre.
    expect(retourVitrine()).toBeNull();
  });
});

describe('la destination vient de la configuration', () => {
  it('lit EXPO_PUBLIC_SITE_URL', () => {
    vi.stubEnv('EXPO_PUBLIC_SITE_URL', 'https://snackmanager.fr');
    expect(siteConfigure()).toBe('https://snackmanager.fr');
    visite('https://cuisine.snackmanager.fr/?demo=1');
    expect(retourVitrine()?.href).toBe('https://snackmanager.fr');
  });

  it('tient debout sans configuration du tout', () => {
    vi.stubEnv('EXPO_PUBLIC_SITE_URL', undefined);
    visite('https://cuisine.snackmanager.fr/?demo=1');
    expect(retourVitrine()?.href).toMatch(/^https:\/\//);
  });

  it('n’accepte AUCUNE adresse de retour posée sur l’URL', () => {
    vi.stubEnv('EXPO_PUBLIC_SITE_URL', 'https://snackmanager.fr');
    for (const suffixe of [
      '&retour=https://pirate.example',
      '&returnTo=https://pirate.example',
      '&next=//pirate.example',
      '&redirect_uri=https://pirate.example',
      '&site=https://pirate.example',
      '&url=javascript:alert(1)',
    ]) {
      visite(`https://cuisine.snackmanager.fr/?demo=1${suffixe}`);
      expect(retourVitrine()?.href, suffixe).toBe('https://snackmanager.fr');
    }
  });

  it('refuse une configuration qui n’est pas une adresse web', () => {
    vi.stubEnv('EXPO_PUBLIC_SITE_URL', '//pirate.example');
    visite('https://cuisine.snackmanager.fr/?demo=1');
    expect(retourVitrine()?.href).toMatch(/^https:\/\//);
    expect(retourVitrine()?.href).not.toContain('pirate');
  });
});

describe('le libellé s’adapte à la provenance', () => {
  it('propose un RETOUR quand le visiteur vient de la vitrine', () => {
    vi.stubEnv('EXPO_PUBLIC_SITE_URL', 'https://snackmanager.fr');
    vi.stubGlobal('document', { referrer: 'https://snackmanager.fr/' });
    visite('https://cuisine.snackmanager.fr/?demo=1');
    expect(retourVitrine()?.libelle).toBe('Retour au site');
  });

  it('propose une DÉCOUVERTE quand le lien a circulé ailleurs', () => {
    vi.stubEnv('EXPO_PUBLIC_SITE_URL', 'https://snackmanager.fr');
    vi.stubGlobal('document', { referrer: 'https://fr.wikipedia.org/' });
    visite('https://cuisine.snackmanager.fr/?demo=1');
    expect(retourVitrine()?.libelle).toBe('Découvrir Snack Manager');
  });
});
