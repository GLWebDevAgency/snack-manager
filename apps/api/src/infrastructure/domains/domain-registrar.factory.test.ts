import { describe, expect, it } from 'vitest';

import type { FactoryLogger } from '../factory-logger';
import { CloudflareDomainRegistrar } from './cloudflare-domain-registrar';
import { DisabledDomainRegistrar } from './disabled-domain-registrar';
import { createDomainRegistrar } from './domain-registrar.factory';
import { RailwayDomainRegistrar } from './railway-domain-registrar';

/**
 * Ces tests valent une promesse d'architecture : passer de Railway à Cloudflare
 * quand le parc dépassera la centaine de restaurants doit tenir dans UNE
 * variable d'environnement. Le jour où quelqu'un ajoute un `if (railway)`
 * ailleurs dans l'application, c'est ici que ça se voit en premier.
 */

function env(values: Record<string, string>) {
  return (key: string) => values[key];
}

function recorder(): FactoryLogger & { lines: string[] } {
  const lines: string[] = [];
  return {
    lines,
    log: (message) => lines.push(message),
    warn: (message) => lines.push(message),
  };
}

const RAILWAY_ENV = {
  DOMAIN_PROVIDER: 'railway',
  RAILWAY_TOKEN: 'tok',
  RAILWAY_PROJECT_ID: 'proj',
  RAILWAY_ENVIRONMENT_ID: 'env',
  RAILWAY_SERVICE_ID: 'svc',
};

const CLOUDFLARE_ENV = {
  DOMAIN_PROVIDER: 'cloudflare',
  CLOUDFLARE_API_TOKEN: 'tok',
  CLOUDFLARE_ZONE_ID: 'zone',
  CLOUDFLARE_FALLBACK_ORIGIN: 'clients.snackmanager.fr',
};

describe('createDomainRegistrar', () => {
  it('sert Railway tant que le parc tient sur l’hébergement du pilote', () => {
    const registrar = createDomainRegistrar(env(RAILWAY_ENV), recorder());

    expect(registrar).toBeInstanceOf(RailwayDomainRegistrar);
    expect(registrar.providerName).toBe('Railway');
  });

  it('bascule sur Cloudflare par la seule variable d’environnement', () => {
    const registrar = createDomainRegistrar(env(CLOUDFLARE_ENV), recorder());

    expect(registrar).toBeInstanceOf(CloudflareDomainRegistrar);
    expect(registrar.providerName).toBe('Cloudflare for SaaS');
  });

  it('n’active aucun fournisseur sur une installation neuve', () => {
    // Aucune variable : c'est le premier déploiement, et personne n'a encore
    // demandé de domaine à soi. Ce n'est pas une erreur de configuration.
    const registrar = createDomainRegistrar(env({}), recorder());

    expect(registrar).toBeInstanceOf(DisabledDomainRegistrar);
  });

  it('prévient au démarrage quand le fournisseur choisi est incomplet, sans lever', () => {
    // Le cas qui coûte une soirée : la variable est posée, les jetons non. On
    // démarre quand même, et le journal dit exactement ce qui manque.
    const logger = recorder();

    const registrar = createDomainRegistrar(env({ DOMAIN_PROVIDER: 'railway' }), logger);

    expect(registrar).toBeInstanceOf(RailwayDomainRegistrar);
    expect(logger.lines.join(' ')).toContain('RAILWAY_TOKEN');
  });

  it('refuse de deviner sur une valeur inconnue et retombe sur « désactivé »', () => {
    // « railwy » ne doit pas devenir « railway » : brancher un fournisseur que
    // personne n'a demandé est pire que ne rien brancher.
    const logger = recorder();

    const registrar = createDomainRegistrar(env({ DOMAIN_PROVIDER: 'railwy' }), logger);

    expect(registrar).toBeInstanceOf(DisabledDomainRegistrar);
    expect(logger.lines.join(' ')).toContain('railwy');
  });

  it('tolère la casse et les espaces autour de la valeur', () => {
    const registrar = createDomainRegistrar(
      env({ ...CLOUDFLARE_ENV, DOMAIN_PROVIDER: '  Cloudflare ' }),
      recorder(),
    );

    expect(registrar).toBeInstanceOf(CloudflareDomainRegistrar);
  });
});

describe('DisabledDomainRegistrar', () => {
  it('explique que le restaurant reste joignable sur son adresse Snack Manager', async () => {
    const registrar = new DisabledDomainRegistrar();

    await expect(registrar.check('peu-importe')).rejects.toThrow(/adresse Snack Manager/);
  });
});
