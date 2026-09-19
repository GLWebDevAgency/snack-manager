import 'reflect-metadata';
import { Module, type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { IS_PUBLIC } from '../../common/auth';
import { SharedPublicQuota } from '../../common/shared-public-quota';
import { ContactIngestGuard } from './contact-ingest.guard';
import { NEWSLETTER_FETCH, NewsletterService } from './newsletter.service';
import { PublicNewsletterController } from './public-newsletter.controller';

const env: Record<string, string> = {
  SM_CONTACT_INGEST_TOKEN: 'newsletter-fixture-ingest', BREVO_API_KEY: 'fixture-key',
  SM_NEWSLETTER_LIST_ID: '12', SM_NEWSLETTER_DOI_TEMPLATE_ID: '34',
  SM_NEWSLETTER_REDIRECT_URL: 'https://newsletter.example.test/newsletter/confirmation',
};
const config = { get: (name: string) => env[name] } as unknown as ConfigService;
const transport = vi.fn<typeof fetch>();
const reserve = vi.fn(), reserveClient = vi.fn();

@Module({
  controllers: [PublicNewsletterController],
  providers: [NewsletterService, { provide: ConfigService, useValue: config },
    ContactIngestGuard,
    { provide: SharedPublicQuota, useValue: { reserve, reserveClient } },
    { provide: NEWSLETTER_FETCH, useValue: transport }],
})
class NewsletterFixtureModule {}

let app: INestApplication, origin: string;
const guardMetadata = Reflect.getOwnMetadata('design:paramtypes', ContactIngestGuard);
beforeAll(async () => {
  // Vitest/esbuild does not emit the constructor metadata that tsc emits in
  // production. Restore only that metadata; the real guard still runs over HTTP.
  if (!guardMetadata) Reflect.defineMetadata('design:paramtypes', [ConfigService], ContactIngestGuard);
  app = await NestFactory.create(NewsletterFixtureModule, { logger: false });
  await app.listen(0, '127.0.0.1'); origin = await app.getUrl();
});
afterAll(async () => { await app?.close(); if (!guardMetadata) Reflect.deleteMetadata('design:paramtypes', ContactIngestGuard); });
beforeEach(() => { vi.clearAllMocks(); reserve.mockResolvedValue(true); reserveClient.mockResolvedValue(true); transport.mockResolvedValue(new Response('{}', { status: 201 })); });

async function post(body: unknown, token = env.SM_CONTACT_INGEST_TOKEN) {
  return fetch(`${origin}/public/newsletter`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
}

describe('newsletter — route HTTP locale et transport Brevo simulé', () => {
  it('reste publique pour JWT et protégée par la garde de service', () => {
    expect(Reflect.getMetadata(IS_PUBLIC, PublicNewsletterController)).toBe(true);
    expect(Reflect.getMetadata('__guards__', PublicNewsletterController)).toContain(ContactIngestGuard);
  });
  it('normalise le corps et retourne 202 pending sans abonnement implicitement confirmé', async () => {
    const res = await post({ email: '  RESTO@Example.Test ', consent: true, source: 'site-vitrine' });
    expect(res.status).toBe(202); expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await res.json()).toEqual({ ok: true, pending: true });
    expect(JSON.parse(String(transport.mock.calls[0]?.[1]?.body)).email).toBe('resto@example.test');
  });
  it('refuse une autorité absente ou incorrecte avant tout quota et envoi', async () => {
    const res = await post({ email: 'resto@example.test', consent: true, source: 'site-vitrine' }, 'invalid');
    expect(res.status).toBe(404); expect(reserve).not.toHaveBeenCalled(); expect(transport).not.toHaveBeenCalled();
  });
  it('refuse le consentement absent et les paramètres fournisseur injectés', async () => {
    for (const body of [{ email: 'resto@example.test', source: 'site-vitrine' }, { email: 'resto@example.test', consent: true, source: 'site-vitrine', includeListIds: [99] }]) {
      expect((await post(body)).status).toBe(400);
    }
    expect(reserve).not.toHaveBeenCalled(); expect(transport).not.toHaveBeenCalled();
  });
  it('rend 429 sans contacter Brevo quand le budget public est épuisé', async () => {
    reserve.mockResolvedValue(false);
    expect((await post({ email: 'resto@example.test', consent: true, source: 'site-vitrine' })).status).toBe(429);
    expect(transport).not.toHaveBeenCalled();
  });
  it('rend 503 sans recopier les détails privés du fournisseur', async () => {
    transport.mockResolvedValue(new Response('private-provider-error', { status: 400 }));
    const res = await post({ email: 'resto@example.test', consent: true, source: 'site-vitrine' });
    expect(res.status).toBe(503); expect(await res.text()).not.toContain('private-provider-error');
  });
});
