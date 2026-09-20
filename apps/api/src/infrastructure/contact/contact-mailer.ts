export const CONTACT_MAILER = Symbol('CONTACT_MAILER');

export type ContactEmail = {
  requestId: string;
  subject: string;
  text: string;
  html: string;
  replyTo: { email: string; name: string } | null;
};

export type ContactMailResult =
  | { accepted: true; messageId: string | null }
  | {
      accepted: false;
      retryable: boolean;
      code: 'provider_unavailable' | 'provider_rejected' | 'provider_configuration' | 'provider_response_invalid';
    };

/** Accusé du fournisseur seulement : aucune promesse de livraison en boîte mail. */
export interface ContactMailer {
  readonly enabled: boolean;
  readonly providerName: string;
  readonly crmUrl: string | null;
  send(message: ContactEmail): Promise<ContactMailResult>;
}

export class DisabledContactMailer implements ContactMailer {
  readonly enabled = false;
  readonly providerName = 'unconfigured';
  readonly crmUrl = null;
  async send(): Promise<ContactMailResult> {
    return { accepted: false, retryable: false, code: 'provider_configuration' };
  }
}
