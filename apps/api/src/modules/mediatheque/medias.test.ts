import { describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import {
  dimensionsImage,
  MEDIA_MAX_OCTETS,
  QUOTA_MEDIAS_OCTETS,
  photoUrlDe,
  catalogueMedias,
  type JwtPayload,
} from '@sm/contracts';
import type { ImageStore } from '../../infrastructure/images/image-store';
import { CacheOctets } from './cache-octets';
import { MediasController } from './medias.controller';
import type { OriginesImages } from '../tenants/origines-images';
import { cleObjet, empreinteDe, MediasService, quotaDe, vueMedia } from './medias.service';

/**
 * LA MÉDIATHÈQUE.
 *
 * Ce qui se vérifie ici : que l'adresse d'un média ne dépend que de ses octets
 * (le §3, sans lequel une caisse hors ligne retélécharge la carte à chaque
 * retouche), que le cloisonnement par restaurant est dans la REQUÊTE et pas
 * dans un `if`, qu'un média employé ne part jamais en silence, et que le quota
 * refuse proprement plutôt que de laisser un disque se remplir.
 */

const TENANT = '665f0d0a1c2b3d4e5f6a7b99';
const AUTRE_TENANT = '665f0d0a1c2b3d4e5f6a7b11';
const ORIGIN = 'https://api.exemple.test';

const SESSION: JwtPayload = {
  sub: '665f0d0a1c2b3d4e5f6a7b01',
  tenantId: TENANT,
  role: 'owner',
  kind: 'user',
};

// ─────────────────────────────────────────────────────────────
// Des images honnêtes, avec des cotes connues
// ─────────────────────────────────────────────────────────────

function png(largeur: number, hauteur: number, remplissage = 1): Buffer {
  const entete = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(entete, 0);
  entete.writeUInt32BE(13, 8);
  entete.write('IHDR', 12, 'latin1');
  entete.writeUInt32BE(largeur, 16);
  entete.writeUInt32BE(hauteur, 20);
  return Buffer.concat([entete, Buffer.alloc(32, remplissage)]);
}

function jpeg(largeur: number, hauteur: number): Buffer {
  const app0 = Buffer.alloc(20);
  app0.writeUInt16BE(0xffd8, 0);
  app0.writeUInt16BE(0xffe0, 2);
  app0.writeUInt16BE(16, 4); // longueur du segment APP0, charge comprise
  const sof = Buffer.alloc(11);
  sof.writeUInt16BE(0xffc0, 0);
  sof.writeUInt16BE(17, 2);
  sof.writeUInt8(8, 4);
  sof.writeUInt16BE(hauteur, 5);
  sof.writeUInt16BE(largeur, 7);
  return Buffer.concat([app0, sof, Buffer.alloc(16, 7)]);
}

function webp(largeur: number, hauteur: number): Buffer {
  const b = Buffer.alloc(29);
  b.write('RIFF', 0, 'latin1');
  b.writeUInt32LE(21, 4);
  b.write('WEBP', 8, 'latin1');
  b.write('VP8L', 12, 'latin1');
  b.writeUInt32LE(9, 16);
  b.writeUInt8(0x2f, 20);
  b.writeUInt32LE(((hauteur - 1) << 14) | (largeur - 1), 21);
  return b;
}

const PNG = png(1200, 900);
const WEBP = webp(1600, 1200);

// ─────────────────────────────────────────────────────────────
// Doublures — le vocabulaire Mongoose que le service emploie, et rien d'autre
// ─────────────────────────────────────────────────────────────

type Ligne = Record<string, unknown>;

const memeId = (a: unknown, b: unknown) => String(a) === String(b);

function correspond(ligne: Ligne, filtre: Ligne): boolean {
  return Object.entries(filtre).every(([clef, attendu]) => {
    const valeur = ligne[clef];
    if (attendu !== null && typeof attendu === 'object') {
      if ('$in' in (attendu as object)) {
        return (attendu as { $in: unknown[] }).$in.some((v) => memeId(valeur, v));
      }
      if ('$ne' in (attendu as object)) {
        return JSON.stringify(valeur) !== JSON.stringify((attendu as { $ne: unknown }).$ne);
      }
    }
    // Un filtre sur un tableau apparie l'APPARTENANCE — c'est ce que Mongo fait
    // pour `{ medias: <id> }`, et c'est ce dont dépend la garde de suppression.
    if (Array.isArray(valeur)) return valeur.some((v) => memeId(v, attendu));
    return memeId(valeur, attendu);
  });
}

class Collection {
  readonly rows: Ligne[] = [];
  private seq = 0;

  constructor(private readonly prefixe: string) {}

  seed(row: Ligne): Ligne {
    const cree = { _id: new Types.ObjectId(), ...row };
    this.rows.push(cree);
    return cree;
  }

  find(filtre: Ligne = {}) {
    const rows = this.rows.filter((r) => correspond(r, filtre));
    const chaine = {
      sort: () => chaine,
      lean: async () => rows,
    };
    return chaine;
  }

  findOne(filtre: Ligne) {
    const row = this.rows.find((r) => correspond(r, filtre)) ?? null;
    return { lean: async () => row };
  }

  async create(doc: Ligne): Promise<Ligne & { toObject: () => Ligne }> {
    this.seq += 1;
    const cree = {
      _id: new Types.ObjectId(),
      createdAt: new Date(`2026-09-0${this.seq}T10:00:00.000Z`),
      ...doc,
    };
    this.rows.push(cree);
    return { ...cree, toObject: () => cree };
  }

  findOneAndUpdate(filtre: Ligne, update: { $set: Ligne }) {
    const row = this.rows.find((r) => correspond(r, filtre)) ?? null;
    if (row) Object.assign(row, update.$set);
    const promesse = Promise.resolve(row);
    return Object.assign(promesse, { lean: async () => row });
  }

  async deleteOne(filtre: Ligne) {
    const i = this.rows.findIndex((r) => correspond(r, filtre));
    if (i >= 0) this.rows.splice(i, 1);
    return { deletedCount: i >= 0 ? 1 : 0 };
  }

  async updateMany(filtre: Ligne, update: { $pull?: Ligne }) {
    let n = 0;
    for (const row of this.rows.filter((r) => correspond(r, filtre))) {
      for (const [clef, valeur] of Object.entries(update.$pull ?? {})) {
        const liste = row[clef];
        if (Array.isArray(liste)) row[clef] = liste.filter((v) => !memeId(v, valeur));
      }
      n += 1;
    }
    return { modifiedCount: n };
  }

  asModel<T>(): T {
    return this as unknown as T;
  }

  // Le prefixe n'est là que pour lire les échecs de test.
  toString(): string {
    return this.prefixe;
  }
}

function fakeStore(options: { failPut?: boolean } = {}) {
  const objets = new Map<string, Buffer>();
  const lectures = { count: 0 };
  const store: ImageStore = {
    enabled: true,
    providerName: 'doublure',
    async put(key, corps) {
      if (options.failPut) throw new Error('R2 indisponible');
      objets.set(key, corps);
    },
    async get(key) {
      lectures.count += 1;
      return objets.get(key) ?? null;
    },
    async delete(key) {
      objets.delete(key);
    },
  };
  return { store, objets, lectures };
}

function atelier(options: { failPut?: boolean } = {}) {
  const medias = new Collection('media');
  const produits = new Collection('produit');
  const { store, objets, lectures } = fakeStore(options);
  const annonces: string[] = [];
  const service = new MediasService(
    medias.asModel(),
    produits.asModel(),
    store,
    { publish: async (_c: string, m: string) => void annonces.push(m) } as never,
  );
  return { service, medias, produits, objets, lectures, annonces };
}

// ─────────────────────────────────────────────────────────────

describe('les cotes, lues dans les octets', () => {
  it('PNG, JPEG et WebP annoncent leur taille, et on la lit sans dépendance', () => {
    expect(dimensionsImage(png(1200, 900))).toEqual({ largeur: 1200, hauteur: 900 });
    expect(dimensionsImage(jpeg(640, 480))).toEqual({ largeur: 640, hauteur: 480 });
    expect(dimensionsImage(webp(1600, 1200))).toEqual({ largeur: 1600, hauteur: 1200 });
  });

  it('rend `null` sans lever quand l’en-tête ne se laisse pas lire', () => {
    // Les cotes sont un confort d'écran, jamais une condition d'admission : un
    // dépôt ne doit pas échouer parce qu'on n'a pas su compter des pixels.
    expect(dimensionsImage(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(20)]))).toBeNull();
    expect(dimensionsImage(Buffer.from('pas une image du tout'))).toBeNull();
  });
});

