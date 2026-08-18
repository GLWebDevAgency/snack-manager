import type { DomainStatus } from '@sm/domain';
import { DOMAIN_STATUS_LABELS, dnsInstructionFor, type DnsInstruction } from './dns-instruction';
import type { StoredDomain } from './tenant-site.repository';

/**
 * Forme renvoyée au back-office. Elle porte déjà le libellé d'état et
 * l'instruction DNS : l'écran affiche, il ne recalcule pas. Une règle qui vit
 * dans le front finit toujours par diverger de celle de l'API.
 */
export interface DomainView {
  readonly id: string;
  readonly hostname: string;
  readonly url: string;
  readonly status: DomainStatus;
  readonly statusLabel: string;
  readonly isPrimary: boolean;
  readonly addedAt: string;
  readonly lastCheckedAt: string | null;
  readonly detail: string | null;
  readonly dns: DnsInstruction;
}

export function toDomainView(domain: StoredDomain): DomainView {
  return {
    id: domain.id,
    hostname: domain.hostname,
    url: `https://${domain.hostname}`,
    status: domain.status,
    statusLabel: DOMAIN_STATUS_LABELS[domain.status],
    isPrimary: domain.isPrimary,
    addedAt: domain.addedAt.toISOString(),
    lastCheckedAt: domain.lastCheckedAt ? domain.lastCheckedAt.toISOString() : null,
    detail: domain.detail,
    dns: dnsInstructionFor(domain.hostname, domain.target),
  };
}

/**
 * Réponse de `GET /public/resolve` — le strict nécessaire au middleware du site
 * public : quel établissement servir, et de quoi peindre l'entête avant même
 * d'avoir chargé la page (marque grise sans clignotement).
 */
export interface ResolvedHost {
  readonly hostname: string;
  readonly tenantId: string;
  readonly slug: string;
  readonly name: string;
  readonly brandColor: string;
  readonly logoUrl: string | null;
  /** D'où vient la correspondance — utile en journalisation et en support. */
  readonly matchedBy: 'subdomain' | 'custom_domain';
}

/** Réponse de `GET /site/domains` — tout ce qu'affiche l'écran « Votre site web ». */
export interface SiteAddressesView {
  /** Sous-domaine automatique : toujours servi, rien à configurer. */
  readonly subdomain: { readonly hostname: string; readonly url: string };
  readonly domains: DomainView[];
  /** Nom du fournisseur courant, ou `null` s'il n'y en a pas sur cet environnement. */
  readonly provider: string | null;
}
