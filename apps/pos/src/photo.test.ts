import { afterEach, describe, expect, it, vi } from 'vitest';
import { adressePhoto, monogramme, photoDuPoste } from './photo';

const SITE = 'https://web-production-99b58c.up.railway.app';

describe('adresse d’une photo de plat, vue de la caisse', () => {
  it('laisse intacte une adresse absolue — le média est servi par l’API', () => {
    const url = 'https://api-production-8949.up.railway.app/public/medias/t1/abc';
    expect(adressePhoto(url, SITE)).toBe(url);
    // Le site configuré n'entre pas en jeu : une adresse absolue se suffit.
    expect(adressePhoto(url, null)).toBe(url);
  });

  it('résout une photo héritée contre le site, pas contre la caisse', () => {
    // Sans cela les dix-neuf photos du pilote seraient mortes sur le poste :
    // `/photos/…` désigne le paquet web, qui est une AUTRE origine.
    expect(adressePhoto('/photos/doner-kebab.webp', SITE)).toBe(
      `${SITE}/photos/doner-kebab.webp`,
    );
    expect(adressePhoto('/photos/x.webp', 'http://localhost:3000')).toBe(
      'http://localhost:3000/photos/x.webp',
    );
    // Un chemin dans le site configuré ne doit pas se recoller deux fois.
    expect(adressePhoto('/photos/x.webp', 'https://exemple.fr/vitrine')).toBe(
      'https://exemple.fr/photos/x.webp',
    );
  });

  it('rend null plutôt qu’une adresse devinée quand le site manque', () => {
    // Retomber sur un hôte « au cas où » ferait charger les photos d'un autre
    // environnement. La tuile redevient typographique, ce qui est exact.
    expect(adressePhoto('/photos/x.webp', null)).toBeNull();
    expect(adressePhoto('/photos/x.webp', '')).toBeNull();
    expect(adressePhoto('/photos/x.webp', 'pas-une-origine')).toBeNull();
    // `//ailleurs.fr` ressemble à un chemin et n'en est pas un.
    expect(adressePhoto('/photos/x.webp', '//ailleurs.fr')).toBeNull();
  });

  it('refuse ce qui n’est pas une adresse servable', () => {
    expect(adressePhoto(null, SITE)).toBeNull();
    expect(adressePhoto(undefined, SITE)).toBeNull();
    expect(adressePhoto('   ', SITE)).toBeNull();
    // Contournement de la liste blanche d'origines : un hôte tiers déguisé
    // en chemin. C'est le filtre du contrat qui le refuse, pas un second ici.
    expect(adressePhoto('//pirate.example/plat.jpg', SITE)).toBeNull();
    expect(adressePhoto('javascript:alert(1)', SITE)).toBeNull();
    expect(adressePhoto('data:image/png;base64,AAA', SITE)).toBeNull();
  });
});

describe('branchement sur la configuration du poste', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('lit EXPO_PUBLIC_SITE_URL, et rien d’autre', () => {
    vi.stubEnv('EXPO_PUBLIC_SITE_URL', 'https://snackmanager.fr');
    expect(photoDuPoste('/photos/x.webp')).toBe('https://snackmanager.fr/photos/x.webp');
    vi.stubEnv('EXPO_PUBLIC_SITE_URL', '');
    expect(photoDuPoste('/photos/x.webp')).toBeNull();
  });
});

describe('monogramme de repli', () => {
  it('écarte articles et prépositions', () => {
    expect(monogramme('Le Boursin')).toBe('BO');
    expect(monogramme('Chèvre Miel')).toBe('CM');
    expect(monogramme('Escalope Normande')).toBe('EN');
  });

  it('donne deux lettres à un mot unique', () => {
    // Une initiale isolée flotte au milieu de la vignette.
    expect(monogramme('Végétarien')).toBe('VÉ');
    expect(monogramme('Kebab')).toBe('KE');
  });

  it('ne rend jamais une chaîne vide', () => {
    expect(monogramme('Le')).toBe('LE');
    expect(monogramme('—')).toBe('—');
  });
});
