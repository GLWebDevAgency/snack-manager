import { ServiceUnavailableException } from '@nestjs/common';
import { PublicDomain, unwrap } from '@sm/domain';
import { describe, expect, it } from 'vitest';

import type { Fetch } from '../http';
import {
  RAILWAY_REQUIRED_KEYS,
  RailwayDomainRegistrar,
  readRailwayConfig,
  type RailwayConfig,
} from './railway-domain-registrar';

/**
 * Tests de l'adaptateur Railway avec un `fetch` simulé.
 *
 * On ne teste pas Railway, on teste NOTRE traduction : est-ce qu'un CNAME
 * absent devient bien « posez cet enregistrement » et pas une erreur 500 ?
 * est-ce qu'une box coupée pendant l'appel laisse un message lisible au gérant ?
 * Ce sont les seules choses qui changent ce que voit un humain.
 */

const CONFIG: RailwayConfig = {
  token: 'railway-token',
  projectId: 'proj_1',
  environmentId: 'env_1',
  serviceId: 'svc_1',
  cnameTarget: 'snackmanager.up.railway.app',
  endpoint: 'https://backboard.railway.com/graphql/v2',
};

const CLASSFOOD = unwrap(PublicDomain.create('commander.classfood.fr'));

interface Call {
  readonly url: string;
  readonly body: { query: string; variables: Record<string, unknown> };
}

