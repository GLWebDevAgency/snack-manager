import { z } from 'zod';
import type { ConfigSource } from '../config-source';
import { readNonEmpty } from '../config-source';
import { BrevoContactMailer } from './brevo-contact-mailer';
import { DisabledContactMailer, type ContactMailer } from './contact-mailer';

/** Canal commercial dédié ; aucun repli sur les destinataires des alertes ops. */
export function createContactMailer(get: ConfigSource): ContactMailer {
  const provider = readNonEmpty(get, 'SM_CONTACT_EMAIL_PROVIDER');
  const key = readNonEmpty(get, 'BREVO_API_KEY');
  const from = readNonEmpty(get, 'SM_CONTACT_EMAIL_FROM');
  const to = readNonEmpty(get, 'SM_CONTACT_EMAIL_TO');
  if (provider !== 'brevo' || !key || !from || !to
    || !z.email().safeParse(from).success || !z.email().safeParse(to).success) {
    return new DisabledContactMailer();
  }
  let crmUrl: string | null = null;
  const rawUrl = readNonEmpty(get, 'SM_CONTACT_CRM_URL');
  if (rawUrl) {
    try {
      const url = new URL(rawUrl);
      if (url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash) {
        crmUrl = url.href;
      }
    } catch { /* Le lien CRM est facultatif ; une URL invalide n'est jamais rendue. */ }
  }
  const environment = (readNonEmpty(get, 'RAILWAY_ENVIRONMENT_NAME')
    ?? readNonEmpty(get, 'SM_ENV') ?? 'production').toLowerCase();
  const subjectPrefix = environment === 'staging' ? '[STAGING] ' : '';
  return new BrevoContactMailer(key, from, to, crmUrl, undefined, subjectPrefix);
}
