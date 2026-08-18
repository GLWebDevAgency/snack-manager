import { Injectable, NotFoundException } from '@nestjs/common';
import type { DomainRegistrar } from '@sm/domain';
import { InjectRegistrar } from './site.tokens';
import { SiteConfig } from './site.config';
import { TenantSiteRepository } from './tenant-site.repository';
import { toDomainView, type SiteAddressesView } from './site.view';

/**
 * CAS D'USAGE — l'écran « Votre site web » à l'ouverture.
 *
 * Le sous-domaine automatique et les domaines personnalisés sont renvoyés
 * ensemble : ce sont deux façons d'atteindre la même page de commande, et le
 * restaurateur doit voir d'un coup d'œil qu'il a DÉJÀ une adresse en ligne
 * avant qu'on lui parle de DNS.
 */
@Injectable()
export class ListSiteAddresses {
  constructor(
    // Lecture seule : ici le registrar ne sert qu'à nommer le fournisseur.
    @InjectRegistrar() private readonly registrar: DomainRegistrar | null,
    private readonly repository: TenantSiteRepository,
    private readonly config: SiteConfig,
  ) {}

  async execute(tenantId: string): Promise<SiteAddressesView> {
    const tenant = await this.repository.findById(tenantId);
    if (!tenant) throw new NotFoundException('Établissement introuvable');

    const hostname = this.config.subdomainFor(tenant.slug);
    const domains = await this.repository.list(tenantId);

    return {
      subdomain: { hostname, url: this.config.urlFor(hostname) },
      domains: domains.map(toDomainView),
      provider: this.registrar?.providerName ?? null,
    };
  }
}
