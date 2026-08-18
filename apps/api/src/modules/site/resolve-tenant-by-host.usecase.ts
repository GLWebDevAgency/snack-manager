import { Injectable, NotFoundException } from '@nestjs/common';
import { TenantSlug } from '@sm/domain';
import { SiteConfig } from './site.config';
import { HostResolutionCache } from './host-resolution.cache';
import { TenantSiteRepository, type TenantIdentity } from './tenant-site.repository';
import type { ResolvedHost } from './site.view';

/**
 * Réduit un en-tête `Host` brut à un nom d'hôte comparable.
 *
 * Le Host arrive tel que le navigateur (ou un proxy) l'a écrit : port collé,
 * casse hasardeuse, point final, parfois une URL entière quand un intégrateur
 * recopie la barre d'adresse. Tout cela désigne le même établissement.
 */
export function normalizeHost(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/:\d+$/, '')
    .replace(/\.$/, '');
}

/**
 * CAS D'USAGE — « qui dois-je servir sur cette adresse ? »
 *
 * Deux chemins seulement :
 *  1. `classfood.snackmanager.app` — le sous-domaine automatique, actif dès la
 *     création du compte, que le restaurateur n'a rien à configurer ;
 *  2. `commander.classfood.fr` — un domaine personnalisé DÉJÀ actif.
 *
 * Appelé à chaque requête du site public, donc systématiquement passé par un
 * cache court (cf. `HostResolutionCache`).
 */
@Injectable()
export class ResolveTenantByHost {
  constructor(
    private readonly repository: TenantSiteRepository,
    private readonly cache: HostResolutionCache,
    private readonly config: SiteConfig,
  ) {}

  /** Lève 404 si l'adresse n'est rattachée à aucun établissement. */
  async execute(rawHost: string): Promise<ResolvedHost> {
    const resolved = await this.resolve(rawHost);
    if (!resolved) {
      throw new NotFoundException(
        `Aucun établissement n'est servi sur « ${normalizeHost(rawHost)} ».`,
      );
    }
    return resolved;
  }

  private async resolve(rawHost: string): Promise<ResolvedHost | null> {
    const hostname = normalizeHost(rawHost);
    if (!hostname) return null;

    const cached = this.cache.get(hostname);
    if (cached !== undefined) return cached;

    const resolved =
      (await this.resolveSubdomain(hostname)) ?? (await this.resolveCustomDomain(hostname));

    // Les échecs sont mémorisés aussi : les robots et les scans de Host sont la
    // première source de requêtes sur des adresses inconnues.
    this.cache.set(hostname, resolved);
    return resolved;
  }

  private async resolveSubdomain(hostname: string): Promise<ResolvedHost | null> {
    const suffix = `.${this.config.rootDomain}`;
    if (!hostname.endsWith(suffix)) return null;

    const label = hostname.slice(0, -suffix.length);
    // Un seul niveau : « demo.classfood.snackmanager.app » n'est pas une adresse
    // que nous servons, et l'accepter ouvrirait une seconde adresse par tenant.
    if (!label || label.includes('.')) return null;

    // Le slug est un concept métier : c'est `TenantSlug` qui dit ce qui est
    // recevable (longueur, mots réservés comme « api » ou « admin »).
    const slug = TenantSlug.create(label);
    // `create` normalise ; si la normalisation a changé quoi que ce soit,
    // l'adresse saisie n'est pas exactement celle du restaurant.
    if (!slug.ok || slug.value.value !== label) return null;

    const tenant = await this.repository.findBySlug(slug.value.value);
    return tenant ? view(hostname, tenant, 'subdomain') : null;
  }

  private async resolveCustomDomain(hostname: string): Promise<ResolvedHost | null> {
    const tenant = await this.repository.findByActiveHostname(hostname);
    return tenant ? view(hostname, tenant, 'custom_domain') : null;
  }
}

function view(
  hostname: string,
  tenant: TenantIdentity,
  matchedBy: ResolvedHost['matchedBy'],
): ResolvedHost {
  return {
    hostname,
    tenantId: tenant.tenantId,
    slug: tenant.slug,
    name: tenant.name,
    brandColor: tenant.brandColor,
    logoUrl: tenant.logoUrl,
    matchedBy,
  };
}
