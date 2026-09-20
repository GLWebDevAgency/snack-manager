import { fetchV4 } from '../http-v4';
import type { ContactEmail, ContactMailer, ContactMailResult } from './contact-mailer';

export class BrevoContactMailer implements ContactMailer {
  readonly enabled = true;
  readonly providerName = 'brevo';

  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly to: string,
    readonly crmUrl: string | null,
    private readonly transport: typeof fetch = fetchV4,
    private readonly subjectPrefix = '',
  ) {}

  async send(message: ContactEmail): Promise<ContactMailResult> {
    try {
      const response = await this.transport('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'api-key': this.apiKey },
        body: JSON.stringify({
          sender: { email: this.from, name: 'Snack Manager' },
          to: [{ email: this.to }],
          subject: `${this.subjectPrefix}${message.subject}`,
          textContent: message.text,
          htmlContent: message.html,
          ...(message.replyTo ? { replyTo: message.replyTo } : {}),
          // Brevo déduplique cette clé pendant 30 minutes. Le worker refuse
          // toute reprise automatique au-delà de 25 minutes après le premier
          // essai : une réponse perdue ne justifie pas un doublon tardif.
          // https://developers.brevo.com/docs/heterogenous-versions-batch-emails
          headers: { idempotencyKey: message.requestId },
          tags: ['site-contact'],
        }),
        signal: AbortSignal.timeout(10_000),
      });
      const body = await response.json().catch(() => null) as Record<string, unknown> | null;
      if (response.status === 201 && typeof body?.messageId === 'string'
        && body.messageId.trim().length > 0 && body.messageId.length <= 300
        && !/[\r\n]/.test(body.messageId)) {
        return { accepted: true, messageId: body.messageId };
      }
      if (response.status === 400 && body?.code === 'duplicate_parameter'
        && typeof body.message === 'string' && /idempotency/i.test(body.message)) {
        return { accepted: true, messageId: null };
      }
      if (response.status === 401 || response.status === 403) {
        return { accepted: false, retryable: false, code: 'provider_configuration' };
      }
      if (response.status === 429 || response.status >= 500) {
        return { accepted: false, retryable: true, code: 'provider_unavailable' };
      }
      return {
        accepted: false,
        retryable: response.ok,
        code: response.ok ? 'provider_response_invalid' : 'provider_rejected',
      };
    } catch {
      // Ni erreur brute, ni corps fournisseur : tous deux peuvent contenir
      // l'adresse, le message du prospect ou les identifiants du fournisseur.
      return { accepted: false, retryable: true, code: 'provider_unavailable' };
    }
  }
}
