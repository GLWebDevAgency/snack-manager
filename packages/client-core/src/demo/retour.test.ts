import { afterEach, describe, expect, it, vi } from 'vitest';
import { isDemoRequested } from './mode';
import {
  DEMO_MENTION,
  LIBELLE_DECOUVERTE,
  LIBELLE_RETOUR,
  SITE_PAR_DEFAUT,
  destinationSure,
  estEncadre,
  origineCourante,
  referrerCourant,
  retourDemo,
  vientDuSite,
} from './retour';

/**
 * LES DEUX TESTS QUI COMPTENT.
 *
 * 1. UNE VRAIE CAISSE N'AFFICHE JAMAIS DE LIEN VERS NOTRE SITE COMMERCIAL.
 *    Un poste en service porte l'argent d'un commerçant. Y poser une porte de
 *    sortie vers snackmanager, à portée de doigt d'un équipier au coup de feu,
 *    serait un défaut de produit à part entière — pas un détail cosmétique.
 *
 * 2. LA DESTINATION NE VIENT JAMAIS DE L'URL. Un `?retour=…` accepté serait
 *    une redirection ouverte : un lien portant NOTRE domaine, notre
 *    certificat et notre réputation, qui dépose la victime chez un pirate.
 *
 * Le reste — libellés, cadre, repli — est du confort ; ces deux-là sont des
 * garanties.
 */

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

/** Un contexte de démonstration ordinaire, sur lequel on fait varier un point. */
const base = {
  demo: true,
  encadre: false,
  referrer: null,
  site: 'https://snackmanager.fr',
  origine: 'https://caisse.snackmanager.fr',
};

describe('hors démonstration, aucun bandeau', () => {
  it('rend null quand le mode démonstration est éteint', () => {
    expect(retourDemo({ ...base, demo: false })).toBeNull();
  });

  it('reste éteint même si tout le reste est parfaitement configuré', () => {
    // Le cas réel : une tablette de production, exportée avec la même
    // variable d'environnement que les démonstrations. Rien ne doit s'afficher.
    expect(
      retourDemo({
        demo: false,
        encadre: false,
        referrer: 'https://snackmanager.fr/',
        site: 'https://snackmanager.fr',
        origine: 'https://caisse.snackmanager.fr',
      }),
    ).toBeNull();
  });

  it("suit la bascule d'URL, seule autorité sur le mode", () => {
    // La chaîne complète, telle que la caisse et la cuisine la câblent :
    // `isDemoRequested(href)` décide, `retourDemo` obéit.
    for (const href of [
      'https://caisse.snackmanager.fr/',
      'https://caisse.snackmanager.fr/?demo=0',
      'https://caisse.snackmanager.fr/?demo=true',
      'https://caisse.snackmanager.fr/?demonstration=1',
      'https://caisse.snackmanager.fr/#/ecran?demo=1',
    ]) {
      expect(retourDemo({ ...base, demo: isDemoRequested(href) }), href).toBeNull();
    }
    expect(retourDemo({ ...base, demo: isDemoRequested('https://caisse.snackmanager.fr/?demo=1') }))
      .not.toBeNull();
  });
});

describe('la destination ne vient jamais de l’URL', () => {
  it('ignore tout paramètre de retour posé sur l’adresse', () => {
    // Ces adresses sont exactement celles qu'un attaquant enverrait : notre
    // domaine, notre certificat, sa destination. Le bandeau doit pointer chez
    // nous quoi qu'il arrive.
    for (const href of [
      'https://caisse.snackmanager.fr/?demo=1&retour=https://pirate.example',
      'https://caisse.snackmanager.fr/?demo=1&returnTo=https://pirate.example',
      'https://caisse.snackmanager.fr/?demo=1&next=//pirate.example',
      'https://caisse.snackmanager.fr/?demo=1&url=javascript:alert(1)',
      'https://caisse.snackmanager.fr/?demo=1&site=https://pirate.example',
    ]) {
      vi.stubGlobal('location', { href, origin: 'https://caisse.snackmanager.fr' });
      const vu = retourDemo({
        demo: isDemoRequested(href),
        encadre: estEncadre(),
        referrer: referrerCourant(),
        site: 'https://snackmanager.fr',
        origine: origineCourante(),
      });
      expect(vu?.href, href).toBe('https://snackmanager.fr');
      vi.unstubAllGlobals();
    }
  });

  it('refuse une configuration qui n’est pas une destination', () => {
    // Une variable d'environnement mal recopiée produit exactement le lien
    // qu'on refuse d'écrire à la main. Le filtre est le même des deux côtés.
    for (const mauvaise of [
      'javascript:alert(1)',
      'data:text/html,<script>x</script>',
      'blob:https://pirate.example/x',
      '//pirate.example',
      '/\\pirate.example',
      'https://',
      '   ',
      '',
      null,
      undefined,
    ]) {
      expect(destinationSure(mauvaise), String(mauvaise)).toBe(SITE_PAR_DEFAUT);
    }
  });

  it('accepte une URL absolue http(s) ou un chemin de même origine', () => {
    expect(destinationSure('https://snackmanager.fr')).toBe('https://snackmanager.fr');
    expect(destinationSure('http://localhost:3000')).toBe('http://localhost:3000');
    expect(destinationSure('https://snackmanager.fr/tarifs?a=b')).toBe(
      'https://snackmanager.fr/tarifs?a=b',
    );
    expect(destinationSure('/', '/')).toBe('/');
    expect(destinationSure('/tarifs', '/')).toBe('/tarifs');
    expect(destinationSure('  https://snackmanager.fr  ')).toBe('https://snackmanager.fr');
  });

  it('retombe sur une destination sûre même si le repli est douteux', () => {
    // Personne ne devrait écrire ça, mais un repli empoisonné ne doit pas
    // rouvrir par la fenêtre ce que le filtre ferme par la porte.
    expect(destinationSure(null, 'javascript:alert(1)')).toBe(SITE_PAR_DEFAUT);
  });
});

