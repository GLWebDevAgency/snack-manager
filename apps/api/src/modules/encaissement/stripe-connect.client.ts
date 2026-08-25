import { Logger } from '@nestjs/common';

/**
 * LA SURFACE STRIPE RÉELLEMENT UTILISÉE POUR LE RACCORDEMENT — et rien de plus.
 *
 * Même parti pris que partout ailleurs dans ce dépôt : on décrit ce qu'on
 * appelle, jamais l'API entière. Le paquet `stripe` n'est PAS une dépendance du
 * projet (import dynamique par variable, échec rattrapé à froid) ; en dépendre
 * pour des TYPES rendrait le typecheck impossible sur une installation qui
 * n'encaisse qu'au comptoir.
 *
 * C'est aussi ce qui rend le service testable : une doublure de cette
 * interface tient en dix lignes, là où simuler le SDK Stripe demanderait de
 * connaître sa hiérarchie de classes.
 */
export interface StripeCompte {
  id: string;
  charges_enabled?: boolean;
  payouts_enabled?: boolean;
  details_submitted?: boolean;
}

export interface StripeLien {
  url: string;
  /** Secondes epoch — Stripe les compte ainsi. */
  expires_at: number;
}

export interface StripeConnectClient {
  /** Crée un compte connecté « Standard » et rend son identifiant. */
  creerCompte(email: string | null): Promise<StripeCompte>;
  /** Relit les drapeaux — Stripe est seul juge de ce qu'un marchand peut faire. */
  lireCompte(accountId: string): Promise<StripeCompte>;
  /** Le lien d'inscription/reprise, à usage unique et de courte durée. */
  creerLien(accountId: string, retour: string, rafraichir: string): Promise<StripeLien>;
}

/** Jeton d'injection — l'implémentation réelle n'est jamais nommée par le service. */
export const STRIPE_CONNECT_CLIENT = Symbol('STRIPE_CONNECT_CLIENT');

const STRIPE_MODULE = 'stripe';

interface StripeSdk {
  accounts: {
    create(params: Record<string, unknown>): Promise<StripeCompte>;
    retrieve(id: string): Promise<StripeCompte>;
  };
  accountLinks: {
    create(params: Record<string, unknown>): Promise<StripeLien>;
  };
}

type StripeCtor = new (apiKey: string, config?: Record<string, unknown>) => StripeSdk;

/**
 * L'implémentation réelle.
 *
 * `null` quand la clé manque ou que le paquet est absent : l'appelant traduit
 * alors « raccordement momentanément indisponible » plutôt que de planter. Une
 * plateforme mal configurée ne doit jamais empêcher un restaurant d'ouvrir.
 */
export class StripeConnectHttpClient implements StripeConnectClient {
  private readonly logger = new Logger(StripeConnectHttpClient.name);
  private sdk: StripeSdk | null = null;
  private loadAttempted = false;

  constructor(private readonly secretKey: string | null) {}

  async creerCompte(email: string | null): Promise<StripeCompte> {
    const sdk = await this.requireSdk();
    return sdk.accounts.create({
      type: 'standard',
      country: 'FR',
      ...(email ? { email } : {}),
    });
  }

  async lireCompte(accountId: string): Promise<StripeCompte> {
    const sdk = await this.requireSdk();
    return sdk.accounts.retrieve(accountId);
  }

  async creerLien(accountId: string, retour: string, rafraichir: string): Promise<StripeLien> {
    const sdk = await this.requireSdk();
    return sdk.accountLinks.create({
      account: accountId,
      type: 'account_onboarding',
      return_url: retour,
      refresh_url: rafraichir,
    });
  }

  /** `true` si le raccordement est possible — la clé et le paquet répondent. */
  async disponible(): Promise<boolean> {
    return (await this.getSdk()) !== null;
  }

  private async requireSdk(): Promise<StripeSdk> {
    const sdk = await this.getSdk();
    if (!sdk) throw new Error('Stripe non configuré');
    return sdk;
  }

  private async getSdk(): Promise<StripeSdk | null> {
    const key = this.secretKey?.trim();
    if (!key) return null;
    if (this.sdk) return this.sdk;
    if (this.loadAttempted) return null;

    this.loadAttempted = true;
    try {
      // Import dynamique par variable : voir STRIPE_MODULE ci-dessus.
      const mod = (await import(STRIPE_MODULE)) as { default?: StripeCtor } & StripeCtor;
      const ctor = (mod.default ?? mod) as StripeCtor;
      this.sdk = new ctor(key);
      return this.sdk;
    } catch (error) {
      this.logger.warn(
        `Paquet « stripe » indisponible — raccordement des comptes désactivé (${String(error)})`,
      );
      return null;
    }
  }
}
