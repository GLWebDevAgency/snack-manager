import { Logger, ServiceUnavailableException } from '@nestjs/common';
import type { PublicDomain } from '@sm/domain';
import type { DomainCheck, DomainRegistrar, DomainRegistration } from '@sm/domain/src/ports';

import { errorMessage, httpStatusLabel, readJson, type Fetch } from '../http';
import type { ConfigSource, RegistrarConfig } from './registrar-config';

/**
 * ADAPTATEUR — `DomainRegistrar` via l'API GraphQL de Railway.
 *
 * C'est l'implémentation du jour, celle qui sert le pilote Class'Food. Railway
 * héberge déjà l'API et le front : rattacher « commander.classfood.fr » revient
 * à déclarer un domaine personnalisé de plus sur le service web, et Railway
 * s'occupe du certificat. Zéro infrastructure supplémentaire à opérer, ce qui
 * est exactement ce qu'il faut pour les dix premiers restaurants.
 *
 * Sa limite est connue et documentée dans `CloudflareDomainRegistrar` : au-delà
 * de quelques dizaines de domaines, on veut un fournisseur pensé pour le
 * multi-tenant. D'où le port.
 */

const RAILWAY_ENDPOINT = 'https://backboard.railway.com/graphql/v2';

/** Ce que Railway nous renvoie, réduit aux champs que nous lisons vraiment. */
interface RailwayDnsRecord {
  readonly recordType?: string | null;
  readonly requiredValue?: string | null;
  readonly currentValue?: string | null;
  readonly status?: string | null;
  readonly fqdn?: string | null;
}

interface RailwayCustomDomain {
  readonly id?: string | null;
  readonly domain?: string | null;
  readonly status?: {
    readonly certificateStatus?: string | null;
    readonly cnameCheck?: string | null;
    readonly dnsRecords?: readonly RailwayDnsRecord[] | null;
  } | null;
}

interface GraphQlResponse<T> {
  readonly data?: T | null;
  readonly errors?: readonly { readonly message?: string }[] | null;
}

const DOMAIN_FIELDS = `
  id
  domain
  status {
    certificateStatus
    cnameCheck
    dnsRecords {
      recordType
      requiredValue
      currentValue
      status
      fqdn
    }
  }
`;

const CREATE_MUTATION = `
  mutation customDomainCreate($input: CustomDomainCreateInput!) {
    customDomainCreate(input: $input) {${DOMAIN_FIELDS}}
  }
`;

const STATUS_QUERY = `
  query customDomain($id: String!) {
    customDomain(id: $id) {${DOMAIN_FIELDS}}
  }
`;

const DELETE_MUTATION = `
  mutation customDomainDelete($id: String!) {
    customDomainDelete(id: $id)
  }
`;

/** Variables d'environnement lues par cet adaptateur. */
export const RAILWAY_REQUIRED_KEYS = [
  'RAILWAY_TOKEN',
  'RAILWAY_PROJECT_ID',
  'RAILWAY_ENVIRONMENT_ID',
  'RAILWAY_SERVICE_ID',
] as const;

export interface RailwayConfig {
  readonly token: string;
  readonly projectId: string;
  readonly environmentId: string;
  readonly serviceId: string;
  /** Valeur CNAME de repli si Railway ne renvoie pas encore l'enregistrement. */
  readonly cnameTarget: string | null;
  readonly endpoint: string;
}

/**
 * Lit la configuration Railway. Ne lève jamais : une installation sans domaine
 * personnalisé est légitime, et l'API doit démarrer quand même.
 */
export function readRailwayConfig(get: ConfigSource): RegistrarConfig<RailwayConfig> {
  const missing = RAILWAY_REQUIRED_KEYS.filter((key) => !get(key)?.trim());
  if (missing.length > 0) return { configured: false, missing };

  return {
    configured: true,
    value: {
      token: get('RAILWAY_TOKEN')!.trim(),
      projectId: get('RAILWAY_PROJECT_ID')!.trim(),
      environmentId: get('RAILWAY_ENVIRONMENT_ID')!.trim(),
      serviceId: get('RAILWAY_SERVICE_ID')!.trim(),
      cnameTarget: get('PUBLIC_CNAME_TARGET')?.trim() || null,
      endpoint: get('RAILWAY_GRAPHQL_ENDPOINT')?.trim() || RAILWAY_ENDPOINT,
    },
  };
}

export class RailwayDomainRegistrar implements DomainRegistrar {
  readonly providerName = 'Railway';

  private readonly logger = new Logger(RailwayDomainRegistrar.name);

  /**
   * `config` à `null` = variables absentes. On construit quand même : refuser
   * ici ferait planter le démarrage de l'API pour un rattachement de domaine
   * que personne ne demandera peut-être jamais aujourd'hui.
   */
  constructor(
    private readonly config: RailwayConfig | null,
    private readonly fetchImpl: Fetch = globalThis.fetch,
  ) {}

  isConfigured(): boolean {
    return this.config !== null;
  }

