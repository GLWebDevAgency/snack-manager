import {
  BadGatewayException,
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { LOGO_MAX_OCTETS } from '@sm/contracts';
import type { Tenant } from '@sm/db';
import { IMAGE_STORE } from '../../infrastructure/tokens';
import type { ImageStore } from '../../infrastructure/images/image-store';
import { detecterImage, type FormatImage } from './image-signature';

/**
 * LE LOGO DE L'ENSEIGNE — hébergé par nous, servi par nous.
 *
 * Le fichier vit sur R2 (clef plate `logo-<tenantId>`) mais le NAVIGATEUR ne
 * parle jamais à R2 : `logoUrl` pointe vers NOTRE route publique
 * (`/public/tenants/<slug>/logo?v=…`), qui relit l'objet une fois et le garde
 * en mémoire. Trois raisons à ce détour, pesées contre l'accès direct :
 *
 *  1. L'API REST R2 exige un jeton — impensable dans une page publique — et
 *     un bucket public exigerait un geste de tableau de bord Cloudflare par
 *     environnement, plus un domaine à câbler. Ici : zéro action de plus.
 *  2. Un logo fait au plus 512 Ko et change quelques fois par an : UNE
 *     lecture R2 par (re)démarrage et par changement, le reste sort du cache
 *     avec `Cache-Control: immutable` — le paramètre `?v=` change avec le
 *     fichier, jamais le contenu derrière une même URL.
 *  3. La même URL sert la caisse, la cuisine, le board et les tickets : le
 *     jour où l'on veut l'egress gratuit de bout en bout (bucket public +
 *     domaine), seule la construction de `logoUrl` change, pas les lecteurs.
 *
 * L'URL est ABSOLUE (bâtie sur l'hôte de la requête d'envoi, proxy Railway
 * résolu par `trust proxy`) : caisse et cuisine sont d'autres origines, un
 * chemin relatif y serait un lien mort.
 */
@Injectable()
export class LogoService {
  /** Cache de service : version (l'URL complète) → octets + type détecté. */
  private readonly cache = new Map<string, { version: string; corps: Buffer; type: FormatImage }>();

  constructor(
    @InjectModel('Tenant') private readonly tenants: Model<Tenant>,
    @Inject(IMAGE_STORE) private readonly store: ImageStore,
  ) {}

  get actif(): boolean {
    return this.store.enabled;
  }

  /**
   * La clef porte LA VERSION (`logo-<id>-<v>`), et c'est ce qui tue la course
   * entre deux envois simultanés (deux onglets, deux postes) : chacun écrit
   * SON objet, et la dernière écriture en base pointe un objet complet — sans
   * clef versionnée, R2 pouvait garder les octets du perdant pendant que la
   * base affichait le `?v=` du gagnant, et un cache `immutable` d'un an
   * figeait le mauvais logo chez les clients après le premier redémarrage.
   * La version se relit depuis `logoUrl` : une seule source de vérité.
   */
  private static cleDe(tenantId: string, version: string): string {
    return `logo-${tenantId}-${version}`;
  }

  private static versionDe(logoUrl: string): string | null {
    return /[?&]v=(\d+)/.exec(logoUrl)?.[1] ?? null;
  }

  /**
   * Pose le logo : refuse tout ce qui n'est pas une image reconnue AUX
   * OCTETS, écrit sur R2, puis fige l'URL versionnée sur le tenant. L'ordre
   * compte — l'URL ne s'écrit qu'après le stockage réussi : un lien sans
   * fichier derrière est exactement le lien mort qu'on refuse de fabriquer.
   */
  async poser(
    tenantId: string,
    origin: string,
    corps: Buffer,
    horloge: () => number = Date.now,
  ) {
    if (corps.length > LOGO_MAX_OCTETS) {
      throw new BadRequestException(
        `Fichier trop lourd (${Math.round(corps.length / 1024)} Ko) — 512 Ko maximum : un logo sert sur des tickets et des tablettes, pas en poster.`,
      );
    }
    const type = detecterImage(corps);
    if (!type) {
      throw new BadRequestException(
        'Format non reconnu — envoyez le logo en PNG, JPEG ou WebP (le SVG est refusé : il peut embarquer du script).',
      );
    }

    const tenant = await this.tenants.findById(tenantId);
    if (!tenant) throw new NotFoundException('Tenant introuvable');

    const version = String(horloge());
    try {
      await this.store.put(LogoService.cleDe(tenantId, version), corps, type);
    } catch {
      // Le vrai motif (jeton refusé, bucket absent…) est dans les journaux ;
      // au gérant, une phrase actionnable plutôt qu'un « Internal server error ».
      throw new BadGatewayException(
        "L'hébergement d'images n'a pas accepté le fichier — réessayez, et appelez-nous si ça persiste.",
      );
    }
    const ancienneVersion = tenant.logoUrl ? LogoService.versionDe(tenant.logoUrl) : null;
    const logoUrl = `${origin}/public/tenants/${tenant.slug}/logo?v=${version}`;
    const doc = await this.tenants.findByIdAndUpdate(tenantId, { $set: { logoUrl } }, { new: true });

    // Le service suivant n'a pas à relire R2 : on vient d'avoir les octets.
    this.cache.set(tenantId, { version: logoUrl, corps, type });

    // Ménage du prédécesseur, en dernier et sans faire échouer l'envoi : un
    // objet orphelin coûte quelques Ko, un envoi « raté » après stockage
    // réussi coûterait la confiance dans le bouton.
    if (ancienneVersion && ancienneVersion !== version) {
      await this.store.delete(LogoService.cleDe(tenantId, ancienneVersion)).catch(() => {});
    }
    return doc;
  }

  /** Retire le logo — l'objet d'abord, l'URL ensuite, le cache avec. */
  async retirer(tenantId: string) {
    const tenant = await this.tenants.findById(tenantId);
    const version = tenant?.logoUrl ? LogoService.versionDe(tenant.logoUrl) : null;
    if (version) await this.store.delete(LogoService.cleDe(tenantId, version)).catch(() => {});
    this.cache.delete(tenantId);
    return this.tenants.findByIdAndUpdate(tenantId, { $set: { logoUrl: null } }, { new: true });
  }

  /**
   * Sert les octets du logo d'un établissement, par son slug public.
   * `null` : pas de logo (pas d'établissement, URL vide, ou objet disparu).
   */
  async servir(slug: string): Promise<{ corps: Buffer; type: FormatImage } | null> {
    const tenant = await this.tenants.findOne({ slug }, { logoUrl: 1 }).lean();
    if (!tenant?.logoUrl) return null;

    const id = String(tenant._id);
    const enCache = this.cache.get(id);
    // La version EST l'URL stockée : un nouvel envoi change `?v=`, donc l'URL,
    // donc invalide l'entrée — sans horloge ni compteur à synchroniser.
    if (enCache && enCache.version === tenant.logoUrl) {
      return { corps: enCache.corps, type: enCache.type };
    }

    const version = LogoService.versionDe(tenant.logoUrl);
    if (!version) return null; // URL d'un autre monde (posée à la main) : pas à nous.
    const corps = await this.store.get(LogoService.cleDe(id, version));
    if (!corps) return null;
    const type = detecterImage(corps);
    if (!type) return null; // Objet corrompu : mieux vaut pas de logo qu'un octet stream.

    this.cache.set(id, { version: tenant.logoUrl, corps, type });
    return { corps, type };
  }
}
