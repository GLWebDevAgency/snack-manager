import 'reflect-metadata';
import { EventEmitter } from 'node:events';
import { ServiceUnavailableException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';
import type { SharedPublicQuota } from '../../common/shared-public-quota';
import { fetchV4Of, type RequestFn } from '../../infrastructure/http-v4';
import { NewsletterService, NewsletterSubscribeSchema } from './newsletter.service';

const BODY = { email: 'restaurateur@example.test', consent: true, source: 'site-vitrine' } as const;
const ENV = {
  BREVO_API_KEY: 'fixture-key-never-used-on-network',
  SM_NEWSLETTER_LIST_ID: '12',
  SM_NEWSLETTER_DOI_TEMPLATE_ID: '34',
  SM_NEWSLETTER_REDIRECT_URL: 'https://newsletter.example.test/newsletter/confirmation',
};

function fixture(overrides: Record<string, string | undefined> = {}) {
  const env: Record<string, string | undefined> = { ...ENV, ...overrides };
  const config = { get: (name: string) => env[name] } as unknown as ConfigService;
  const reserve = vi.fn().mockResolvedValue(true);
  const reserveClient = vi.fn().mockResolvedValue(true);
  const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 201 }));
  const service = new NewsletterService(config, { reserve, reserveClient } as unknown as SharedPublicQuota, transport);
  return { service, reserve, reserveClient, transport };
}

describe('newsletter — contrat strict', () => {
  it('normalise l’adresse avant son usage comme identité de quota', () => {
    expect(NewsletterSubscribeSchema.parse({ ...BODY, email: '  RESTAURATEUR@Example.Test  ' })).toEqual(BODY);
  });

  it.each([
    { ...BODY, email: '' }, { ...BODY, email: 'sans-arobase' }, { ...BODY, email: ['resto@example.test'] },
    { ...BODY, email: `${'r'.repeat(245)}@example.test` }, { ...BODY, consent: false },
    { email: BODY.email, source: BODY.source }, { ...BODY, consent: 'true' },
    { ...BODY, source: 'crm' }, { ...BODY, includeListIds: [99] },
    { ...BODY, templateId: 99 }, { ...BODY, redirectionUrl: 'https://forged.example.test' },
  ])('refuse une requête invalide ou une configuration fournie par le visiteur', (body) => {
    expect(NewsletterSubscribeSchema.safeParse(body).success).toBe(false);
  });
});

