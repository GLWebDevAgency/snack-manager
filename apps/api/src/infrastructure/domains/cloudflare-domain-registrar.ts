import { Logger, ServiceUnavailableException } from '@nestjs/common';
import type { PublicDomain } from '@sm/domain';
import type { DomainCheck, DomainRegistrar, DomainRegistration } from '@sm/domain/src/ports';

import { errorMessage, httpStatusLabel, readJson, type Fetch } from '../http';
import type { ConfigSource, RegistrarConfig } from './registrar-config';

/**
 * ADAPTATEUR — `DomainRegistrar` via Cloudflare for SaaS (custom hostnames).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POURQUOI CE FICHIER EXISTE ALORS QU'IL N'EST PAS ACTIVÉ
 *
 * Il n'est pas branché aujourd'hui : Railway suffit pour le pilote. Il est écrit
 * quand même, et c'est délibéré — un port dont il n'existe qu'une seule
 * implémentation n'est pas un port, c'est une indirection décorative. Tant qu'un
 * deuxième adaptateur n'a pas été écrit, rien ne prouve que l'interface tient.
 *
 * QUAND BASCULER
 *
 * Cloudflare for SaaS offre 100 custom hostnames inclus, puis facture 0,10 $ par
 * hostname et par mois. Le seuil de bascule est donc un COMPTEUR, pas une
 * intuition :
 *   - jusqu'à ~100 restaurants avec domaine à eux → Railway, gratuit et déjà là ;
 *   - au-delà → Cloudflare, dont c'est le métier : émission de certificats en
 *     masse, validation, révocation, et surtout des quotas pensés pour le
 *     multi-tenant. 500 domaines coûtent alors 40 $/mois, à comparer au temps
 *     passé à surveiller 500 certificats ailleurs.
 *
 * La bascule doit rester une variable d'environnement — `DOMAIN_PROVIDER` — et
 * jamais une migration. Le jour où on la fait, on ne rouvre ni le domaine, ni
 * les modules applicatifs : on change une valeur et on redéploie. C'est tout
 * l'intérêt de la fabrique (`domain-registrar.factory.ts`).
 *
 * NOTE D'EXPLOITATION : le restaurateur pointe son CNAME vers l'origine de
 * repli (« fallback origin ») de la zone, pas vers notre service — d'où
 * `CLOUDFLARE_FALLBACK_ORIGIN`.
 * ────────────────────────────────────────────────────────────────────────────
 */

const CLOUDFLARE_API = 'https://api.cloudflare.com/client/v4';

interface CloudflareEnvelope<T> {
  readonly success?: boolean;
  readonly errors?: readonly { readonly code?: number; readonly message?: string }[] | null;
  readonly result?: T | null;
}

interface CloudflareHostname {
  readonly id?: string | null;
  readonly hostname?: string | null;
  /** « pending », « active », « moved », « deleted »… */
  readonly status?: string | null;
  readonly ssl?: {
    readonly status?: string | null;
    readonly validation_errors?: readonly { readonly message?: string }[] | null;
  } | null;
  readonly verification_errors?: readonly string[] | null;
}

export const CLOUDFLARE_REQUIRED_KEYS = [
  'CLOUDFLARE_API_TOKEN',
  'CLOUDFLARE_ZONE_ID',
  'CLOUDFLARE_FALLBACK_ORIGIN',
] as const;

export interface CloudflareConfig {
  readonly token: string;
  readonly zoneId: string;
  /** Cible du CNAME communiquée au restaurateur, ex. « clients.snackmanager.fr ». */
  readonly fallbackOrigin: string;
  readonly endpoint: string;
}

export function readCloudflareConfig(get: ConfigSource): RegistrarConfig<CloudflareConfig> {
  const missing = CLOUDFLARE_REQUIRED_KEYS.filter((key) => !get(key)?.trim());
  if (missing.length > 0) return { configured: false, missing };

  return {
    configured: true,
    value: {
      token: get('CLOUDFLARE_API_TOKEN')!.trim(),
      zoneId: get('CLOUDFLARE_ZONE_ID')!.trim(),
      fallbackOrigin: get('CLOUDFLARE_FALLBACK_ORIGIN')!.trim(),
      endpoint: get('CLOUDFLARE_API_ENDPOINT')?.trim() || CLOUDFLARE_API,
    },
  };
}

export class CloudflareDomainRegistrar implements DomainRegistrar {
  readonly providerName = 'Cloudflare for SaaS';

  private readonly logger = new Logger(CloudflareDomainRegistrar.name);

  constructor(
    private readonly config: CloudflareConfig | null,
    private readonly fetchImpl: Fetch = globalThis.fetch,
  ) {}

