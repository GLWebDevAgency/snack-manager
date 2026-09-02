import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import Redis from 'ioredis';
import {
  detecterImage,
  dimensionsImage,
  EMPREINTE_RE,
  estPublic,
  MEDIA_ALT_MAX,
  MEDIA_GENRES_PUBLICS,
  MEDIA_MAX_OCTETS,
  MEDIAS_PAR_PRODUIT_MAX,
  QUOTA_MEDIAS_OCTETS,
  urlsMedia,
  type FormatImage,
  type JwtPayload,
  type MediaDescribe,
  type MediaVue,
  type PointInteret,
  type QuotaMedias,
} from '@sm/contracts';
import { empreinteDe, type Media, type Product } from '@sm/db';
import { REDIS_PUB } from '../../redis.module';
import { publierMenuMisAJour } from '../../common/menu-updated';
import { IMAGE_STORE } from '../../infrastructure/tokens';
import type { ImageStore } from '../../infrastructure/images/image-store';
import { CacheOctets } from './cache-octets';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * LA MÉDIATHÈQUE — déposer, décrire, rattacher, retirer, servir
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Bâtie sur le chemin éprouvé du logo (`logo.service.ts`), dont elle reprend
 * les quatre disciplines qui comptent :
 *
 *   · le format est détecté AUX OCTETS, jamais à l'extension ni au type
 *     annoncé — les deux sont déclaratifs ;
 *   · l'écriture du magasin passe AVANT l'écriture de la base : « un lien sans
 *     fichier derrière est le lien mort qu'on refuse de fabriquer » ;
 *   · un refus du magasin ressort en phrase actionnable (502), jamais en
 *     « Internal server error » ;
 *   · les octets servis sortent d'un cache mémoire, parce que l'API REST de
 *     Cloudflare est limitée en débit.
 *
 * Et trois différences, toutes voulues :
 *
 *   1. L'ADRESSE PORTE L'EMPREINTE DU CONTENU, pas une version d'horloge. La
 *      caisse fonctionne hors ligne et garde un cache d'images : une adresse
 *      qui changerait à chaque retouche de fiche lui ferait retélécharger la
 *      carte entière en plein service. Corollaire gratuit — le dédoublonnage.
 *   2. LE CACHE EST BORNÉ (`CacheOctets`). Un logo pèse 512 Ko ; une
 *      médiathèque peut peser 256 Mio, et la `Map` sans borne du logo ferait
 *      tomber l'API.
 *   3. UN QUOTA PAR RESTAURANT. Le stockage est le premier poste qui coûte à
 *      l'usage, et l'audit du 28/08 a montré qu'aucune limite métier par
 *      établissement n'existait nulle part.
 *
 * ─── CE QUI N'EST PAS JOURNALISÉ, ET POURQUOI ───
 *
 * Aucun geste de médiathèque n'écrit au registre du restaurant. Ce n'est pas
 * un oubli : `TENANT_AUDIT_ACTIONS` (@sm/contracts) écarte explicitement « nom,
 * description, PHOTO, ordre d'affichage d'un produit » — « aucune conséquence
 * sur l'argent ni sur la disponibilité, c'est de la mise en page ». Une ligne
 * par photo déposée noierait celles qui se défendent en contrôle. Le logo,
 * lui, est journalisé parce qu'il est l'identité de l'enseigne sur les tickets
 * et les factures ; la photo d'un tacos ne l'est pas.
 */

/** Le budget mémoire du cache d'octets servis, tous restaurants confondus. */
const CACHE_BUDGET_OCTETS = 64 * 1024 * 1024;

/** Ce qu'une lecture de média rend au contrôleur. */
export type OctetsMedia = { corps: Buffer; type: FormatImage };

/** Le document tel qu'on le lit — `.lean()` rend un sac de clés. */
type MediaLu = {
  _id: unknown;
  tenantId?: unknown;
  genre?: unknown;
  empreinte?: unknown;
  type?: unknown;
  octets?: unknown;
  largeur?: unknown;
  hauteur?: unknown;
  point?: { x?: unknown; y?: unknown } | null;
  alt?: unknown;
  stockage?: unknown;
  origine?: unknown;
  base?: unknown;
  fichier?: unknown;
  auteurId?: unknown;
  auteurNom?: unknown;
  createdAt?: unknown;
};

