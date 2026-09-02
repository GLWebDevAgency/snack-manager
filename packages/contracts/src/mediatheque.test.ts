import { describe, expect, it } from 'vitest';
import {
  cadrageCss,
  catalogueMedias,
  estPublic,
  MEDIAS_PAR_PRODUIT_MAX,
  MediaDescribeSchema,
  mediasDuProduit,
  photoAltDe,
  photoHeritee,
  photoPointDe,
  photoUrlDe,
  POINT_CENTRE,
  ProduitMediasSchema,
  ProductCreateSchema,
  ProductUpdateSchema,
  texteAlternatif,
  urlMedia,
  urlsMedia,
  USAGES,
  type MediaVue,
} from './index';

/**
 * LA MÉDIATHÈQUE, côté contrat.
 *
 * Ce qui se vérifie ici : que l'adresse d'un média ne dépend QUE de son
 * contenu (donc que décrire un média ne fait pas retélécharger la carte à une
 * caisse hors ligne), que `photoUrl` se dérive d'une source structurée avec un
 * repli sévère sur la chaîne héritée, et que cette chaîne a bien cessé d'être
 * écrivable — c'est le contournement de la liste blanche d'origines qu'on
 * ferme.
 */

const TENANT = '665f0d0a1c2b3d4e5f6a7b99';
const EMPREINTE = '0123456789abcdef0123456789abcdef';

/**
 * Les adresses sont DÉRIVÉES de l'empreinte du correctif, jamais recopiées :
 * une doublure qui les figerait laisserait passer une régression où deux
 * médias distincts partagent une URL — précisément l'invariant du §3.
 */
function media(patch: Partial<MediaVue> = {}): MediaVue {
  const empreinte = patch.empreinte ?? EMPREINTE;
  const stockage = patch.stockage ?? 'objet';
  return {
    id: 'm1',
    genre: 'photo',
    type: 'image/webp',
    octets: 120_000,
    largeur: 1600,
    hauteur: 1200,
    point: POINT_CENTRE,
    alt: '',
    origine: 'depot',
    auteur: null,
    deposeLe: null,
    utilisePar: 0,
    ...patch,
    empreinte,
    stockage,
    urls: urlsMedia({
      stockage,
      tenantId: TENANT,
      empreinte,
      base: 'https://api.snackmanager.fr',
      fichier: null,
    }),
  };
}

describe('l’adresse d’un média', () => {
  it('ne dépend que du contenu — le restaurant, puis l’empreinte', () => {
    const url = urlMedia(
      { stockage: 'objet', tenantId: TENANT, empreinte: EMPREINTE, base: 'https://api.x.fr', fichier: null },
      'vignette',
    );
    expect(url).toBe(`https://api.x.fr/public/medias/${TENANT}/${EMPREINTE}`);
  });

  it('les quatre usages rendent la MÊME adresse aujourd’hui', () => {
    // C'est le point d'extension, pas une promesse de quatre fichiers : émettre
    // quatre adresses sans savoir les servir ferait télécharger quatre fois le
    // même objet à une caisse qui n'en cache qu'un.
    const urls = urlsMedia({
      stockage: 'objet',
      tenantId: TENANT,
      empreinte: EMPREINTE,
      base: 'https://api.x.fr',
      fichier: null,
    });
    expect(new Set(USAGES.map((u) => urls[u])).size).toBe(1);
  });

  it('une photo héritée du pilote garde son chemin relatif', () => {
    // Le site de commande et l'écran de salle sont la même application Next :
    // `/photos/…` y fonctionne pour les deux, et survit à un changement de
    // domaine que rendrait fatal une URL absolue.
    const url = urlMedia(
      { stockage: 'heritee', tenantId: TENANT, empreinte: EMPREINTE, base: null, fichier: 'doner-kebab.webp' },
      'carte',
    );
    expect(url).toBe('/photos/doner-kebab.webp');
  });

  it('ne colle jamais deux barres obliques quand la base en porte une', () => {
    const url = urlMedia(
      { stockage: 'objet', tenantId: TENANT, empreinte: EMPREINTE, base: 'https://api.x.fr/', fichier: null },
      'fiche',
    );
    expect(url).toBe(`https://api.x.fr/public/medias/${TENANT}/${EMPREINTE}`);
  });
});

describe('le genre décide de la garde', () => {
  it('une photo est publique, un document ne l’est jamais', () => {
    expect(estPublic('photo')).toBe(true);
    expect(estPublic('document')).toBe(false);
  });
});

describe('`photoUrl`, dérivé de la première référence', () => {
  const catalogue = catalogueMedias([media({ id: 'm1' }), media({ id: 'm2', empreinte: 'f'.repeat(32) })]);

  it('prend la PREMIÈRE référence — c’est la photo principale', () => {
    const url = photoUrlDe({ medias: ['m1', 'm2'] }, catalogue, 'carte');
    expect(url).toBe(`https://api.snackmanager.fr/public/medias/${TENANT}/${EMPREINTE}`);
  });

  it('descend à la suivante quand la première a disparu — jamais de trou', () => {
    // Un média supprimé entre deux lectures ne doit pas effacer la photo d'un
    // produit qui en a une autre.
    const url = photoUrlDe({ medias: ['fantome', 'm2'] }, catalogue, 'carte');
    expect(url).toContain('f'.repeat(32));
  });

  it('retombe sur la chaîne héritée quand aucune référence ne résout', () => {
    expect(photoUrlDe({ medias: [], photoUrl: '/photos/tacos-hero.webp' }, catalogue, 'carte')).toBe(
      '/photos/tacos-hero.webp',
    );
    expect(photoUrlDe({}, catalogue, 'carte')).toBeNull();
  });

  it('ne sert jamais un document, même référencé par un produit', () => {
    const avecDoc = catalogueMedias([media({ id: 'd1', genre: 'document' })]);
    expect(photoUrlDe({ medias: ['d1'], photoUrl: '/photos/x.webp' }, avecDoc, 'carte')).toBe(
      '/photos/x.webp',
    );
  });
});