  async register(domain: PublicDomain): Promise<DomainRegistration> {
    const config = this.requireConfig();

    const created = await this.call<{ customDomainCreate: RailwayCustomDomain }>(
      CREATE_MUTATION,
      {
        input: {
          domain: domain.toString(),
          projectId: config.projectId,
          environmentId: config.environmentId,
          serviceId: config.serviceId,
        },
      },
    );

    const custom = created.customDomainCreate;
    const providerId = custom?.id?.trim();
    if (!providerId) {
      throw new ServiceUnavailableException(
        `Railway a accepté « ${domain.toString()} » sans renvoyer d'identifiant : rattachement impossible à suivre.`,
      );
    }

    const target = this.cnameTargetOf(custom, config);
    if (!target) {
      throw new ServiceUnavailableException(
        `Railway n'indique aucun enregistrement CNAME pour « ${domain.toString()} ». Renseignez PUBLIC_CNAME_TARGET pour pouvoir guider le restaurateur.`,
      );
    }

    const check = RailwayDomainRegistrar.readStatus(custom);
    this.logger.log(`Domaine « ${domain.toString()} » rattaché (Railway ${providerId})`);

    return { domain, target, status: check.status, providerId };
  }

  async check(providerId: string): Promise<DomainCheck> {
    this.requireConfig();

    const response = await this.call<{ customDomain: RailwayCustomDomain }>(STATUS_QUERY, {
      id: providerId,
    });

    return RailwayDomainRegistrar.readStatus(response.customDomain);
  }

  async release(providerId: string): Promise<void> {
    this.requireConfig();

    await this.call<{ customDomainDelete: boolean }>(DELETE_MUTATION, { id: providerId });
    this.logger.log(`Domaine Railway ${providerId} détaché`);
  }

  private requireConfig(): RailwayConfig {
    if (!this.config) {
      throw new ServiceUnavailableException(
        `Domaines personnalisés indisponibles : ${RAILWAY_REQUIRED_KEYS.join(', ')} ne sont pas configurées.`,
      );
    }
    return this.config;
  }

  /**
   * Appel GraphQL brut.
   *
   * Les échecs réseau et les erreurs GraphQL sont traduits en 503 : de notre
   * point de vue c'est le même incident — le fournisseur ne répond pas comme
   * convenu — et le gérant doit lire « réessayez dans un instant », pas une
   * trace de pile.
   */
  private async call<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const config = this.requireConfig();
    let response: Response;

    try {
      response = await this.fetchImpl(config.endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${config.token}`,
        },
        body: JSON.stringify({ query, variables }),
      });
    } catch (error) {
      // Coupure réseau, DNS, TLS : Railway n'a jamais vu la requête.
      this.logger.error(`Railway injoignable : ${errorMessage(error)}`);
      throw new ServiceUnavailableException(
        'Le fournisseur de domaines est injoignable. Réessayez dans quelques instants.',
      );
    }

    const body = (await readJson(response)) as GraphQlResponse<T> | null;

    if (!response.ok) {
      this.logger.error(`Railway a répondu ${httpStatusLabel(response)}`);
      throw new ServiceUnavailableException(
        `Le fournisseur de domaines a refusé la demande (${httpStatusLabel(response)}).`,
      );
    }

    // GraphQL répond 200 même en erreur : le statut HTTP ne suffit pas.
    const failure = body?.errors?.[0]?.message;
    if (failure) {
      this.logger.error(`Railway : ${failure}`);
      throw new ServiceUnavailableException(`Le fournisseur de domaines a refusé : ${failure}`);
    }

    if (!body?.data) {
      throw new ServiceUnavailableException('Réponse illisible du fournisseur de domaines.');
    }

    return body.data;
  }

  /** CNAME que le restaurateur doit poser chez son bureau d'enregistrement. */
  private cnameTargetOf(custom: RailwayCustomDomain | undefined, config: RailwayConfig): string | null {
    const records = custom?.status?.dnsRecords ?? [];
    const cname = records.find(
      (record) => (record.recordType ?? '').toUpperCase() === 'CNAME' && record.requiredValue,
    );

    return cname?.requiredValue?.trim() || config.cnameTarget;
  }

  /**
   * Traduit l'état Railway en état métier.
   *
   * Le domaine ne connaît que quatre situations, parce que ce sont les quatre
   * seules qui changent le message affiché au restaurateur : « posez ce CNAME »,
   * « on attend le certificat », « c'est en ligne », « ça a échoué ». Recopier
   * les états du fournisseur ferait fuiter Railway jusque dans l'interface.
   */
  private static readStatus(custom: RailwayCustomDomain | undefined): DomainCheck {
    const status = custom?.status;
    if (!status) {
      return { status: 'pending_dns', detail: "Railway n'a pas encore d'état pour ce domaine." };
    }

    const certificate = (status.certificateStatus ?? '').toUpperCase();
    const records = status.dnsRecords ?? [];
    const pending = records.filter(
      (record) => (record.status ?? '').toUpperCase() !== 'PROPAGATED',
    );

    if (certificate.includes('ERROR') || certificate === 'FAILED') {
      return {
        status: 'failed',
        detail: "Railway n'a pas pu émettre le certificat pour ce domaine.",
      };
    }

    if (pending.length > 0) {
      const first = pending[0];
      const detail = first?.requiredValue
        ? `Enregistrement DNS à créer : ${first.fqdn ?? ''} → ${first.requiredValue}`
        : 'Le CNAME du restaurateur n’est pas encore visible.';
      return { status: 'pending_dns', detail };
    }

    if (certificate !== 'ISSUED') {
      return {
        status: 'issuing_certificate',
        detail: 'DNS correct, certificat en cours d’émission.',
      };
    }

    return { status: 'active' };
  }
}
