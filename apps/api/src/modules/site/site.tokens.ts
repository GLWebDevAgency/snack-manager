import { Inject, Optional, ServiceUnavailableException } from '@nestjs/common';
import type { Clock, DomainRegistrar } from '@sm/domain';
import { DOMAIN_REGISTRAR } from '../../infrastructure/tokens';

/**
 * Jetons d'injection des PORTS consommés par ce module.
 *
 * Les cas d'usage ci-dessous ne connaissent que les interfaces déclarées dans
 * `@sm/domain/ports` : `DomainRegistrar` (Railway aujourd'hui, Cloudflare for
 * SaaS demain) et `Clock`. Nest a besoin d'un jeton pour injecter une interface
 * — TypeScript efface les types à la compilation — d'où ces constantes.
 *
 * `DOMAIN_REGISTRAR` est celui de l'infrastructure, réexporté et jamais
 * redéclaré : deux constantes du même nom qui divergeraient d'un caractère
 * donneraient une erreur d'injection illisible au démarrage.
 */
export { DOMAIN_REGISTRAR };

/** Horloge injectable — le domaine interdit `Date.now()`, l'application aussi. */
export const CLOCK = 'CLOCK';

/** `@InjectRegistrar()` — le registrar est optionnel : cf. `requireRegistrar`. */
export const InjectRegistrar = (): ParameterDecorator => {
  const optional = Optional();
  const inject = Inject(DOMAIN_REGISTRAR);
  return (target, key, index) => {
    optional(target, key, index as number);
    inject(target, key, index as number);
  };
};

/**
 * Un adaptateur manquant ne doit pas empêcher l'API de démarrer : le reste du
 * back-office (commandes, menu, stocks) n'a rien à voir avec les domaines.
 * On échoue donc tard, sur la seule route concernée, avec un message que le
 * support peut lire tel quel.
 */
export function requireRegistrar(registrar: DomainRegistrar | null | undefined): DomainRegistrar {
  if (!registrar) {
    throw new ServiceUnavailableException(
      "La gestion des domaines n'est pas encore activée sur cet environnement. Contactez le support Snack Manager.",
    );
  }
  return registrar;
}

export type { Clock, DomainRegistrar };