/**
 * L'empreinte vient de `@sm/db`, où vit l'index unique qui en dépend — c'est
 * l'identité d'un média, pas une commodité de ce service. La reprise
 * `backfill:medias` calcule donc rigoureusement la même.
 */
export { empreinteDe };

/**
 * LA CLÉ D'OBJET — plate, sans barre oblique (contrainte du port R2 : le
 * segment d'URL `objects/{key}` encodé n'a pas à porter la question « %2F
 * vaut-il / ? »), et PRÉFIXÉE PAR LE RESTAURANT.
 *
 * Deux restaurants qui déposent le même cliché occupent donc deux objets. Ce
 * n'est pas un raté du dédoublonnage, c'est le cloisonnement qui passe avant :
 * une clé partagée ferait qu'un restaurant supprimant sa photo casserait celle
 * d'un autre — et qu'un compte fermé emporterait les images d'un voisin.
 */
export function cleObjet(tenantId: string, empreinte: string): string {
  return `media-${tenantId}-${empreinte}`;
}

/**
 * LA VUE PROJETÉE, en liste blanche.
 *
 * Ni `base`, ni `tenantId`, ni clé d'objet : les adresses en SONT dérivées et
 * les livrer en plus donnerait aux écrans une seconde façon de les fabriquer,
 * qui divergerait le jour où un transformateur d'images s'installe.
 */
export function vueMedia(doc: MediaLu, utilisePar = 0): MediaVue {
  const id = String(doc._id);
  const tenantId = String(doc.tenantId ?? '');
  const empreinte = String(doc.empreinte ?? '');
  const stockage = doc.stockage === 'heritee' ? ('heritee' as const) : ('objet' as const);
  const cree = doc.createdAt;
  return {
    id,
    genre: doc.genre === 'document' ? 'document' : 'photo',
    empreinte,
    type: (doc.type ?? 'image/webp') as MediaVue['type'],
    octets: Number(doc.octets ?? 0),
    largeur: typeof doc.largeur === 'number' ? doc.largeur : null,
    hauteur: typeof doc.hauteur === 'number' ? doc.hauteur : null,
    point: {
      x: typeof doc.point?.x === 'number' ? doc.point.x : 0.5,
      y: typeof doc.point?.y === 'number' ? doc.point.y : 0.5,
    },
    alt: String(doc.alt ?? ''),
    stockage,
    origine: doc.origine === 'reprise' ? 'reprise' : 'depot',
    auteur: doc.auteurId ? { id: String(doc.auteurId), nom: String(doc.auteurNom ?? '') } : null,
    deposeLe: cree instanceof Date ? cree.toISOString() : null,
    urls: urlsMedia({
      stockage,
      tenantId,
      empreinte,
      base: typeof doc.base === 'string' ? doc.base : null,
      fichier: typeof doc.fichier === 'string' ? doc.fichier : null,
    }),
    utilisePar,
  };
}

@Injectable()
export class MediasService {
  /** Clé : `<tenantId>:<empreinte>` — l'empreinte rend l'entrée non périssable. */
  private readonly cache = new CacheOctets<OctetsMedia>(CACHE_BUDGET_OCTETS);

  constructor(
    @InjectModel('Media') private readonly medias: Model<Media>,
    @InjectModel('Product') private readonly products: Model<Product>,
    @Inject(IMAGE_STORE) private readonly store: ImageStore,
    @Inject(REDIS_PUB) private readonly redis: Redis,
  ) {}

  get actif(): boolean {
    return this.store.enabled;
  }

  // ───────────────────────────────────────────────────────────
  // Lecture
  // ───────────────────────────────────────────────────────────

