import { createHash } from 'node:crypto';
import { HttpException, Inject, Injectable, Optional, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import { SharedPublicQuota } from '../../common/shared-public-quota';
import { fetchV4 } from '../../infrastructure/http-v4';

export const NewsletterSubscribeSchema = z.object({
  email: z.string().trim().toLowerCase().max(254).email(),
  consent: z.literal(true),
  source: z.literal('site-vitrine'),
}).strict();
export type NewsletterSubscribe = z.infer<typeof NewsletterSubscribeSchema>;
export type NewsletterAccepted = { ok: true; pending: true };

/** Optional injection only for transport substitution; production uses the IPv4 adapter. */
export const NEWSLETTER_FETCH = Symbol('NEWSLETTER_FETCH');
const BREVO_DOI_ENDPOINT = 'https://api.brevo.com/v3/contacts/doubleOptinConfirmation';
const UNAVAILABLE = 'L’inscription est momentanément indisponible. Réessayez dans un instant.';
const LIMITED = 'Trop de demandes ont été reçues. Réessayez plus tard.';

type NewsletterConfiguration = {
  apiKey: string;
  listId: number;
  templateId: number;
  redirectionUrl: string;
};

function positiveId(value: unknown): number | null {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!/^[1-9]\d*$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) ? id : null;
}

/**
 * Brevo owns the subscriber list, confirmation and campaign unsubscription.
 * A provider acknowledgement is a pending request, never proof of delivery or consent.
 */
@Injectable()
export class NewsletterService {
  constructor(
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(SharedPublicQuota) private readonly quota: SharedPublicQuota,
    @Optional() @Inject(NEWSLETTER_FETCH) private readonly transport: typeof fetch = fetchV4,
  ) {}

  private configuration(): NewsletterConfiguration {
    const apiKey = this.config.get<string>('BREVO_API_KEY')?.trim();
    const listId = positiveId(this.config.get('SM_NEWSLETTER_LIST_ID'));
    const templateId = positiveId(this.config.get('SM_NEWSLETTER_DOI_TEMPLATE_ID'));
    const redirect = this.config.get<string>('SM_NEWSLETTER_REDIRECT_URL')?.trim();
    if (!apiKey || !listId || !templateId || !redirect) throw new ServiceUnavailableException(UNAVAILABLE);
    let url: URL;
    try { url = new URL(redirect); }
    catch { throw new ServiceUnavailableException(UNAVAILABLE); }
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
      || url.pathname !== '/newsletter/confirmation') throw new ServiceUnavailableException(UNAVAILABLE);
    return { apiKey, listId, templateId, redirectionUrl: url.href };
  }

  async subscribe(body: NewsletterSubscribe): Promise<NewsletterAccepted> {
    const config = this.configuration();
    let globalAllowed: boolean;
    try {
      // No untrusted forwarded IP. Bound the entire authenticated public relay
      // before reserving an additional email dimension, as SharedPublicQuota requires.
      globalAllowed = await this.quota.reserve({
        scope: 'newsletter-requests', clientKey: 'site-vitrine',
        windowMs: 10 * 60_000, clientLimit: 30, globalLimit: 30,
      });
    } catch { throw new ServiceUnavailableException(UNAVAILABLE); }
    if (!globalAllowed) throw new HttpException(LIMITED, 429);

    let emailAllowed: boolean;
    try {
      emailAllowed = await this.quota.reserveClient({
        scope: 'newsletter-email', clientKey: createHash('sha256').update(body.email).digest('hex'),
        windowMs: 60 * 60_000, clientLimit: 3,
      });
    } catch { throw new ServiceUnavailableException(UNAVAILABLE); }
    if (!emailAllowed) throw new HttpException(LIMITED, 429);

    try {
      const response = await this.transport(BREVO_DOI_ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'api-key': config.apiKey },
        body: JSON.stringify({
          email: body.email,
          includeListIds: [config.listId],
          templateId: config.templateId,
          redirectionUrl: config.redirectionUrl,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      // 201 is the documented DOI response. Do not interpret arbitrary 2xx as
      // acknowledgement, create a CRM lead, or unblock an existing Brevo contact.
      if (response.status !== 201) throw new ServiceUnavailableException(UNAVAILABLE);
      return { ok: true, pending: true };
    } catch {
      // Provider bodies and exception messages can include addresses or credentials.
      throw new ServiceUnavailableException(UNAVAILABLE);
    }
  }
}