describe('newsletter — double opt-in Brevo', () => {
  it('acquitte une demande en attente seulement après le 201 fournisseur', async () => {
    const f = fixture();
    await expect(f.service.subscribe(BODY)).resolves.toEqual({ ok: true, pending: true });
    expect(f.transport).toHaveBeenCalledOnce();
    const [url, init] = f.transport.mock.calls[0]!;
    expect(url).toBe('https://api.brevo.com/v3/contacts/doubleOptinConfirmation');
    expect(init).toMatchObject({ method: 'POST', headers: { 'content-type': 'application/json', 'api-key': ENV.BREVO_API_KEY } });
    expect(JSON.parse(String(init?.body))).toEqual({ email: BODY.email, includeListIds: [12], templateId: 34, redirectionUrl: ENV.SM_NEWSLETTER_REDIRECT_URL });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(f.reserve).toHaveBeenCalledWith({ scope: 'newsletter-requests', clientKey: 'site-vitrine', windowMs: 600_000, clientLimit: 30, globalLimit: 30 });
    expect(f.reserveClient).toHaveBeenCalledWith({ scope: 'newsletter-email', clientKey: expect.stringMatching(/^[a-f0-9]{64}$/), windowMs: 3_600_000, clientLimit: 3 });
    expect(f.reserve.mock.invocationCallOrder[0]).toBeLessThan(f.reserveClient.mock.invocationCallOrder[0]!);
    expect(JSON.stringify(f.reserveClient.mock.calls)).not.toContain(BODY.email);
    // No blacklisting override, implicit CRM enrollment or visitor-controlled attributes.
    expect(Object.keys(JSON.parse(String(init?.body)))).toHaveLength(4);
  });

  it.each(Object.keys(ENV))('ferme sans quota ni envoi quand %s manque', async (key) => {
    const f = fixture({ [key]: undefined });
    await expect(f.service.subscribe(BODY)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(f.reserve).not.toHaveBeenCalled();
    expect(f.transport).not.toHaveBeenCalled();
  });

  it.each([
    { SM_NEWSLETTER_LIST_ID: '0' }, { SM_NEWSLETTER_LIST_ID: '1.5' },
    { SM_NEWSLETTER_DOI_TEMPLATE_ID: '9007199254740993' },
    { SM_NEWSLETTER_REDIRECT_URL: 'http://newsletter.example.test/confirmation' },
    { SM_NEWSLETTER_REDIRECT_URL: 'not a URL' },
    { SM_NEWSLETTER_REDIRECT_URL: 'https://user:password@newsletter.example.test/confirmation' },
    { SM_NEWSLETTER_REDIRECT_URL: 'https://newsletter.example.test/wrong-page' },
    { SM_NEWSLETTER_REDIRECT_URL: 'https://newsletter.example.test/newsletter/confirmation?confirmed=true' },
    { SM_NEWSLETTER_REDIRECT_URL: 'https://newsletter.example.test/newsletter/confirmation#confirmed' },
  ])('refuse une configuration invalide', async (env) => {
    const f = fixture(env);
    await expect(f.service.subscribe(BODY)).rejects.toMatchObject({ status: 503 });
    expect(f.transport).not.toHaveBeenCalled();
  });

  it.each([200, 202, 204, 400, 401, 429, 500])('ne déclare pas de confirmation envoyée pour HTTP %s', async (status) => {
    const f = fixture();
    f.transport.mockResolvedValue(new Response(status === 204 ? null : 'private-provider-detail', { status }));
    await expect(f.service.subscribe(BODY)).rejects.toMatchObject({ status: 503, message: expect.not.stringContaining('private-provider-detail') });
  });

  it('transforme un vrai HTTP 204 du transport IPv4 en 503 maîtrisé', async () => {
    const requestFn: RequestFn = (_url, _options, callback) => {
      const request = new EventEmitter() as EventEmitter & {
        end: () => void;
        destroy: (error?: Error) => void;
      };
      request.end = () => {
        setImmediate(() => {
          const response = new EventEmitter() as EventEmitter & { statusCode: number };
          response.statusCode = 204;
          callback(response as never);
          response.emit('end');
        });
      };
      request.destroy = (error) => { if (error) request.emit('error', error); };
      return request as never;
    };
    const f = fixture();
    // Substitute only HTTPS IO: execute the actual adapter and its Response
    // construction so a provider's empty response cannot hide behind a mock.
    f.transport.mockImplementation(fetchV4Of(requestFn));
    await expect(f.service.subscribe(BODY)).rejects.toMatchObject({
      status: 503, message: 'L’inscription est momentanément indisponible. Réessayez dans un instant.',
    });
    expect(f.transport).toHaveBeenCalledOnce();
  });

  it('rend une erreur générique sur timeout sans exposer l’exception du transport', async () => {
    const f = fixture();
    f.transport.mockRejectedValue(new Error(`timeout ${BODY.email} ${ENV.BREVO_API_KEY}`));
    await expect(f.service.subscribe(BODY)).rejects.toMatchObject({ status: 503, message: 'L’inscription est momentanément indisponible. Réessayez dans un instant.' });
    expect(f.transport).toHaveBeenCalledOnce();
  });

  it('refuse avant le quota email et avant Brevo si la limite globale est atteinte', async () => {
    const f = fixture(); f.reserve.mockResolvedValue(false);
    await expect(f.service.subscribe(BODY)).rejects.toMatchObject({ status: 429 });
    expect(f.reserveClient).not.toHaveBeenCalled(); expect(f.transport).not.toHaveBeenCalled();
  });

  it('borne chaque adresse sans modifier sa préférence marketing chez Brevo', async () => {
    const f = fixture(); f.reserveClient.mockResolvedValue(false);
    await expect(f.service.subscribe(BODY)).rejects.toMatchObject({ status: 429 });
    expect(f.transport).not.toHaveBeenCalled();
  });

  it.each(['reserve', 'reserveClient'] as const)('échoue fermé si Redis échoue pendant %s', async (operation) => {
    const f = fixture(); f[operation].mockRejectedValue(new Error('Redis unavailable'));
    await expect(f.service.subscribe(BODY)).rejects.toMatchObject({ status: 503 });
    expect(f.transport).not.toHaveBeenCalled();
  });
});