  /**
   * LE CATALOGUE D'UN RESTAURANT — la lecture que consomment toutes les
   * charges publiques pour dériver `photoUrl`.
   *
   * Une requête, jamais une par produit : une carte de cent produits qui
   * résoudrait ses photos une à une ferait cent allers-retours pour une
   * collection qui tient en quelques dizaines de lignes.
   *
   * ─── LES GENRES PUBLICS SEULEMENT, ET C'EST LA MÊME LISTE QUE LA ROUTE ───
   *
   * Ce catalogue voyage dans des charges PUBLIQUES (la vitrine, la carte de la
   * caisse, l'écran de salle). Un document — une facture fournisseur
   * photographiée, demain — n'a donc rien à y faire, même si aucun produit ne
   * le référence : le filtrer seulement à l'affichage laisserait ses
   * métadonnées et son adresse dans la charge, à la portée de qui lit le JSON.
   * La route de service applique la même liste (`servir`), et c'est délibéré :
   * la garde vaut à la lecture ET à la projection, jamais à un seul des deux.
   * `lister`, réservée au gérant, rend tout — c'est SA médiathèque.
   */
  async catalogue(tenantId: string): Promise<MediaVue[]> {
    const docs = await this.medias
      .find({ tenantId, genre: { $in: [...MEDIA_GENRES_PUBLICS] } }, { __v: 0 })
      .sort({ createdAt: -1 })
      .lean<MediaLu[]>();
    return docs.map((d) => vueMedia(d));
  }

  /**
   * La médiathèque VUE PAR LE GÉRANT : le catalogue, plus le nombre de
   * produits qui se servent de chaque média, plus l'état du quota.
   *
   * Le comptage est ici et pas sur la charge publique : c'est ce qui rend le
   * retrait explicable (« trois plats s'en servent ») plutôt que silencieux,
   * et le mangeur n'a rien à faire de cette information.
   */
  async lister(tenantId: string): Promise<{ medias: MediaVue[]; quota: QuotaMedias }> {
    const [docs, usages] = await Promise.all([
      this.medias.find({ tenantId }, { __v: 0 }).sort({ createdAt: -1 }).lean<MediaLu[]>(),
      this.products
        .find({ tenantId, medias: { $exists: true, $ne: [] } }, { medias: 1 })
        .lean(),
    ]);

    const compte = new Map<string, number>();
    for (const p of usages) {
      for (const id of (p.medias ?? []) as unknown[]) {
        const cle = String(id);
        compte.set(cle, (compte.get(cle) ?? 0) + 1);
      }
    }

    const medias = docs.map((d) => vueMedia(d, compte.get(String(d._id)) ?? 0));
    return { medias, quota: quotaDe(medias) };
  }

  // ───────────────────────────────────────────────────────────
  // Dépôt
  // ───────────────────────────────────────────────────────────