/** `fetch` simulé : renvoie les réponses dans l'ordre, et retient les appels. */
function fakeFetch(responses: Response[]): { impl: Fetch; calls: Call[] } {
  const calls: Call[] = [];
  const queue = [...responses];

  const impl: Fetch = async (input, init) => {
    calls.push({
      url: String(input),
      body: JSON.parse(String(init?.body ?? '{}')) as Call['body'],
    });
    const next = queue.shift();
    if (!next) throw new Error('appel fetch inattendu dans le test');
    return next;
  };

  return { impl, calls };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function railwayDomain(status: Record<string, unknown>) {
  return { id: 'cd_42', domain: CLASSFOOD.toString(), status };
}

/** DNS pas encore posé : l'état de départ de tout rattachement. */
const AWAITING_DNS = {
  certificateStatus: 'ISSUING',
  cnameCheck: 'WAITING',
  dnsRecords: [
    {
      recordType: 'CNAME',
      requiredValue: 'classfood.up.railway.app',
      currentValue: null,
      status: 'REQUIRES_UPDATE',
      fqdn: 'commander.classfood.fr',
    },
  ],
};

describe('RailwayDomainRegistrar', () => {
  it('rattache le domaine et renvoie le CNAME que le restaurateur doit poser', async () => {
    const { impl, calls } = fakeFetch([
      json({ data: { customDomainCreate: railwayDomain(AWAITING_DNS) } }),
    ]);
    const registrar = new RailwayDomainRegistrar(CONFIG, impl);

    const registration = await registrar.register(CLASSFOOD);

    expect(registration.providerId).toBe('cd_42');
    // La valeur renvoyée par Railway prime sur le repli configuré : c'est elle
    // qui est réellement attendue par leur validateur.
    expect(registration.target).toBe('classfood.up.railway.app');
    expect(registration.status).toBe('pending_dns');
    expect(registration.domain.toString()).toBe('commander.classfood.fr');

    const call = calls[0];
    expect(call?.url).toBe(CONFIG.endpoint);
    expect(call?.body.query).toContain('customDomainCreate');
    expect(call?.body.variables).toEqual({
      input: {
        domain: 'commander.classfood.fr',
        projectId: 'proj_1',
        environmentId: 'env_1',
        serviceId: 'svc_1',
      },
    });
  });

  it('retombe sur le CNAME configuré quand Railway ne renvoie aucun enregistrement', async () => {
    // Railway renvoie parfois un domaine tout juste créé, sans grille DNS : le
    // restaurateur doit quand même repartir avec quelque chose à taper chez son
    // bureau d'enregistrement.
    const { impl } = fakeFetch([
      json({ data: { customDomainCreate: railwayDomain({ dnsRecords: [] }) } }),
    ]);

    const registration = await new RailwayDomainRegistrar(CONFIG, impl).register(CLASSFOOD);

    expect(registration.target).toBe('snackmanager.up.railway.app');
  });

  it('annonce le certificat en cours dès que le DNS est propagé', async () => {
    const { impl } = fakeFetch([
      json({
        data: {
          customDomain: railwayDomain({
            certificateStatus: 'ISSUING',
            cnameCheck: 'VALID',
            dnsRecords: [{ recordType: 'CNAME', status: 'PROPAGATED', requiredValue: 'x' }],
          }),
        },
      }),
    ]);

    const check = await new RailwayDomainRegistrar(CONFIG, impl).check('cd_42');

    expect(check.status).toBe('issuing_certificate');
  });

  it('déclare le domaine actif une fois le certificat émis', async () => {
    const { impl } = fakeFetch([
      json({
        data: {
          customDomain: railwayDomain({
            certificateStatus: 'ISSUED',
            cnameCheck: 'VALID',
            dnsRecords: [{ recordType: 'CNAME', status: 'PROPAGATED', requiredValue: 'x' }],
          }),
        },
      }),
    ]);

    const check = await new RailwayDomainRegistrar(CONFIG, impl).check('cd_42');

    expect(check).toEqual({ status: 'active' });
  });

  it('indique quel enregistrement DNS manque plutôt qu’un simple « en attente »', async () => {
    const { impl } = fakeFetch([json({ data: { customDomain: railwayDomain(AWAITING_DNS) } })]);

    const check = await new RailwayDomainRegistrar(CONFIG, impl).check('cd_42');

    expect(check.status).toBe('pending_dns');
    expect(check.detail).toContain('classfood.up.railway.app');
  });

  it('signale un échec quand le certificat n’a pas pu être émis', async () => {
    const { impl } = fakeFetch([
      json({
        data: {
          customDomain: railwayDomain({
            certificateStatus: 'ERROR',
            dnsRecords: [{ recordType: 'CNAME', status: 'PROPAGATED', requiredValue: 'x' }],
          }),
        },
      }),
    ]);

    const check = await new RailwayDomainRegistrar(CONFIG, impl).check('cd_42');

    expect(check.status).toBe('failed');
  });

  it('transforme une coupure réseau en indisponibilité lisible', async () => {
    // La box du snack tombe, ou Railway ne répond pas : le gérant doit lire
    // « réessayez », pas « fetch failed ».
    const impl: Fetch = async () => {
      throw new TypeError('fetch failed');
    };
    const registrar = new RailwayDomainRegistrar(CONFIG, impl);

    await expect(registrar.register(CLASSFOOD)).rejects.toThrow(ServiceUnavailableException);
    await expect(registrar.register(CLASSFOOD)).rejects.toThrow(/injoignable/);
  });

  it('détecte une erreur GraphQL renvoyée avec un statut 200', async () => {
    // GraphQL répond 200 même quand il refuse : se fier au statut HTTP ferait
    // croire à un rattachement réussi et laisserait un domaine fantôme en base.
    const { impl } = fakeFetch([
      json({ errors: [{ message: 'Domain already exists on another service' }] }),
    ]);

    await expect(new RailwayDomainRegistrar(CONFIG, impl).register(CLASSFOOD)).rejects.toThrow(
      /already exists/,
    );
  });

  it('refuse la demande sans planter quand la configuration Railway manque', async () => {
    // Cas du premier déploiement : aucune variable Railway n'est posée. L'API
    // doit démarrer, et seul le rattachement de domaine répond « indisponible ».
    const registrar = new RailwayDomainRegistrar(null);

    expect(registrar.isConfigured()).toBe(false);
    await expect(registrar.register(CLASSFOOD)).rejects.toThrow(ServiceUnavailableException);
    await expect(registrar.check('cd_42')).rejects.toThrow(/RAILWAY_TOKEN/);
    await expect(registrar.release('cd_42')).rejects.toThrow(/indisponibles/);
  });

  it('détache le domaine à la résiliation', async () => {
    const { impl, calls } = fakeFetch([json({ data: { customDomainDelete: true } })]);

    await new RailwayDomainRegistrar(CONFIG, impl).release('cd_42');

    expect(calls[0]?.body.query).toContain('customDomainDelete');
    expect(calls[0]?.body.variables).toEqual({ id: 'cd_42' });
  });
});

describe('readRailwayConfig', () => {
  it('nomme les variables manquantes pour éviter la comparaison de deux .env', () => {
    const config = readRailwayConfig((key) => (key === 'RAILWAY_TOKEN' ? 'tok' : undefined));

    expect(config.configured).toBe(false);
    if (!config.configured) {
      expect(config.missing).toEqual([
        'RAILWAY_PROJECT_ID',
        'RAILWAY_ENVIRONMENT_ID',
        'RAILWAY_SERVICE_ID',
      ]);
    }
  });

  it('traite une variable blanche comme absente', () => {
    // Une valeur collée depuis un tableur arrive avec des espaces : « configurée
    // mais vide » est le pire des états, il passe les vérifications et échoue à
    // l'appel.
    const values: Record<string, string> = Object.fromEntries(
      RAILWAY_REQUIRED_KEYS.map((key) => [key, 'valeur']),
    );
    values.RAILWAY_SERVICE_ID = '   ';

    const config = readRailwayConfig((key) => values[key]);

    expect(config.configured).toBe(false);
  });

  it('accepte une configuration complète et retient le point d’entrée par défaut', () => {
    const values: Record<string, string> = Object.fromEntries(
      RAILWAY_REQUIRED_KEYS.map((key) => [key, 'valeur']),
    );

    const config = readRailwayConfig((key) => values[key]);

    expect(config.configured).toBe(true);
    if (config.configured) {
      expect(config.value.endpoint).toBe('https://backboard.railway.com/graphql/v2');
      expect(config.value.cnameTarget).toBeNull();
    }
  });
});
