import { Logger } from '@nestjs/common';
import type { DomainRegistrar } from '@sm/domain/src/ports';

import type { FactoryLogger } from '../factory-logger';
import type { Fetch } from '../http';
import { CloudflareDomainRegistrar, readCloudflareConfig } from './cloudflare-domain-registrar';
import { DisabledDomainRegistrar } from './disabled-domain-registrar';
import { RailwayDomainRegistrar, readRailwayConfig } from './railway-domain-registrar';
import type { ConfigSource } from './registrar-config';

/**
 * LE point de bascule.
 *
 * Tout le reste de l'application ne connaît que `DomainRegistrar`. Ici, et
 * seulement ici, on décide qui l'incarne. Passer de Railway à Cloudflare quand
 * le parc dépasse la centaine de restaurants (cf. l'en-tête de
 * `cloudflare-domain-registrar.ts`) tient donc en une variable d'environnement
 * et un redéploiement — pas en une migration, pas en une relecture du métier.
 *
 * Deuxième règle, aussi importante : cette fabrique NE LÈVE JAMAIS. Une
 * configuration absente ou fautive dégrade la fonctionnalité « domaine à soi »
 * et n'empêche pas le service du soir. Une API qui refuse de démarrer parce
 * qu'un jeton Cloudflare a expiré, c'est une caisse morte pour une option que
 * personne n'utilise ce soir-là.
 */

export const DOMAIN_PROVIDERS = ['railway', 'cloudflare', 'null'] as const;
export type DomainProvider = (typeof DOMAIN_PROVIDERS)[number];

export function createDomainRegistrar(
  get: ConfigSource,
  logger: FactoryLogger = new Logger('DomainRegistrarFactory'),
  fetchImpl: Fetch = globalThis.fetch,
): DomainRegistrar {
  const provider = normalize(get('DOMAIN_PROVIDER'));

  if (provider === null) {
    // Valeur inconnue : on le dit et on retombe sur « désactivé ». Deviner
    // « railway » sur une faute de frappe brancherait un fournisseur que
    // personne n'a demandé.
    logger.warn(
      `DOMAIN_PROVIDER=« ${get('DOMAIN_PROVIDER')} » inconnu (attendu : ${DOMAIN_PROVIDERS.join(', ')}) — domaines personnalisés désactivés.`,
    );
    return new DisabledDomainRegistrar();
  }

  switch (provider) {
    case 'railway': {
      const config = readRailwayConfig(get);
      if (!config.configured) {
        logger.warn(
          `Railway sélectionné mais incomplet — variables manquantes : ${config.missing.join(', ')}. Le rattachement de domaine répondra « indisponible ».`,
        );
        return new RailwayDomainRegistrar(null, fetchImpl);
      }
      logger.log('Fournisseur de domaines : Railway');
      return new RailwayDomainRegistrar(config.value, fetchImpl);
    }

    case 'cloudflare': {
      const config = readCloudflareConfig(get);
      if (!config.configured) {
        logger.warn(
          `Cloudflare sélectionné mais incomplet — variables manquantes : ${config.missing.join(', ')}. Le rattachement de domaine répondra « indisponible ».`,
        );
        return new CloudflareDomainRegistrar(null, fetchImpl);
      }
      logger.log('Fournisseur de domaines : Cloudflare for SaaS');
      return new CloudflareDomainRegistrar(config.value, fetchImpl);
    }

    case 'null':
      logger.log('Fournisseur de domaines : aucun (adresses Snack Manager uniquement)');
      return new DisabledDomainRegistrar();
  }
}

/**
 * Variable absente = « null » : une installation neuve n'a pas de domaine
 * personnalisé, et exiger la variable ferait échouer chaque premier déploiement.
 */
function normalize(raw: string | undefined): DomainProvider | null {
  const value = (raw ?? '').trim().toLowerCase();
  if (value === '') return 'null';
  return (DOMAIN_PROVIDERS as readonly string[]).includes(value)
    ? (value as DomainProvider)
    : null;
}
