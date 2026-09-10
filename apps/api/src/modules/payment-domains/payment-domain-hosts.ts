import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { domainToASCII } from 'node:url';

export type StripeMode = 'test' | 'live';
export interface PaymentDomainsConfig { mode: StripeMode; webHostname: string; rootDomain: string }
export interface DomainTenant {
  _id: { toString(): string };
  slug?: string;
  encaissement?: { accountId?: string; chargesEnabled?: boolean } | null;
  account?: { status?: string } | null;
  domains?: { hostname?: string; status?: string }[];
}
export interface DomainCursor { tenantId: string; host: string | null }

/** Accept a DNS name, never a URL, Origin header, IP or local development host. */
export function publicHostname(value: string): string | null {
  const raw = value.trim().toLowerCase().replace(/\.$/, '');
  if (/[:/@?#\s\\]/.test(raw)) return null;
  const host = domainToASCII(raw);
  const labels = host.split('.');
  if (!host || host.length > 253 || isIP(host) || labels.length < 2
    || labels.some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
    || /^(?:\d+|localhost|local|internal|test|invalid)$/.test(labels.at(-1)!)) return null;
  return host;
}

export function paymentDomainsConfig(env: { secretKey?: string; webUrl?: string; rootDomain?: string }): PaymentDomainsConfig | null {
  const mode = /^(?:sk|rk)_(test|live)_\S+$/.exec(env.secretKey?.trim() ?? '')?.[1] as StripeMode | undefined;
  if (!mode || !env.webUrl || !env.rootDomain) return null;
  try {
    const url = new URL(env.webUrl);
    const webHostname = publicHostname(url.hostname);
    const rootDomain = publicHostname(env.rootDomain.trim().replace(/^\.+|\.+$/g, ''));
    return url.protocol === 'https:' && !url.username && !url.password && webHostname && rootDomain
      ? { mode, webHostname, rootDomain } : null;
  } catch { return null; }
}

export function eligibleTenant(row: DomainTenant): boolean {
  return row.encaissement?.chargesEnabled === true && /^acct_[a-zA-Z0-9]+$/.test(row.encaissement.accountId ?? '')
    && row.account?.status !== 'suspended';
}

export function tenantPaymentHosts(row: DomainTenant, config: PaymentDomainsConfig): string[] {
  const hosts = new Set([config.webHostname]);
  if (row.slug && /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(row.slug)) {
    const automatic = publicHostname(`${row.slug}.${config.rootDomain}`);
    if (automatic) hosts.add(automatic);
  }
  for (const domain of row.domains ?? []) {
    if (domain.status !== 'active' || typeof domain.hostname !== 'string') continue;
    const host = publicHostname(domain.hostname);
    if (host) hosts.add(host);
  }
  return [...hosts].sort();
}

export function paymentDomainsNamespace(config: PaymentDomainsConfig): string {
  const environment = createHash('sha256').update(`${config.webHostname}\n${config.rootDomain}`).digest('hex').slice(0, 16);
  return `sm:payment-domains:v1:${config.mode}:${environment}`;
}
export const paymentDomainCacheKey = (config: PaymentDomainsConfig, accountId: string, host: string) =>
  `${paymentDomainsNamespace(config)}:result:${accountId}:${host}`;

export function parseDomainCursor(raw: string | null): DomainCursor | null {
  if (!raw || raw.length > 512) return null;
  try {
    const value = JSON.parse(raw) as DomainCursor;
    return /^[a-f0-9]{24}$/.test(value.tenantId) && (value.host === null || (typeof value.host === 'string' && publicHostname(value.host) === value.host))
      ? { tenantId: value.tenantId, host: value.host } : null;
  } catch { return null; }
}