  isConfigured(): boolean {
    return this.config !== null;
  }

  async register(domain: PublicDomain): Promise<DomainRegistration> {
    const config = this.requireConfig();

    const created = await this.call<CloudflareHostname>('POST', '/custom_hostnames', {
      hostname: domain.toString(),
      // Validation « http » : elle n'exige rien du restaurateur au-delà du
      // CNAME. La validation « txt » impose un second enregistrement, et c'est
      // toujours celui-là qu'on oublie de poser.
      ssl: { method: 'http', type: 'dv', settings: { min_tls_version: '1.2' } },
    });

    const providerId = created.id?.trim();
    if (!providerId) {
      throw new ServiceUnavailableException(
        `Cloudflare a accepté « ${domain.toString()} » sans renvoyer d'identifiant : rattachement impossible à suivre.`,
      );
    }

    this.logger.log(`Domaine « ${domain.toString()} » rattaché (Cloudflare ${providerId})`);

    return {
      domain,
      target: config.fallbackOrigin,
      status: CloudflareDomainRegistrar.readStatus(created).status,
      providerId,
    };
  }

  async check(providerId: string): Promise<DomainCheck> {
    this.requireConfig();

    const hostname = await this.call<CloudflareHostname>(
      'GET',
      `/custom_hostnames/${encodeURIComponent(providerId)}`,
    );

    return CloudflareDomainRegistrar.readStatus(hostname);
  }

  async release(providerId: string): Promise<void> {
    this.requireConfig();

    await this.call<CloudflareHostname>(
      'DELETE',
      `/custom_hostnames/${encodeURIComponent(providerId)}`,
    );
    this.logger.log(`Domaine Cloudflare ${providerId} détaché`);
  }

  private requireConfig(): CloudflareConfig {
    if (!this.config) {
      throw new ServiceUnavailableException(
        `Domaines personnalisés indisponibles : ${CLOUDFLARE_REQUIRED_KEYS.join(', ')} ne sont pas configurées.`,
      );
    }
    return this.config;
  }

  private async call<T>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body?: unknown,
  ): Promise<T> {
    const config = this.requireConfig();
    let response: Response;

    try {
      response = await this.fetchImpl(`${config.endpoint}/zones/${config.zoneId}${path}`, {
        method,
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${config.token}`,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (error) {
      this.logger.error(`Cloudflare injoignable : ${errorMessage(error)}`);
      throw new ServiceUnavailableException(
        'Le fournisseur de domaines est injoignable. Réessayez dans quelques instants.',
      );
    }

    const envelope = (await readJson(response)) as CloudflareEnvelope<T> | null;

    // Cloudflare porte l'échec dans `success: false` autant que dans le statut
    // HTTP ; les deux se lisent, sinon une 200 en erreur passerait pour un succès.
    if (!response.ok || envelope?.success === false) {
      const detail = envelope?.errors?.[0]?.message ?? httpStatusLabel(response);
      this.logger.error(`Cloudflare : ${detail}`);
      throw new ServiceUnavailableException(`Le fournisseur de domaines a refusé : ${detail}`);
    }

    if (!envelope?.result) {
      throw new ServiceUnavailableException('Réponse illisible du fournisseur de domaines.');
    }

    return envelope.result;
  }

  /**
   * Même grille de lecture que Railway, et c'est le point : deux fournisseurs
   * aux vocabulaires différents produisent les mêmes quatre états métier.
   */
  private static readStatus(hostname: CloudflareHostname | undefined): DomainCheck {
    const status = (hostname?.status ?? '').toLowerCase();
    const ssl = (hostname?.ssl?.status ?? '').toLowerCase();

    const verification = hostname?.verification_errors?.[0];
    if (verification) {
      return { status: 'failed', detail: verification };
    }
    if (status === 'moved' || status === 'deleted' || status.startsWith('blocked')) {
      return {
        status: 'failed',
        detail: `Cloudflare a écarté ce domaine (${status}). Vérifiez qu'il n'est pas déjà rattaché ailleurs.`,
      };
    }

    // Tant que le CNAME n'est pas posé, Cloudflare laisse l'hostname « pending »
    // et le certificat en attente de validation : c'est le restaurateur qu'on
    // relance, pas le fournisseur.
    if (status !== 'active') {
      return {
        status: 'pending_dns',
        detail: "Le CNAME du restaurateur n'est pas encore visible.",
      };
    }

    if (ssl !== 'active') {
      const validation = hostname?.ssl?.validation_errors?.[0]?.message;
      return {
        status: 'issuing_certificate',
        detail: validation ?? 'DNS correct, certificat en cours d’émission.',
      };
    }

    return { status: 'active' };
  }
}
