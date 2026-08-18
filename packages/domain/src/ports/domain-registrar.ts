import type { PublicDomain } from '../tenancy/public-domain';

/**
 * PORT — rattacher le domaine d'un restaurant à notre hébergement.
 *
 * Le domaine métier sait qu'un restaurant peut avoir une adresse à lui ; il
 * ignore totalement QUI l'héberge. Railway aujourd'hui, Cloudflare for SaaS
 * quand le parc dépassera la centaine de clients : ce changement doit être un
 * nouvel adaptateur, pas une migration du métier.
 *
 * C'est précisément le cas d'école des ports & adaptateurs : une dépendance
 * externe volatile, remplaçable, dont le métier n'a pas à connaître la forme.
 */

export interface DomainRegistration {
  /** Nom rattaché, ex. « commander.classfood.fr ». */
  readonly domain: PublicDomain;
  /** Valeur CNAME à communiquer au restaurateur. */
  readonly target: string;
  readonly status: DomainStatus;
  /** Identifiant chez le fournisseur — permet la suppression ultérieure. */
  readonly providerId: string;
}

export type DomainStatus =
  /** Enregistré chez nous, le client n'a pas encore posé son CNAME. */
  | 'pending_dns'
  /** DNS correct, certificat en cours d'émission. */
  | 'issuing_certificate'
  /** Opérationnel. */
  | 'active'
  /** Échec (DNS jamais posé, conflit) — message dans `detail`. */
  | 'failed';

export interface DomainCheck {
  readonly status: DomainStatus;
  readonly detail?: string;
}

export interface DomainRegistrar {
  /** Nom lisible de l'implémentation (journalisation, écran d'administration). */
  readonly providerName: string;

  /** Rattache un domaine et renvoie l'enregistrement DNS à créer. */
  register(domain: PublicDomain): Promise<DomainRegistration>;

  /** État courant : DNS posé ? certificat émis ? */
  check(providerId: string): Promise<DomainCheck>;

  /** Détache le domaine (résiliation, changement d'adresse). */
  release(providerId: string): Promise<void>;
}
