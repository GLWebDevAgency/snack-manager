import { BadRequestException, ConflictException, Inject, Injectable } from '@nestjs/common';
import { PublicDomain, type Clock, type DomainRegistrar } from '@sm/domain';
import { CLOCK, InjectRegistrar, requireRegistrar } from './site.tokens';
import { SiteConfig } from './site.config';
import { HostResolutionCache } from './host-resolution.cache';
import { TenantSiteRepository } from './tenant-site.repository';
import { toDomainView, type DomainView } from './site.view';

/** Ce que le restaurateur doit faire juste après avoir cliqué « Ajouter ». */
export interface DomainAdded {
  readonly domain: DomainView;
}

/**
 * CAS D'USAGE — rattacher le nom de domaine du restaurant.
 *
 * Ne dépend que du PORT `DomainRegistrar` : ni Railway, ni Cloudflare, ni le
 * moindre appel HTTP n'apparaissent ici. C'est ce qui permet de basculer
 * d'hébergeur en écrivant un adaptateur, sans rouvrir cette classe.
 */
@Injectable()
export class AddCustomDomain {
  constructor(
    @InjectRegistrar() private readonly registrar: DomainRegistrar | null,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly repository: TenantSiteRepository,
    private readonly cache: HostResolutionCache,
    private readonly config: SiteConfig,
  ) {}

  async execute(tenantId: string, input: string): Promise<DomainAdded> {
    const registrar = requireRegistrar(this.registrar);

    // 1 · Règle métier : nom valide, et surtout PAS un domaine racine. Le
    // message pédagogique (« utilisez commander.… ») vient du domaine, pas d'ici.
    const parsed = PublicDomain.create(input);
    if (!parsed.ok) throw new BadRequestException(parsed.error.message);
    const domain = parsed.value;

    // 2 · Une adresse sous NOTRE racine n'est pas un domaine personnalisé :
    // elle est déjà servie, et poser un CNAME dessus n'a aucun sens.
    if (domain.isManagedBy(this.config.rootDomain)) {
      throw new BadRequestException(
        `« ${domain.value} » est une adresse Snack Manager : elle fonctionne déjà, sans rien configurer.`,
      );
    }

    // 3 · Unicité globale : un nom d'hôte ne peut pointer que vers un seul
    // établissement, sinon la résolution du Host devient un tirage au sort.
    const holder = await this.repository.holderOf(domain.value);
    if (holder) {
      throw new ConflictException(
        holder === tenantId
          ? `« ${domain.value} » est déjà rattaché à votre établissement.`
          : `« ${domain.value} » est déjà utilisé par un autre établissement. Contactez le support si ce domaine vous appartient.`,
      );
    }

    // Premier domaine personnalisé = adresse principale du restaurant.
    const isPrimary = (await this.repository.list(tenantId)).length === 0;

    // 4 · Réservation chez le fournisseur AVANT l'écriture en base : sans
    // `providerId` on ne saurait ni suivre l'état ni détacher le domaine.
    const registration = await registrar.register(domain);

    const stored = await this.repository.add(tenantId, {
      hostname: registration.domain.value,
      providerId: registration.providerId,
      status: registration.status,
      target: registration.target,
      isPrimary,
      addedAt: this.clock.now(),
    });

    // Un « domaine inconnu » a pu être mis en cache négatif il y a quelques
    // secondes — typiquement par le client qui testait son adresse.
    this.cache.forget(stored.hostname);

    return { domain: toDomainView(stored) };
  }
}
