import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchV4 } from '../http-v4';
import { createContactMailer } from './contact-mailer.factory';
import { DisabledContactMailer } from './contact-mailer';

vi.mock('../http-v4', () => ({ fetchV4: vi.fn() }));

const complete: Record<string, string> = {
  SM_CONTACT_EMAIL_PROVIDER: 'brevo',
  BREVO_API_KEY: 'test-provider-key',
  SM_CONTACT_EMAIL_FROM: 'notifications@example.com',
  SM_CONTACT_EMAIL_TO: 'contact@example.com',
  SM_CONTACT_CRM_URL: 'https://snackmanager.example/sm',
};
const env = (values: Record<string, string>) => (key: string) => values[key];

afterEach(() => vi.clearAllMocks());

describe('createContactMailer — configuration commerciale explicite', () => {
  it('reste désactivé sans configuration', async () => {
    const mailer = createContactMailer(() => undefined);
    expect(mailer).toBeInstanceOf(DisabledContactMailer);
    expect(mailer.enabled).toBe(false);
    expect(mailer.crmUrl).toBeNull();
    await expect(mailer.send({
      requestId: 'unused', subject: 'unused', text: 'unused', html: 'unused', replyTo: null,
    })).resolves.toEqual({ accepted: false, retryable: false, code: 'provider_configuration' });
    expect(fetchV4).not.toHaveBeenCalled();
  });

  it.each(['SM_CONTACT_EMAIL_PROVIDER', 'BREVO_API_KEY', 'SM_CONTACT_EMAIL_FROM', 'SM_CONTACT_EMAIL_TO'])(
    'ne s’active pas si %s manque, même avec toutes les variables ops', (missing) => {
      const values = { ...complete, [missing]: ' ',
        SM_ALERT_EMAIL_FROM: 'ops-sender@example.com', SM_ALERT_EMAIL_TO: 'ops@example.com',
        SM_ALERT_WEBHOOK: 'https://ops.example.com/alerts',
      };
      expect(createContactMailer(env(values)).enabled).toBe(false);
      expect(fetchV4).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['SM_CONTACT_EMAIL_PROVIDER', 'smtp'],
    ['SM_CONTACT_EMAIL_PROVIDER', 'BREVO'],
    ['SM_CONTACT_EMAIL_FROM', 'not-an-address'],
    ['SM_CONTACT_EMAIL_FROM', 'Sender <sender@example.com>'],
    ['SM_CONTACT_EMAIL_TO', 'first@example.com,second@example.com'],
    ['SM_CONTACT_EMAIL_TO', 'person@example.com\r\nBcc: other@example.com'],
  ])('désactive une valeur invalide de %s', (key, value) => {
    expect(createContactMailer(env({ ...complete, [key]: value })).enabled).toBe(false);
  });

  it('normalise la configuration et envoie seulement aux adresses commerciales dédiées', async () => {
    vi.mocked(fetchV4).mockResolvedValue(Response.json({ messageId: '<contact@example.com>' }, { status: 201 }));
    const values = Object.fromEntries(Object.entries(complete).map(([key, value]) => [key, `  ${value}  `]));
    const mailer = createContactMailer(env({ ...values,
      SM_ALERT_EMAIL_FROM: 'ops-sender@example.com', SM_ALERT_EMAIL_TO: 'ops@example.com',
    }));
    expect(mailer.enabled).toBe(true);
    expect(mailer.providerName).toBe('brevo');
    expect(mailer.crmUrl).toBe('https://snackmanager.example/sm');
    await mailer.send({ requestId: 'request-1', subject: 'subject', text: 'text', html: '<p>text</p>', replyTo: null });
    const init = vi.mocked(fetchV4).mock.calls[0]![1];
    expect(init?.headers).toMatchObject({ 'api-key': 'test-provider-key' });
    expect(JSON.parse(String(init?.body))).toMatchObject({
      sender: { email: 'notifications@example.com' }, to: [{ email: 'contact@example.com' }],
    });
    expect(String(init?.body)).not.toContain('ops@example.com');
    expect(String(init?.body)).not.toContain('ops-sender@example.com');
  });

  it.each([
    '', 'not-a-url', 'http://snackmanager.example/sm', 'javascript:alert(1)',
    'https://user:password@snackmanager.example/sm',
    'https://snackmanager.example/sm?token=private', 'https://snackmanager.example/sm#private',
  ])('omet le lien CRM invalide sans désactiver le canal : %s', (url) => {
    const mailer = createContactMailer(env({ ...complete, SM_CONTACT_CRM_URL: url }));
    expect(mailer.enabled).toBe(true);
    expect(mailer.crmUrl).toBeNull();
  });

  it.each([
    [{ RAILWAY_ENVIRONMENT_NAME: 'staging', SM_ENV: 'production' }, '[STAGING] Demande'],
    [{ SM_ENV: 'staging' }, '[STAGING] Demande'],
    [{ RAILWAY_ENVIRONMENT_NAME: 'production', SM_ENV: 'staging' }, 'Demande'],
  ])('distingue les essais staging dans l’objet avec priorité à Railway', async (environment, subject) => {
    vi.mocked(fetchV4).mockResolvedValue(Response.json({ messageId: '<test>' }, { status: 201 }));
    const mailer = createContactMailer(env({ ...complete, ...environment }));
    await mailer.send({ requestId: '75bb97eb-6d77-4090-9515-53b9a063fa35',
      subject: 'Demande', text: 'Texte', html: '<p>Texte</p>', replyTo: null });
    expect(JSON.parse(String(vi.mocked(fetchV4).mock.calls[0]![1]?.body)).subject).toBe(subject);
  });
});