describe('dans le cadre de la vitrine, aucun bandeau', () => {
  it('rend null quand la surface est encadrée', () => {
    // Le visiteur EST déjà sur le site ; et le bac à sable de l'iframe
    // n'autorise pas la navigation de la fenêtre parente — le lien serait
    // inerte en plus d'être absurde.
    expect(retourDemo({ ...base, encadre: true })).toBeNull();
  });

  it('détecte le cadre par self !== top, et rien d’autre', () => {
    const fenetre = {};
    vi.stubGlobal('self', fenetre);
    vi.stubGlobal('top', fenetre);
    expect(estEncadre()).toBe(false);
    vi.stubGlobal('top', {});
    expect(estEncadre()).toBe(true);
  });

  it('n’est encadré nulle part hors navigateur (tablette native)', () => {
    expect(estEncadre()).toBe(false);
  });
});

describe('libellé : retour ou découverte', () => {
  it('parle de retour quand le référent est notre site', () => {
    const vu = retourDemo({ ...base, referrer: 'https://snackmanager.fr/tarifs' });
    expect(vu?.retour).toBe(true);
    expect(vu?.libelle).toBe(LIBELLE_RETOUR);
  });

  it('parle de retour quand aucun référent n’est disponible', () => {
    // `rel="noreferrer"` sur le lien « Ouvrir en plein écran » efface le
    // référent : le visiteur venu de la vitrine arrive nu. On tranche pour le
    // cas dominant, celui que le défaut décrit.
    expect(retourDemo({ ...base, referrer: null })?.libelle).toBe(LIBELLE_RETOUR);
    expect(retourDemo({ ...base, referrer: '' })?.libelle).toBe(LIBELLE_RETOUR);
  });

  it('invite à découvrir quand le lien vient d’ailleurs', () => {
    for (const ailleurs of [
      'https://www.google.com/',
      'https://t.co/abcdef',
      'https://mail.proton.me/',
      'android-app://com.whatsapp/',
    ]) {
      const vu = retourDemo({ ...base, referrer: ailleurs });
      expect(vu?.retour, ailleurs).toBe(false);
      expect(vu?.libelle, ailleurs).toBe(LIBELLE_DECOUVERTE);
    }
  });

  it('compare des origines, pas des chaînes', () => {
    expect(vientDuSite('HTTPS://SnackManager.FR/tarifs', 'https://snackmanager.fr')).toBe(true);
    expect(vientDuSite('https://snackmanager.fr.pirate.example/', 'https://snackmanager.fr')).toBe(
      false,
    );
    // Destination relative : c'est l'origine de la page courante qui tranche.
    expect(vientDuSite('https://x.fr/tarifs', '/', 'https://x.fr')).toBe(true);
    expect(vientDuSite('https://y.fr/tarifs', '/', 'https://x.fr')).toBe(false);
  });
});

describe('le vocabulaire est commun aux quatre démonstrations', () => {
  it('porte la marque et dit ce que le visiteur regarde', () => {
    const vu = retourDemo(base);
    expect(vu?.marque).toBe('Snack Manager');
    expect(vu?.mention).toBe(DEMO_MENTION);
    expect(vu?.mention).toContain('données fictives');
    expect(vu?.mention).toContain('rien n’est enregistré');
  });
});
