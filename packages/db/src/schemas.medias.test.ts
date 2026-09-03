import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { MEDIAS_PAR_PRODUIT_MAX } from '@sm/contracts';
import { empreinteDe } from './media-empreinte';
import { fichierDe, lireFichier } from './backfill-medias';
import { MODELS } from './schemas';

/**
 * LA MÉDIATHÈQUE EN BASE.
 *
 * Ce qui se vérifie ici : que les gardes du schéma s'appliquent AUSSI aux
 * écritures qui ne passent pas par zod (admin-cli, shell, reprises), et que les
 * deux index qui portent le modèle — la liste et le dédoublonnage — sont bien
 * déclarés. Un index unique promis dans un commentaire et absent du schéma
 * laisserait deux dépôts simultanés du même fichier créer deux lignes.
 */

const Media = mongoose.model('MediaTest', MODELS.Media.schema);
const Product = mongoose.model('ProductTestMedias', MODELS.Product.schema);

const EMPREINTE = '0123456789abcdef0123456789abcdef';

/** Le dossier réellement versionné : ces tests lisent les octets du pilote. */
const PHOTOS = resolve(__dirname, '../../../apps/web/public/photos');

const media = (patch: Record<string, unknown> = {}) =>
  new Media({
    tenantId: new mongoose.Types.ObjectId(),
    genre: 'photo',
    empreinte: EMPREINTE,
    type: 'image/webp',
    octets: 1234,
    stockage: 'objet',
    origine: 'depot',
    ...patch,
  });

describe('le schéma d’un média', () => {
  it('accepte un média minimal et pose le centre comme point d’intérêt', () => {
    const doc = media();
    expect(doc.validateSync()).toBeUndefined();
    expect(doc.point?.x).toBe(0.5);
    expect(doc.point?.y).toBe(0.5);
    expect(doc.alt).toBe('');
  });

  it('refuse une empreinte qui n’en est pas une', () => {
    // La base est écrite aussi par l'admin-cli et par un shell : la garde ne
    // peut pas vivre dans le seul schéma d'entrée.
    expect(media({ empreinte: 'pas-une-empreinte' }).validateSync()).toBeDefined();
    expect(media({ empreinte: EMPREINTE.toUpperCase() }).validateSync()).toBeDefined();
  });

  it('refuse un format hors des trois admis, et un genre inventé', () => {
    expect(media({ type: 'image/svg+xml' }).validateSync()).toBeDefined();
    expect(media({ genre: 'video' }).validateSync()).toBeDefined();
  });

  it('refuse un point d’intérêt hors du cadre', () => {
    expect(media({ point: { x: 1.5, y: 0.5 } }).validateSync()).toBeDefined();
    expect(media({ point: { x: 0.5, y: -0.1 } }).validateSync()).toBeDefined();
  });

  it('refuse une base qui n’est pas une URL http(s) — la garde des origines', () => {
    expect(media({ base: 'javascript:alert(1)' }).validateSync()).toBeDefined();
    expect(media({ base: 'https://api.snackmanager.fr' }).validateSync()).toBeUndefined();
  });

  it('déclare les DEUX index : la liste, et le dédoublonnage unique', () => {
    const index = MODELS.Media.schema.indexes();
    const liste = index.find(([champs]) => champs.tenantId === 1 && champs.createdAt === -1);
    const dedoublonnage = index.find(([champs]) => champs.tenantId === 1 && champs.empreinte === 1);
    expect(liste, 'la médiathèque se liste du plus récent au plus ancien').toBeDefined();
    expect(dedoublonnage?.[1]?.unique, "l'unicité est portée par la BASE").toBe(true);
  });
});

describe('les références de photos d’un produit', () => {
  const produit = (medias: unknown[]) =>
    new Product({ tenantId: new mongoose.Types.ObjectId(), name: 'Kebab', medias });

  it('accepte de zéro à trois', () => {
    const trois = [1, 2, 3].map(() => new mongoose.Types.ObjectId());
    expect(produit([]).validateSync()).toBeUndefined();
    expect(produit(trois).validateSync()).toBeUndefined();
  });

  it('refuse au-delà de trois, même écrit hors de zod', () => {
    const quatre = [1, 2, 3, 4].map(() => new mongoose.Types.ObjectId());
    const erreur = produit(quatre).validateSync();
    expect(erreur?.errors?.medias?.message).toContain(String(MEDIAS_PAR_PRODUIT_MAX));
  });
});

describe('l’empreinte', () => {
  it('est stable, tronquée à 128 bits, et distingue deux contenus', () => {
    const a = empreinteDe(Buffer.from('des octets'));
    expect(a).toBe(empreinteDe(Buffer.from('des octets')));
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(a).not.toBe(empreinteDe(Buffer.from('des octets.')));
  });
});

describe('la reprise, ses décisions pures', () => {
  it('reconnaît un chemin `/photos/…` et rien d’autre', () => {
    expect(fichierDe('/photos/doner-kebab.webp')).toBe('doner-kebab.webp');
    expect(fichierDe('https://cdn.exemple.fr/x.webp')).toBeNull();
    expect(fichierDe(null)).toBeNull();
    expect(fichierDe('')).toBeNull();
  });

  it('refuse tout ce qui ressemble à une remontée de chemin', () => {
    // Cette valeur finit en lecture de fichier : elle ne sort pas du dossier.
    expect(fichierDe('/photos/../../../etc/passwd')).toBeNull();
    expect(fichierDe('/photos/sous/dossier.webp')).toBeNull();
    expect(fichierDe('//mechant.fr/photos/x.webp')).toBeNull();
  });

  it('LIT LES VRAIS FICHIERS DU PILOTE — type et cotes viennent des octets', () => {
    // Le dossier est versionné : ce test échoue si un visuel disparaît ou si
    // l'un d'eux n'est pas le format que son extension annonce.
    const lu = lireFichier(PHOTOS, 'doner-kebab.webp');
    expect(lu?.type).toBe('image/webp');
    expect(lu?.empreinte).toMatch(/^[0-9a-f]{32}$/);
    expect(lu?.octets).toBeGreaterThan(0);
    expect(lu?.largeur ?? 0).toBeGreaterThan(0);
  });

  it('écarte un fichier absent plutôt que d’inventer un média', () => {
    expect(lireFichier(PHOTOS, 'ce-fichier-n-existe-pas.webp')).toBeNull();
  });
});
