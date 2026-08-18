import { ServiceUnavailableException } from '@nestjs/common';
import { PublicDomain, unwrap } from '@sm/domain';
import { describe, expect, it } from 'vitest';

import type { Fetch } from '../http';
import {
  CloudflareDomainRegistrar,
  readCloudflareConfig,
  type CloudflareConfig,
} from './cloudflare-domain-registrar';

/**
 * Le vrai sujet de ces tests : deux fournisseurs au vocabulaire différent
 * doivent produire les MÊMES quatre états métier. Si Cloudflare répondait
 * autre chose que Railway sur une situation identique, le port ne tiendrait pas
 * et la bascule à 100 clients serait une migration déguisée.
 */

const CONFIG: CloudflareConfig = {
  token: 'cf-token',
  zoneId: 'zone_1',
  fallbackOrigin: 'clients.snackmanager.fr',
  endpoint: 'https://api.cloudflare.com/client/v4',
};

const CLASSFOOD = unwrap(PublicDomain.create('commander.classfood.fr'));

interface Call {
  readonly url: string;
  readonly method: string;
}

function fakeFetch(responses: Response[]): { impl: Fetch; calls: Call[] } {
  const calls: Call[] = [];
  const queue = [...responses];

  const impl: Fetch = async (input, init) => {
    calls.push({ url: String(input), method: String(init?.method ?? 'GET') });
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

function hostname(overrides: Record<string, unknown>) {
  return {
    success: true,
    errors: [],
    result: { id: 'ch_7', hostname: CLASSFOOD.toString(), ...overrides },
  };
}

describe('CloudflareDomainRegistrar', () => {
  it('rattache le hostname et renvoie l’origine de repli comme cible CNAME', async () => {
    // Chez Cloudflare le restaurateur pointe vers la « fallback origin » de la
    // zone, pas vers notre service : c'est ce nom-là qu'il faut lui dicter.
    const { impl, calls } = fakeFetch([
      json(hostname({ status: 'pending', ssl: { status: 'pending_validation' } })),
    ]);

    const registration = await new CloudflareDomainRegistrar(CONFIG, impl).register(CLASSFOOD);

    expect(registration.providerId).toBe('ch_7');
    expect(registration.target).toBe('clients.snackmanager.fr');
    expect(registration.status).toBe('pending_dns');
    expect(calls[0]?.url).toBe(
      'https://api.cloudflare.com/client/v4/zones/zone_1/custom_hostnames',
    );
    expect(calls[0]?.method).toBe('POST');
  });

  it('annonce le certificat en cours quand le CNAME est posé mais pas le TLS', async () => {
    const { impl } = fakeFetch([
      json(hostname({ status: 'active', ssl: { status: 'pending_issuance' } })),
    ]);

    const check = await new CloudflareDomainRegistrar(CONFIG, impl).check('ch_7');

    expect(check.status).toBe('issuing_certificate');
  });

  it('déclare le domaine actif quand hostname et certificat le sont', async () => {
    const { impl } = fakeFetch([
      json(hostname({ status: 'active', ssl: { status: 'active' } })),
    ]);

    const check = await new CloudflareDomainRegistrar(CONFIG, impl).check('ch_7');

    expect(check).toEqual({ status: 'active' });
  });

  it('signale un domaine déjà rattaché chez un autre client', async () => {
    // Cas réel : le restaurateur a testé un concurrent avant nous et son
    // hostname est resté accroché là-bas. Il faut le dire, pas attendre.
    const { impl } = fakeFetch([json(hostname({ status: 'moved', ssl: { status: 'deleted' } }))]);

    const check = await new CloudflareDomainRegistrar(CONFIG, impl).check('ch_7');

    expect(check.status).toBe('failed');
    expect(check.detail).toContain('rattaché ailleurs');
  });

  it('lit l’échec porté par « success: false » malgré un statut 200', async () => {
    const { impl } = fakeFetch([
      json({ success: false, errors: [{ code: 1406, message: 'Duplicate custom hostname' }] }),
    ]);

    await expect(new CloudflareDomainRegistrar(CONFIG, impl).register(CLASSFOOD)).rejects.toThrow(
      /Duplicate custom hostname/,
    );
  });

  it('transforme une coupure réseau en indisponibilité lisible', async () => {
    const impl: Fetch = async () => {
      throw new TypeError('fetch failed');
    };

    await expect(new CloudflareDomainRegistrar(CONFIG, impl).check('ch_7')).rejects.toThrow(
      ServiceUnavailableException,
    );
  });

  it('refuse la demande sans planter quand la configuration Cloudflare manque', async () => {
    const registrar = new CloudflareDomainRegistrar(null);

    expect(registrar.isConfigured()).toBe(false);
    await expect(registrar.register(CLASSFOOD)).rejects.toThrow(/CLOUDFLARE_API_TOKEN/);
  });

  it('détache le hostname à la résiliation', async () => {
    const { impl, calls } = fakeFetch([json(hostname({ status: 'pending_deletion' }))]);

    await new CloudflareDomainRegistrar(CONFIG, impl).release('ch_7');

    expect(calls[0]?.method).toBe('DELETE');
    expect(calls[0]?.url).toContain('/custom_hostnames/ch_7');
  });
});

describe('readCloudflareConfig', () => {
  it('nomme les variables manquantes', () => {
    const config = readCloudflareConfig(() => undefined);

    expect(config.configured).toBe(false);
    if (!config.configured) {
      expect(config.missing).toContain('CLOUDFLARE_FALLBACK_ORIGIN');
    }
  });
});