  /**
   * DÉPOSE UNE PHOTO.
   *
   * L'ordre est celui du logo, et pour la même raison : les octets d'abord, la
   * ligne ensuite. Une ligne écrite avant un stockage raté serait une vignette
   * cassée dans la médiathèque du gérant, et une photo de plat qui ne charge
   * jamais sur sa vitrine.
   *
   * `origin` est l'origine http(s) sous laquelle le dépôt arrive, DÉJÀ validée
   * contre la liste blanche par le contrôleur — même garde que `PUT
   * /tenants/me/logo`, et pour le même motif : l'hôte de la requête est une
   * entrée, pas une vérité, et l'URL fabriquée ici finit en `src` chez tous les
   * clients du restaurant.
   */
  async deposer(
    tenantId: string,
    origin: string,
    corps: Buffer,
    options: { alt?: string; actor?: JwtPayload; auteurNom?: string } = {},
  ): Promise<{ media: MediaVue; quota: QuotaMedias; deduplique: boolean }> {
    if (corps.length > MEDIA_MAX_OCTETS) {
      throw new BadRequestException(
        `Photo trop lourde (${Math.round(corps.length / 1024)} Ko) — ${Math.round(MEDIA_MAX_OCTETS / 1024)} Ko maximum : ` +
          "elle est servie telle quelle à tous vos clients, sur leur forfait mobile.",
      );
    }
    const type = detecterImage(corps);
    if (!type) {
      throw new BadRequestException(
        'Format non reconnu — envoyez la photo en PNG, JPEG ou WebP (le SVG est refusé : il peut embarquer du script).',
      );
    }

    const empreinte = empreinteDe(corps);

    /*
     * LE DÉDOUBLONNAGE, D'ABORD.
     *
     * Rendre la ligne existante plutôt que d'en créer une seconde n'est pas
     * qu'une économie d'octets : c'est ce qui évite au gérant de voir deux
     * vignettes identiques dans sa bibliothèque et de ne plus savoir laquelle
     * ses plats emploient. Le geste redevient donc IDEMPOTENT, comme le dépôt
     * de logo l'est par nature.
     */
    const dejaLa = await this.medias.findOne({ tenantId, empreinte }).lean<MediaLu | null>();
    if (dejaLa) {
      this.cache.set(`${tenantId}:${empreinte}`, { corps, type });
      return {
        media: vueMedia(dejaLa),
        quota: quotaDe(await this.catalogue(tenantId)),
        deduplique: true,
      };
    }

    /*
     * LE QUOTA, MESURÉ AVANT L'ÉCRITURE.
     *
     * Il n'est pas atomique et n'a pas à l'être : deux dépôts simultanés
     * peuvent le dépasser de deux Mio sur 256. Un verrou pour ça coûterait un
     * aller-retour Redis par photo déposée, contre un dépassement borné par la
     * taille d'un fichier. Ce qu'on refuse, c'est le remplissage silencieux
     * d'un disque, pas le franchissement d'une frontière à l'octet près.
     */
    const catalogue = await this.catalogue(tenantId);
    const quotaAvant = quotaDe(catalogue);
    if (quotaAvant.octetsUtilises + corps.length > QUOTA_MEDIAS_OCTETS) {
      throw new ConflictException({
        message:
          `Médiathèque pleine : ${mo(quotaAvant.octetsUtilises)} sur ${mo(QUOTA_MEDIAS_OCTETS)} occupés ` +
          `par ${quotaAvant.medias} photo(s). Retirez-en avant d'en ajouter — ou appelez-nous, on agrandit.`,
        quota: quotaAvant,
      });
    }

    try {
      await this.store.put(cleObjet(tenantId, empreinte), corps, type);
    } catch {
      // Le vrai motif (jeton refusé, bucket absent…) est dans les journaux ;
      // au gérant, une phrase actionnable plutôt qu'un « Internal server error ».
      throw new BadGatewayException(
        "L'hébergement d'images n'a pas accepté la photo — réessayez, et appelez-nous si ça persiste.",
      );
    }

    const cotes = dimensionsImage(corps);
    const doc = await this.medias.create({
      tenantId: new Types.ObjectId(tenantId),
      genre: 'photo',
      empreinte,
      type,
      octets: corps.length,
      largeur: cotes?.largeur ?? null,
      hauteur: cotes?.hauteur ?? null,
      point: { x: 0.5, y: 0.5 },
      alt: (options.alt ?? '').slice(0, MEDIA_ALT_MAX),
      stockage: 'objet',
      origine: 'depot',
      base: origin,
      fichier: null,
      auteurId: options.actor?.sub ?? null,
      auteurNom: options.auteurNom ?? '',
    });

    // Les octets viennent d'être en main : le premier service ne relira pas R2.
    this.cache.set(`${tenantId}:${empreinte}`, { corps, type });

    const media = vueMedia(doc.toObject() as MediaLu);
    return { media, quota: quotaDe([...catalogue, media]), deduplique: false };
  }

  // ───────────────────────────────────────────────────────────
  // Décrire
  // ───────────────────────────────────────────────────────────

  /**
   * Texte alternatif et point d'intérêt — et RIEN qui touche les octets.
   *
   * C'est la propriété qui rend le §3 vrai : décrire un média ne change pas
   * son empreinte, donc pas son adresse, donc la caisse hors ligne ne
   * retélécharge rien. Un service qui laisserait remplacer les octets ici
   * effacerait cette garantie sans que personne le remarque.
   */
  async decrire(tenantId: string, id: string, patch: MediaDescribe): Promise<MediaVue> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException('Média introuvable');
    const $set: Record<string, unknown> = {};
    if (patch.alt !== undefined) $set.alt = patch.alt.slice(0, MEDIA_ALT_MAX);
    if (patch.point !== undefined) $set.point = borner(patch.point);

    const doc = await this.medias
      .findOneAndUpdate({ _id: id, tenantId }, { $set }, { new: true, runValidators: true })
      .lean<MediaLu | null>();
    if (!doc) throw new NotFoundException('Média introuvable');

