import { ServiceUnavailableException } from '@nestjs/common';
import type { PublicDomain } from '@sm/domain';
import type { DomainCheck, DomainRegistrar, DomainRegistration } from '@sm/domain/src/ports';

/**
 * ADAPTATEUR — aucun fournisseur de domaines.
 *
 * L'objet nul EXPLICITE, et non un `null` injecté. Deux raisons de terrain :
 *
 *  1. Tout restaurant est déjà servi sur « classfood.snackmanager.fr » sans la
 *     moindre démarche. Le domaine à soi est une option payante que la majorité
 *     ne prendra jamais — l'absence de fournisseur est donc l'état NORMAL, pas
 *     une panne de configuration.
 *  2. Un `null` injecté obligerait chaque appelant à tester avant d'appeler, et
 *     l'un d'eux oublierait. Ici, le message qui remonte à l'écran est écrit une
 *     fois, en français, et dit quoi faire.
 */
export class DisabledDomainRegistrar implements DomainRegistrar {
  readonly providerName = 'aucun';

  /**
   * Méthodes `async` : le refus doit arriver par une promesse REJETÉE, comme
   * n'importe quel échec d'un vrai fournisseur. Un `throw` synchrone dans une
   * méthode qui promet un `Promise` passe à côté des `catch` de l'appelant et
   * remonte en 500 au lieu du message écrit ici.
   */
  private refuse(): never {
    throw new ServiceUnavailableException(
      'Les domaines personnalisés ne sont pas activés sur cette installation. Le restaurant reste accessible sur son adresse Snack Manager.',
    );
  }

  async register(_domain: PublicDomain): Promise<DomainRegistration> {
    return this.refuse();
  }

  async check(_providerId: string): Promise<DomainCheck> {
    return this.refuse();
  }

  async release(_providerId: string): Promise<void> {
    return this.refuse();
  }
}