describe('la chaîne héritée, ramenée à ce qu’on accepte de servir', () => {
  it('accepte un chemin racine-relatif et une URL http(s)', () => {
    expect(photoHeritee('/photos/doner-kebab.webp')).toBe('/photos/doner-kebab.webp');
    expect(photoHeritee('https://cdn.snackmanager.fr/x.png')).toBe('https://cdn.snackmanager.fr/x.png');
  });

  it('refuse une URL à protocole relatif — elle désigne un hôte TIERS', () => {
    // Elle commence par une barre oblique et passait une vérification naïve du
    // premier caractère : c'est exactement le contournement qu'on ferme.
    expect(photoHeritee('//mechant.fr/pixel.png')).toBeNull();
  });

  it('refuse tout schéma qui n’est pas http(s), et le vide', () => {
    expect(photoHeritee('javascript:alert(1)')).toBeNull();
    expect(photoHeritee('data:image/svg+xml;base64,PHN2Zz4=')).toBeNull();
    expect(photoHeritee('   ')).toBeNull();
    expect(photoHeritee(42)).toBeNull();
  });
});

describe('les références d’un produit', () => {
  it('sont bornées à trois, dédoublonnées et nettoyées', () => {
    expect(mediasDuProduit({ medias: ['a', ' b ', 'a', 'c', 'd'] })).toEqual(['a', 'b', 'c', 'd'].slice(0, MEDIAS_PAR_PRODUIT_MAX));
    expect(mediasDuProduit({ medias: ['', '  '] })).toEqual([]);
    expect(mediasDuProduit({})).toEqual([]);
  });

  it('la route refuse au-delà de trois, et accepte la liste vide', () => {
    expect(ProduitMediasSchema.safeParse({ medias: ['a', 'b', 'c'] }).success).toBe(true);
    expect(ProduitMediasSchema.safeParse({ medias: [] }).success).toBe(true);
    expect(ProduitMediasSchema.safeParse({ medias: ['a', 'b', 'c', 'd'] }).success).toBe(false);
  });
});

describe('le texte alternatif ne bloque rien', () => {
  it('retombe sur le nom du produit, qui est le bon texte dans la plupart des cas', () => {
    expect(texteAlternatif('', 'Kebab Fromage')).toBe('Kebab Fromage');
    expect(texteAlternatif(null, 'Salade César')).toBe('Salade César');
    expect(texteAlternatif('   ', 'Tacos')).toBe('Tacos');
    expect(texteAlternatif('La terrasse le soir', 'Tacos')).toBe('La terrasse le soir');
  });

  it('la même règle vue depuis un produit', () => {
    const cat = catalogueMedias([media({ id: 'm1', alt: '' }), media({ id: 'm2', alt: 'Gros plan' })]);
    expect(photoAltDe({ medias: ['m1'], name: 'Le Smash' }, cat)).toBe('Le Smash');
    expect(photoAltDe({ medias: ['m2'], name: 'Le Smash' }, cat)).toBe('Gros plan');
    expect(photoAltDe({ medias: [], name: 'Le Smash' }, cat)).toBe('Le Smash');
  });
});

describe('le point d’intérêt', () => {
  it('vaut le centre par défaut, et se traduit en object-position', () => {
    expect(cadrageCss(null)).toBe('50% 50%');
    expect(cadrageCss({ x: 0.25, y: 0.4 })).toBe('25% 40%');
  });

  it('borne des coordonnées hors champ plutôt que de peindre à côté', () => {
    expect(cadrageCss({ x: -1, y: 2 })).toBe('0% 100%');
  });

  it('remonte au produit, ou `null` quand la photo n’est pas à nous', () => {
    const cat = catalogueMedias([media({ id: 'm1', point: { x: 0.3, y: 0.2 } })]);
    expect(photoPointDe({ medias: ['m1'] }, cat)).toEqual({ x: 0.3, y: 0.2 });
    expect(photoPointDe({ medias: [] }, cat)).toBeNull();
  });

  it('la route refuse une coordonnée hors [0,1]', () => {
    expect(MediaDescribeSchema.safeParse({ point: { x: 0.5, y: 0.5 } }).success).toBe(true);
    expect(MediaDescribeSchema.safeParse({ point: { x: 1.5, y: 0.5 } }).success).toBe(false);
  });

  it('décrire un média ne réécrit pas ce qu’on n’a pas transmis', () => {
    // Le piège de `ProductUpdateSchema` : aucun `.default()` ici non plus.
    expect(MediaDescribeSchema.parse({ alt: 'Gros plan' })).toEqual({ alt: 'Gros plan' });
    expect(MediaDescribeSchema.parse({})).toEqual({});
  });
});

describe('`photoUrl` a cessé d’être écrivable', () => {
  it('la création d’un produit l’écarte', () => {
    const p = ProductCreateSchema.parse({
      categoryId: 'c1',
      name: 'Kebab',
      photoUrl: 'https://mechant.fr/pixel.png',
    });
    expect('photoUrl' in p).toBe(false);
  });

  it('la mise à jour l’écarte aussi — c’était le contournement de la liste blanche', () => {
    const p = ProductUpdateSchema.parse({ name: 'Kebab', photoUrl: 'javascript:alert(1)' });
    expect('photoUrl' in p).toBe(false);
  });
});