describe('l’empreinte et la clé d’objet', () => {
  it('la même photo donne la même empreinte, une autre en donne une autre', () => {
    expect(empreinteDe(PNG)).toBe(empreinteDe(png(1200, 900)));
    expect(empreinteDe(PNG)).not.toBe(empreinteDe(png(1200, 901)));
    expect(empreinteDe(PNG)).toMatch(/^[0-9a-f]{32}$/);
  });

  it('la clé est PLATE et préfixée par le restaurant — le cloisonnement d’abord', () => {
    // Deux restaurants qui déposent le même cliché occupent deux objets : une
    // clé partagée ferait qu'un retrait chez l'un casse la photo de l'autre.
    const cle = cleObjet(TENANT, empreinteDe(PNG));
    expect(cle).toBe(`media-${TENANT}-${empreinteDe(PNG)}`);
    expect(cle).not.toContain('/');
    expect(cleObjet(AUTRE_TENANT, empreinteDe(PNG))).not.toBe(cle);
  });
});

describe('déposer une photo', () => {
  it('écrit les octets AVANT la ligne, et rend une adresse dérivée du contenu', async () => {
    const { service, objets, medias } = atelier();
    const { media } = await service.deposer(TENANT, ORIGIN, WEBP, { actor: SESSION });

    const empreinte = empreinteDe(WEBP);
    expect(objets.has(cleObjet(TENANT, empreinte))).toBe(true);
    expect(medias.rows).toHaveLength(1);
    expect(media.urls.vignette).toBe(`${ORIGIN}/public/medias/${TENANT}/${empreinte}`);
    expect(media.largeur).toBe(1600);
    expect(media.hauteur).toBe(1200);
    expect(media.point).toEqual({ x: 0.5, y: 0.5 });
    expect(media.auteur?.id).toBe(SESSION.sub);
  });

  it('n’écrit JAMAIS la ligne si le stockage échoue — pas de vignette morte', async () => {
    const { service, medias } = atelier({ failPut: true });
    await expect(service.deposer(TENANT, ORIGIN, PNG)).rejects.toThrow(/hébergement d'images/);
    expect(medias.rows).toHaveLength(0);
  });

  it('refuse ce qui n’est pas une image reconnue aux octets, sans rien écrire', async () => {
    const { service, medias, objets } = atelier();
    await expect(service.deposer(TENANT, ORIGIN, Buffer.from('<svg/>'))).rejects.toThrow(
      /PNG, JPEG ou WebP/,
    );
    expect(medias.rows).toHaveLength(0);
    expect(objets.size).toBe(0);
  });

  it('refuse au-delà de la borne, en français et en Ko', async () => {
    const { service } = atelier();
    const enorme = Buffer.concat([PNG, Buffer.alloc(MEDIA_MAX_OCTETS)]);
    await expect(service.deposer(TENANT, ORIGIN, enorme)).rejects.toThrow(/Ko maximum/);
  });

  it('DÉDOUBLONNE : le même fichier déposé deux fois n’occupe qu’un objet', async () => {
    const { service, medias, objets } = atelier();
    const un = await service.deposer(TENANT, ORIGIN, PNG);
    const deux = await service.deposer(TENANT, ORIGIN, png(1200, 900));

    expect(deux.deduplique).toBe(true);
    expect(deux.media.id).toBe(un.media.id);
    expect(medias.rows).toHaveLength(1);
    expect(objets.size).toBe(1);
  });

  it('refuse proprement quand le quota est atteint, et dit ce qui l’occupe', async () => {
    const { service, medias } = atelier();
    // Une ligne qui remplit le quota à elle seule : ce qu'on vérifie, c'est le
    // refus et sa forme, pas l'arithmétique de Mongo.
    medias.seed({
      tenantId: TENANT,
      genre: 'photo',
      empreinte: 'a'.repeat(32),
      type: 'image/webp',
      octets: QUOTA_MEDIAS_OCTETS,
      stockage: 'objet',
      origine: 'depot',
      base: ORIGIN,
    });
    await expect(service.deposer(TENANT, ORIGIN, PNG)).rejects.toMatchObject({
      response: { message: expect.stringContaining('Médiathèque pleine') },
    });
    expect(medias.rows).toHaveLength(1);
  });

  it('les photos héritées ne consomment pas le quota — elles ne nous coûtent rien', () => {
    const heritee = vueMedia({
      _id: 'h1',
      tenantId: TENANT,
      empreinte: 'b'.repeat(32),
      type: 'image/webp',
      octets: 900_000,
      stockage: 'heritee',
      fichier: 'doner-kebab.webp',
    });
    const notre = vueMedia({
      _id: 'm1',
      tenantId: TENANT,
      empreinte: 'c'.repeat(32),
      type: 'image/webp',
      octets: 100,
      stockage: 'objet',
      base: ORIGIN,
    });
    const quota = quotaDe([heritee, notre]);
    expect(quota.octetsUtilises).toBe(100);
    expect(quota.medias).toBe(2);
  });
});

describe('servir les octets', () => {
  it('ne relit le magasin qu’une fois : le dépôt a déjà mis les octets en cache', async () => {
    const { service, lectures } = atelier();
    await service.deposer(TENANT, ORIGIN, PNG);
    const un = await service.servir(TENANT, empreinteDe(PNG));
    const deux = await service.servir(TENANT, empreinteDe(PNG));
    expect(un?.type).toBe('image/png');
    expect(deux?.corps.equals(PNG)).toBe(true);
    expect(lectures.count).toBe(0);
  });

  it('LE CLOISONNEMENT EST ABSOLU : la même empreinte sous un autre restaurant ne rend rien', async () => {
    const { service } = atelier();
    await service.deposer(TENANT, ORIGIN, PNG);
    expect(await service.servir(AUTRE_TENANT, empreinteDe(PNG))).toBeNull();
  });

  it('ne sert jamais un document, même par une adresse devinée', async () => {
    const { service, medias } = atelier();
    medias.seed({
      tenantId: TENANT,
      genre: 'document',
      empreinte: 'd'.repeat(32),
      type: 'image/png',
      octets: 10,
      stockage: 'objet',
    });
    expect(await service.servir(TENANT, 'd'.repeat(32))).toBeNull();
  });

  it('et il ne figure même pas dans le catalogue public', async () => {
    // Le filtrer à l'affichage seulement laisserait son adresse et ses
    // métadonnées dans la charge de la vitrine, à la portée de qui lit le JSON.
    const { service, medias } = atelier();
    medias.seed({
      tenantId: TENANT,
      genre: 'document',
      empreinte: 'd'.repeat(32),
      type: 'image/png',
      octets: 10,
      stockage: 'objet',
    });
    await service.deposer(TENANT, ORIGIN, PNG);
    const catalogue = await service.catalogue(TENANT);
    expect(catalogue.map((m) => m.genre)).toEqual(['photo']);
    // Le gérant, lui, voit TOUTE sa médiathèque : c'est la sienne.
    const { medias: sienne } = await service.lister(TENANT);
    expect(sienne).toHaveLength(2);
  });

  it('refuse une empreinte ou un restaurant mal formés sans toucher la base', async () => {
    const { service } = atelier();
    expect(await service.servir(TENANT, 'pas-une-empreinte')).toBeNull();
    expect(await service.servir('pas-un-id', empreinteDe(PNG))).toBeNull();
  });

  it('relit le magasin au premier service après redémarrage, puis sert du cache', async () => {
    const { service, medias, objets, lectures } = atelier();
    const empreinte = empreinteDe(WEBP);
    objets.set(cleObjet(TENANT, empreinte), WEBP);
    medias.seed({
      tenantId: TENANT,
      genre: 'photo',
      empreinte,
      type: 'image/webp',
      octets: WEBP.length,
      stockage: 'objet',
      base: ORIGIN,
    });
    expect((await service.servir(TENANT, empreinte))?.type).toBe('image/webp');
    await service.servir(TENANT, empreinte);
    expect(lectures.count).toBe(1);
  });
});

describe('décrire un média', () => {
  it('ne touche PAS l’adresse — c’est ce qui épargne la carte à une caisse hors ligne', async () => {
    const { service } = atelier();
    const { media } = await service.deposer(TENANT, ORIGIN, PNG);
    const decrit = await service.decrire(TENANT, media.id, {
      alt: 'Kebab maison',
      point: { x: 0.2, y: 0.7 },
    });
    expect(decrit.urls).toEqual(media.urls);
    expect(decrit.alt).toBe('Kebab maison');
    expect(decrit.point).toEqual({ x: 0.2, y: 0.7 });
  });

  it('n’écrit pas ce qui n’est pas transmis', async () => {
    const { service } = atelier();
    const { media } = await service.deposer(TENANT, ORIGIN, PNG);
    await service.decrire(TENANT, media.id, { alt: 'Gros plan' });
    const apres = await service.decrire(TENANT, media.id, { point: { x: 0, y: 0 } });
    expect(apres.alt).toBe('Gros plan');
  });

  it('un média d’un autre restaurant est introuvable, pas modifiable', async () => {
    const { service } = atelier();
    const { media } = await service.deposer(TENANT, ORIGIN, PNG);
    await expect(service.decrire(AUTRE_TENANT, media.id, { alt: 'x' })).rejects.toThrow(
      /introuvable/,
    );
  });
});

describe('retirer un média', () => {
  it('REFUSE quand des plats l’emploient — et les NOMME', async () => {
    const { service, produits } = atelier();
    const { media } = await service.deposer(TENANT, ORIGIN, PNG);
    produits.seed({ tenantId: TENANT, name: 'Kebab', medias: [media.id] });
    produits.seed({ tenantId: TENANT, name: 'Kebab Fromage', medias: [media.id] });

    // « 2 produits » n'aide pas un gérant à décider et l'oblige à chercher.
    const refus = await service.retirer(TENANT, media.id, false).catch((e: unknown) => e);
    const corps = (refus as { response: { attached: number; produits: { name: string }[] } })
      .response;
    expect(corps.attached).toBe(2);
    expect(corps.produits.map((p) => p.name)).toEqual(['Kebab', 'Kebab Fromage']);
  });

  it('confirmé, il détache les plats PUIS supprime l’objet', async () => {
    const { service, produits, objets, medias } = atelier();
    const { media } = await service.deposer(TENANT, ORIGIN, PNG);
    const plat = produits.seed({ tenantId: TENANT, name: 'Kebab', medias: [media.id] });

    const res = await service.retirer(TENANT, media.id, true);
    expect(res).toEqual({ deleted: true, detaches: 1 });
    expect(plat.medias).toEqual([]);
    expect(medias.rows).toHaveLength(0);
    expect(objets.size).toBe(0);
  });

  it('un média inemployé part sans confirmation', async () => {
    const { service, medias } = atelier();
    const { media } = await service.deposer(TENANT, ORIGIN, PNG);
    await service.retirer(TENANT, media.id, false);
    expect(medias.rows).toHaveLength(0);
  });

  it('retiré, ses octets ne sortent plus du cache', async () => {
    const { service } = atelier();
    const { media } = await service.deposer(TENANT, ORIGIN, PNG);
    await service.retirer(TENANT, media.id, false);
    expect(await service.servir(TENANT, empreinteDe(PNG))).toBeNull();
  });

  it('n’efface jamais les octets d’une photo héritée — ils ne sont pas à nous', async () => {
    const { service, medias, objets } = atelier();
    objets.set(cleObjet(TENANT, 'e'.repeat(32)), PNG);
    const doc = medias.seed({
      tenantId: TENANT,
      genre: 'photo',
      empreinte: 'e'.repeat(32),
      type: 'image/webp',
      octets: 10,
      stockage: 'heritee',
      fichier: 'doner-kebab.webp',
    });
    await service.retirer(TENANT, String(doc._id), false);
    expect(objets.size).toBe(1);
  });
});

describe('rattacher des photos à un plat', () => {
  it('pose la liste complète dans l’ordre — la première est la principale', async () => {
    const { service, produits } = atelier();
    const a = (await service.deposer(TENANT, ORIGIN, PNG)).media;
    const b = (await service.deposer(TENANT, ORIGIN, WEBP)).media;
    const plat = produits.seed({ tenantId: TENANT, name: 'Kebab', medias: [] });

    const res = await service.rattacher(TENANT, String(plat._id), [b.id, a.id]);
    expect(res.medias).toEqual([b.id, a.id]);

    const catalogue = catalogueMedias([a, b]);
    expect(photoUrlDe({ medias: plat.medias }, catalogue, 'carte')).toBe(b.urls.carte);
  });

  it('REFUSE un média d’un autre restaurant — sans dire qu’il existe', async () => {
    const { service, produits } = atelier();
    const voisin = (await service.deposer(AUTRE_TENANT, ORIGIN, PNG)).media;
    const plat = produits.seed({ tenantId: TENANT, name: 'Kebab', medias: [] });
    await expect(service.rattacher(TENANT, String(plat._id), [voisin.id])).rejects.toThrow(
      /introuvable dans votre médiathèque/,
    );
  });

  it('refuse un document : une facture n’a rien à faire sur une carte', async () => {
    const { service, produits, medias } = atelier();
    const doc = medias.seed({
      tenantId: TENANT,
      genre: 'document',
      empreinte: 'f'.repeat(32),
      type: 'image/png',
      octets: 10,
      stockage: 'objet',
    });
    const plat = produits.seed({ tenantId: TENANT, name: 'Kebab', medias: [] });
    await expect(service.rattacher(TENANT, String(plat._id), [String(doc._id)])).rejects.toThrow(
      /pas une photo de carte/,
    );
  });

  it('refuse au-delà de trois, et accepte la liste vide', async () => {
    const { service, produits, annonces } = atelier();
    const plat = produits.seed({ tenantId: TENANT, name: 'Kebab', medias: [] });
    const ids = [1, 2, 3, 4].map(() => String(new Types.ObjectId()));
    await expect(service.rattacher(TENANT, String(plat._id), ids)).rejects.toThrow(/au plus 3/);

    await service.rattacher(TENANT, String(plat._id), []);
    expect(plat.medias).toEqual([]);
    // La caisse et l'écran de salle doivent relire la carte : elle a changé.
    expect(annonces.join(' ')).toContain('menu');
  });
});

describe('le cache d’octets est BORNÉ — la différence avec le logo', () => {
  it('évince le plus anciennement servi quand le budget est dépassé', () => {
    const cache = new CacheOctets<{ corps: Buffer }>(30);
    cache.set('a', { corps: Buffer.alloc(20) });
    cache.set('b', { corps: Buffer.alloc(20) });
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBeDefined();
    expect(cache.poids).toBe(20);
  });

  it('ce qu’on sert reste : un accès repousse l’éviction', () => {
    const cache = new CacheOctets<{ corps: Buffer }>(30);
    cache.set('a', { corps: Buffer.alloc(10) });
    cache.set('b', { corps: Buffer.alloc(10) });
    cache.get('a'); // « a » repart en queue
    cache.set('c', { corps: Buffer.alloc(15) });
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBeDefined();
  });

  it('ne garde pas un fichier plus gros que le budget entier', () => {
    const cache = new CacheOctets<{ corps: Buffer }>(10);
    cache.set('a', { corps: Buffer.alloc(5) });
    cache.set('enorme', { corps: Buffer.alloc(50) });
    expect(cache.get('enorme')).toBeUndefined();
    expect(cache.get('a')).toBeDefined();
  });
});

/**
 * L'HÔTE DE LA REQUÊTE EST UNE ENTRÉE, PAS UNE VÉRITÉ.
 *
 * `POST /medias` ne reçoit aucune URL : il en FABRIQUE une à partir de
 * `X-Forwarded-Host` puis de `Host`, deux en-têtes que le client contrôle.
 * L'adresse obtenue part dans `photoUrl` sur la vitrine, l'écran de salle, la
 * caisse et les données structurées — exactement le contournement que la
 * chaîne libre `photoUrl` ouvrait, et qu'il serait absurde de fermer d'un côté
 * pour le rouvrir de l'autre.
 */
describe('l’hôte d’où une photo est déposée', () => {
  const HOTES = ['snackmanager.fr', 'localhost'] as const;
  type Req = Parameters<MediasController['deposer']>[4];

  const deposer = (headers: Record<string, string>) => {
    const service = {
      actif: true,
      deposer: (_id: string, origin: string) => Promise.resolve(origin),
    };
    const req = { protocol: 'https', headers, get: (n: string) => headers[n.toLowerCase()] };
    const ctrl = new MediasController(service as unknown as MediasService, {
      hotes: HOTES,
    } as OriginesImages);
    return ctrl.deposer(
      TENANT,
      SESSION,
      { buffer: PNG, mimetype: 'image/png', size: PNG.length },
      undefined,
      req as Req,
    );
  };

  it('accepte le domaine public et ses sous-domaines', async () => {
    await expect(deposer({ host: 'api.snackmanager.fr' })).resolves.toBe(
      'https://api.snackmanager.fr',
    );
  });

  it('refuse un X-Forwarded-Host forgé — les photos auraient été servies par un tiers', async () => {
    await expect(
      deposer({ 'x-forwarded-host': 'mechant.fr', host: 'api.snackmanager.fr' }),
    ).rejects.toThrow(/hôte que nous ne servons pas/);
  });

  it('refuse un faux sous-domaine : le point du suffixe n’est pas décoratif', async () => {
    await expect(deposer({ host: 'evilsnackmanager.fr' })).rejects.toThrow(
      /hôte que nous ne servons pas/,
    );
  });
});
