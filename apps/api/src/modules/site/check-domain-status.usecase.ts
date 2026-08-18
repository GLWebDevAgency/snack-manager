import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Clock, DomainRegistrar } from '@sm/domain';
import { CLOCK, InjectRegistrar, requireRegistrar } from './site.tokens';
import { HostResolutionCache } from './host-resolution.cache';
import { TenantSiteRepository } from './tenant-site.repository';
import { toDomainView, type DomainView } from './site.view';

/**
 * CAS D'USAGE — « Vérifier maintenant ».
 *
 * La propagation DNS et l'émission du certificat sont asynchrones et durent de
 * quelques minutes à quelques heures. Le restaurateur ne comprendrait pas de
 * devoir attendre un cycle de fond : ce bouton interroge le fournisseur en
 * direct et rafraîchit l'état affiché.
 */
@Injectable()
export class CheckDomainStatus {
  constructor(
    @InjectRegistrar() private readonly registrar: DomainRegistrar | null,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly repository: TenantSiteRepository,
    private readonly cache: HostResolutionCache,
  ) {}

  async execute(tenantId: string, domainId: string): Promise<DomainView> {
    const registrar = requireRegistrar(this.registrar);

    // Lecture tenant-scoped : un identifiant de domaine deviné ne donne accès
    // à rien s'il appartient à un autre établissement.
    const stored = await this.repository.byId(tenantId, domainId);
    if (!stored) throw new NotFoundException('Domaine introuvable');

    const check = await registrar.check(stored.providerId);
    const updated = await this.repository.saveCheck(
      tenantId,
      domainId,
      check.status,
      check.detail ?? null,
      this.clock.now(),
    );
    if (!updated) throw new NotFoundException('Domaine introuvable');

    // Le passage à `active` doit se voir tout de suite côté site public.
    this.cache.forget(updated.hostname);

    return toDomainView(updated);
  }
}
