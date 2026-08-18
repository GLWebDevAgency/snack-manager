import { Module } from '@nestjs/common';
import { systemClock } from '@sm/domain';
import { CLOCK } from './site.tokens';
import { SiteConfig } from './site.config';
import { SiteController } from './site.controller';
import { HostResolutionCache } from './host-resolution.cache';
import { TenantSiteRepository } from './tenant-site.repository';
import { AddCustomDomain } from './add-custom-domain.usecase';
import { CheckDomainStatus } from './check-domain-status.usecase';
import { ListSiteAddresses } from './list-site-addresses.usecase';
import { RemoveCustomDomain } from './remove-custom-domain.usecase';
import { ResolveTenantByHost } from './resolve-tenant-by-host.usecase';

/**
 * « Votre site web » : sous-domaine automatique, domaines personnalisés,
 * résolution du Host entrant.
 *
 * Démonstration de l'architecture du monorepo — un cas d'usage par classe, tous
 * branchés sur le PORT `DomainRegistrar` de @sm/domain. L'ADAPTATEUR concret
 * (Railway, Cloudflare for SaaS…) est fourni ailleurs sous le jeton
 * `DOMAIN_REGISTRAR` : ce module ne le nomme jamais et n'a pas à être modifié
 * quand il change.
 *
 * `CLOCK` est fourni ici plutôt que codé en dur : le cache de résolution et les
 * dates de contrôle deviennent ainsi pilotables en test.
 * Les modèles Mongoose viennent de `DatabaseModule` (@Global).
 */
@Module({
  controllers: [SiteController],
  providers: [
    { provide: CLOCK, useValue: systemClock },
    SiteConfig,
    TenantSiteRepository,
    HostResolutionCache,
    ListSiteAddresses,
    AddCustomDomain,
    CheckDomainStatus,
    RemoveCustomDomain,
    ResolveTenantByHost,
  ],
  exports: [ResolveTenantByHost],
})
export class SiteModule {}