    // La carte change d'apparence sur toutes les surfaces qui recadrent autour
    // du point : la caisse et l'écran de salle doivent la relire.
    if (patch.point !== undefined) {
      publierMenuMisAJour(this.redis, tenantId, { scope: 'media', id });
    }
    return vueMedia(doc);
  }

  // ───────────────────────────────────────────────────────────
  // Retrait
  // ───────────────────────────────────────────────────────────

  /**
   * RETIRER UN MÉDIA — refusé ou décrit, jamais silencieux.
   *
   * Un média employé par des produits ne part pas d'un clic : le refus (409)
   * NOMME les plats concernés, parce que « 3 produits » n'aide pas un gérant à
   * décider et l'oblige à chercher. `force` détache d'abord, puis supprime —
   * exactement la mécanique éprouvée de `deleteCategory`, et pour la même
   * raison : ce qui est destructeur se confirme, ce qui est confirmé s'exécute
   * en entier.
   *
   * L'objet R2 part EN DERNIER et sans faire échouer le retrait : un objet
   * orphelin coûte quelques Ko, une suppression « ratée » après détachement
   * réussi laisserait des produits sans photo et un média toujours listé.
   */
  async retirer(
    tenantId: string,
    id: string,
    force: boolean,
  ): Promise<{ deleted: true; detaches: number }> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException('Média introuvable');
    const doc = await this.medias.findOne({ _id: id, tenantId }).lean<MediaLu | null>();
    if (!doc) throw new NotFoundException('Média introuvable');

    const oid = new Types.ObjectId(id);
    const employeurs = await this.products
      .find({ tenantId, medias: oid }, { name: 1 })
      .lean<{ _id: unknown; name?: unknown }[]>();

    if (employeurs.length > 0 && !force) {
      throw new ConflictException({
        message: `${employeurs.length} plat(s) emploient cette photo — confirmer le retrait`,
        attached: employeurs.length,
        produits: employeurs.map((p) => ({ id: String(p._id), name: String(p.name ?? '') })),
      });
    }

    if (employeurs.length > 0) {
      await this.products.updateMany({ tenantId, medias: oid }, { $pull: { medias: oid } });
    }
    await this.medias.deleteOne({ _id: id, tenantId });

    const empreinte = String(doc.empreinte ?? '');
    this.cache.supprimer(`${tenantId}:${empreinte}`);
    // Les octets d'un média HÉRITÉ ne sont pas à nous : ils vivent dans le
    // paquet web et servent peut-être encore le repli d'un autre produit.
    if (doc.stockage !== 'heritee' && empreinte) {
      await this.store.delete(cleObjet(tenantId, empreinte)).catch(() => {});
    }

    if (employeurs.length > 0) {
      publierMenuMisAJour(this.redis, tenantId, { scope: 'media', id, deleted: true });
    }
    return { deleted: true, detaches: employeurs.length };
  }

  // ───────────────────────────────────────────────────────────
  // Rattachement à un produit
  // ───────────────────────────────────────────────────────────

  /**
   * LES PHOTOS D'UN PLAT — la liste complète, dans l'ordre voulu.
   *
   * Un seul geste pour attacher, détacher et réordonner (cf.
   * `ProduitMediasSchema`). La PREMIÈRE est la photo principale : c'est elle
   * dont `photoUrl` dérive, et réordonner suffit donc à changer la photo qui
   * s'affiche partout, sans rien retélécharger d'autre.
   *
   * Trois vérifications, toutes indispensables :
   *   · chaque média EXISTE et appartient à CE restaurant — sans quoi un
   *     gérant afficherait la photo d'un concurrent sur sa carte, et la route
   *     publique la servirait sous son slug ;
   *   · chaque média est d'un genre PUBLIC — une facture fournisseur
   *     photographiée n'a rien à faire sur une vitrine ;
   *   · la borne de trois, portée aussi par le schéma d'entrée.
   */
  async rattacher(tenantId: string, produitId: string, ids: string[]): Promise<{ medias: string[] }> {
    if (!Types.ObjectId.isValid(produitId)) throw new NotFoundException('Produit introuvable');

    const uniques = [...new Set(ids.map((s) => s.trim()).filter((s) => s !== ''))];
    if (uniques.length > MEDIAS_PAR_PRODUIT_MAX) {
      throw new BadRequestException(`Un plat porte au plus ${MEDIAS_PAR_PRODUIT_MAX} photos.`);
    }
    if (uniques.some((id) => !Types.ObjectId.isValid(id))) {
      throw new BadRequestException('Référence de média invalide.');
    }

    if (uniques.length > 0) {
      const trouves = await this.medias
        .find({ tenantId, _id: { $in: uniques.map((id) => new Types.ObjectId(id)) } }, { genre: 1 })
        .lean<{ _id: unknown; genre?: unknown }[]>();
      const parId = new Map(trouves.map((m) => [String(m._id), m]));
      for (const id of uniques) {
        const media = parId.get(id);
        // Le même message pour « n'existe pas » et « n'est pas à vous » : une
        // réponse qui distinguerait les deux dirait à un gérant curieux quels
        // identifiants existent chez ses voisins.
        if (!media) throw new NotFoundException('Média introuvable dans votre médiathèque.');
        if (!estPublic(media.genre === 'document' ? 'document' : 'photo')) {
          throw new BadRequestException(
            "Ce document n'est pas une photo de carte — il ne peut pas s'afficher sur un plat.",
          );
        }
      }
    }

    const prod = await this.products.findOneAndUpdate(
      { _id: produitId, tenantId },
      { $set: { medias: uniques.map((id) => new Types.ObjectId(id)) } },
      { new: true },
    );
    if (!prod) throw new NotFoundException('Produit introuvable');

    publierMenuMisAJour(this.redis, tenantId, { scope: 'product', id: produitId });
    return { medias: uniques };
  }

  // ───────────────────────────────────────────────────────────
  // Service des octets
  // ───────────────────────────────────────────────────────────

  /**
   * SERT LES OCTETS D'UN MÉDIA, SOUS LE RESTAURANT QUI LE POSSÈDE.
   *
   * Le cloisonnement est ABSOLU et il est dans la requête, pas dans un `if` :
   * `{ tenantId, empreinte }`. Une empreinte devinée sous le mauvais
   * restaurant ne rend rien, même si le média existe ailleurs — et la clé
   * d'objet, elle aussi préfixée par le restaurant, ne se laisse pas non plus
   * atteindre de biais.
   *
   * Un média `document` n'est JAMAIS servi ici, quoi qu'en dise l'appelant :
   * la route est publique, et c'est le genre qui décide de la garde.
   *
   * `null` : rien à servir (empreinte inconnue, genre non public, objet
   * disparu, octets corrompus). Le contrôleur en fait un 404 — jamais un 500,
   * et jamais un flux d'octets dont on ne sait pas ce qu'il contient.
   */
  async servir(tenantId: string, empreinte: string): Promise<OctetsMedia | null> {
    if (!Types.ObjectId.isValid(tenantId) || !EMPREINTE_RE.test(empreinte)) return null;

    const cle = `${tenantId}:${empreinte}`;
    const enCache = this.cache.get(cle);
    // L'empreinte EST le contenu : une entrée en cache ne peut pas être périmée.
    if (enCache) return enCache;

    const doc = await this.medias
      .findOne({ tenantId, empreinte }, { genre: 1, stockage: 1 })
      .lean<{ genre?: unknown; stockage?: unknown } | null>();
    if (!doc) return null;
    if (!estPublic(doc.genre === 'document' ? 'document' : 'photo')) return null;
    // Une photo héritée est servie par le paquet web, pas par nous : son
    // adresse est `/photos/…` et cette route n'a rien à en dire.
    if (doc.stockage === 'heritee') return null;

    const corps = await this.store.get(cleObjet(tenantId, empreinte));
    if (!corps) return null;
    const type = detecterImage(corps);
    if (!type) return null; // Objet corrompu : mieux vaut 404 qu'un flux d'octets.

    this.cache.set(cle, { corps, type });
    return { corps, type };
  }
}

/** Bornage défensif : zod l'a déjà fait, la base le refait, ici on n'invente pas. */
function borner(p: PointInteret): PointInteret {
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  return { x: clamp(p.x), y: clamp(p.y) };
}

/**
 * L'ÉTAT DU QUOTA.
 *
 * Ne comptent que les médias dont NOUS stockons les octets : les photos
 * héritées du pilote vivent dans le paquet web et ne nous coûtent rien de
 * plus. Les compter reviendrait à facturer un espace que personne n'occupe.
 */
export function quotaDe(medias: readonly MediaVue[]): QuotaMedias {
  const notres = medias.filter((m) => m.stockage === 'objet');
  return {
    octetsUtilises: notres.reduce((somme, m) => somme + m.octets, 0),
    octetsMax: QUOTA_MEDIAS_OCTETS,
    medias: medias.length,
  };
}

const mo = (octets: number): string => `${Math.round(octets / (1024 * 1024))} Mo`;
