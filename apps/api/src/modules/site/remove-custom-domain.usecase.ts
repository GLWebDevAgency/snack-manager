import {
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { DomainRegistrar } from '@sm/domain';
import { InjectRegistrar, requireRegistrar } from './site.tokens';
import { HostResolutionCache } from './host-resolution.cache';
import { TenantSiteRepository } from './tenant-site.repository';

/**
 * CAS D'USAGE — détacher un domaine.
 *
 * L'ordre compte : on libère chez le fournisseur AVANT de retirer de la base.
 * Dans l'autre sens, un échec du fournisseur laisserait un certificat orphelin
 * actif pour ce nom d'hôte, qui continuerait à servir un contenu au nom d'un
 * restaurant qui ne le contrôle plus.
 */
@Injectable()
export class RemoveCustomDomain {
  private readonly logger = new Logger(RemoveCustomDomain.name);

  constructor(
    @InjectRegistrar() private readonly registrar: DomainRegistrar | null,
    private readonly repository: TenantSiteRepository,
    private readonly cache: HostResolutionCache,
  ) {}

  async execute(tenantId: string, domainId: string): Promise<{ removed: string }> {
    const registrar = requireRegistrar(this.registrar);

    const stored = await this.repository.byId(tenantId, domainId);
    if (!stored) throw new NotFoundException('Domaine introuvable');

    try {
      await registrar.release(stored.providerId);
    } catch (error) {
      this.logger.error(
        `Détachement impossible pour « ${stored.hostname} » (${registrar.providerName})`,
        error instanceof Error ? error.stack : String(error),
      );
      // On n'efface PAS la ligne : sans elle, plus personne ne saurait qu'un
      // domaine reste rattaché chez le fournisseur — la fuite deviendrait muette.
      throw new ServiceUnavailableException(
        `« ${stored.hostname} » n'a pas pu être détaché chez notre hébergeur. Réessayez dans quelques minutes.`,
      );
    }

    await this.repository.remove(tenantId, domainId);
    this.cache.forget(stored.hostname);

    return { removed: stored.hostname };
  }
}
