import type { ConfigService } from '@nestjs/config';
import type {
  Clock,
  DomainCheck,
  DomainRegistrar,
  DomainRegistration,
  DomainStatus,
  PublicDomain,
} from '@sm/domain';
import { SiteConfig } from './site.config';
import type {
  NewDomain,
  StoredDomain,
  TenantIdentity,
  TenantSiteRepository,
} from './tenant-site.repository';

/**
 * Doublures de test du module « Votre site web ».
 *
 * Elles ne sont possibles que parce que les cas d'usage dépendent de PORTS :
 * `FakeRegistrar` remplace Railway sans une ligne de HTTP, et les règles
 * métier (refus d'un domaine racine, unicité d'un nom d'hôte) se testent en
 * millisecondes. C'est le bénéfice concret de l'hexagone, pas une commodité.
 */

/** Horloge figée — le domaine interdit `Date.now()`, les tests en profitent. */
export class TestClock implements Clock {
  constructor(private instant = new Date('2026-08-19T19:30:00Z')) {}

  now(): Date {
    return new Date(this.instant);
  }

  advanceSeconds(seconds: number): void {
    this.instant = new Date(this.instant.getTime() + seconds * 1000);
  }
}

/** Adaptateur en mémoire : le troisième, après Railway et Cloudflare. */
export class FakeRegistrar implements DomainRegistrar {
  readonly providerName = 'Fournisseur de test';
  readonly registered: string[] = [];
  readonly released: string[] = [];
  /** Verdict que renverra `check` — piloté par le test. */
  nextCheck: DomainCheck = { status: 'active' };
  /** Panne simulée du fournisseur. */
  failRelease = false;

  private sequence = 0;

  async register(domain: PublicDomain): Promise<DomainRegistration> {
    this.registered.push(domain.value);
    return {
      domain,
      target: 'sm-prod.up.railway.app',
      status: 'pending_dns',
      providerId: `fake_${++this.sequence}`,
    };
  }

  async check(): Promise<DomainCheck> {
    return this.nextCheck;
  }

  async release(providerId: string): Promise<void> {
    if (this.failRelease) throw new Error('Fournisseur injoignable');
    this.released.push(providerId);
  }
}

const IDENTITY: Omit<TenantIdentity, 'tenantId' | 'slug'> = {
  name: "Class'Food",
  brandColor: '#c9a15a',
  logoUrl: null,
};

/**
 * Dépôt en mémoire. `TenantSiteRepository` porte un champ privé (le modèle
 * Mongoose), donc le typage structurel ne suffit pas : on assume la conversion
 * ici, une seule fois, plutôt que dans chaque test.
 */
export class FakeRepository {
  /** Lectures de résolution — sert à prouver que le cache évite la base. */
  reads = 0;
  /** tenantId → domaines. */
  private readonly byTenant = new Map<string, StoredDomain[]>();
  /** slug → tenantId. */
  private readonly slugs = new Map<string, string>();
  private sequence = 0;

  registerTenant(tenantId: string, slug: string): void {
    this.slugs.set(slug, tenantId);
    if (!this.byTenant.has(tenantId)) this.byTenant.set(tenantId, []);
  }

  seed(tenantId: string, domain: Partial<StoredDomain> & { hostname: string }): StoredDomain {
    const stored: StoredDomain = {
      id: `d${++this.sequence}`,
      providerId: `fake_${this.sequence}`,
      status: 'pending_dns',
      target: 'sm-prod.up.railway.app',
      isPrimary: false,
      addedAt: new Date('2026-08-01T10:00:00Z'),
      lastCheckedAt: null,
      detail: null,
      ...domain,
    };
    this.byTenant.set(tenantId, [...(this.byTenant.get(tenantId) ?? []), stored]);
    return stored;
  }

  async list(tenantId: string): Promise<StoredDomain[]> {
    return [...(this.byTenant.get(tenantId) ?? [])];
  }

  async byId(tenantId: string, domainId: string): Promise<StoredDomain | null> {
    return (this.byTenant.get(tenantId) ?? []).find((d) => d.id === domainId) ?? null;
  }

  async holderOf(hostname: string): Promise<string | null> {
    for (const [tenantId, domains] of this.byTenant) {
      if (domains.some((d) => d.hostname === hostname)) return tenantId;
    }
    return null;
  }

  async add(tenantId: string, domain: NewDomain): Promise<StoredDomain> {
    return this.seed(tenantId, { ...domain, lastCheckedAt: null, detail: null });
  }

  async saveCheck(
    tenantId: string,
    domainId: string,
    status: DomainStatus,
    detail: string | null,
    checkedAt: Date,
  ): Promise<StoredDomain | null> {
    const domains = this.byTenant.get(tenantId) ?? [];
    const index = domains.findIndex((d) => d.id === domainId);
    if (index < 0) return null;
    const updated: StoredDomain = {
      ...domains[index]!,
      status,
      detail,
      lastCheckedAt: checkedAt,
    };
    domains[index] = updated;
    return updated;
  }

  async remove(tenantId: string, domainId: string): Promise<void> {
    this.byTenant.set(
      tenantId,
      (this.byTenant.get(tenantId) ?? []).filter((d) => d.id !== domainId),
    );
  }

  async findByActiveHostname(hostname: string): Promise<TenantIdentity | null> {
    this.reads += 1;
    for (const [tenantId, domains] of this.byTenant) {
      if (domains.some((d) => d.hostname === hostname && d.status === 'active')) {
        return this.identityOf(tenantId);
      }
    }
    return null;
  }

  async findBySlug(slug: string): Promise<TenantIdentity | null> {
    this.reads += 1;
    const tenantId = this.slugs.get(slug);
    return tenantId ? this.identityOf(tenantId) : null;
  }

  async findById(tenantId: string): Promise<TenantIdentity | null> {
    return this.byTenant.has(tenantId) ? this.identityOf(tenantId) : null;
  }

  private identityOf(tenantId: string): TenantIdentity {
    const slug = [...this.slugs].find(([, id]) => id === tenantId)?.[0] ?? 'inconnu';
    return { tenantId, slug, ...IDENTITY };
  }

  asRepository(): TenantSiteRepository {
    return this as unknown as TenantSiteRepository;
  }
}

/** `SiteConfig` sans ConfigService : la racine est la seule donnée qui compte. */
export function testSiteConfig(rootDomain = 'snackmanager.app'): SiteConfig {
  return new SiteConfig({ get: () => rootDomain } as unknown as ConfigService);
}
