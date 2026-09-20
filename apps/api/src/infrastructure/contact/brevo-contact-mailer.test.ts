import { afterEach, describe, expect, it, vi } from 'vitest';
import { BrevoContactMailer } from './brevo-contact-mailer';
import type { ContactEmail } from './contact-mailer';

vi.mock('../http-v4', () => ({ fetchV4: vi.fn() }));

const message: ContactEmail = {
  requestId: '75bb97eb-6d77-4090-9515-53b9a063fa35',
  subject: 'Snack Manager — nouvelle demande : Refaire mon menu papier',
  text: 'Contact privé : prospect@example.com, 06 00 00 00 00',
  html: '<p>Contact privé : prospect@example.com</p>',
  replyTo: { email: 'prospect@example.com', name: 'Camille' },
};

function setup(response: Response = Response.json({ messageId: '<message-1@example.com>' }, { status: 201 })) {
  const transport = vi.fn<typeof fetch>().mockResolvedValue(response);
  const mailer = new BrevoContactMailer(
    'test-provider-key', 'notifications@example.com', 'contact@example.com',
    'https://snackmanager.example/sm', transport,
  );
  return { mailer, transport };
}

afterEach(() => vi.restoreAllMocks());

describe('BrevoContactMailer — accusé transactionnel', () => {
  it('envoie au destinataire configuré avec clé de déduplication stable et Reply-To du prospect', async () => {
    const { mailer, transport } = setup();
    const timeout = vi.spyOn(AbortSignal, 'timeout');

    await expect(mailer.send(message)).resolves.toEqual({
      accepted: true, messageId: '<message-1@example.com>',
    });
    expect(transport).toHaveBeenCalledOnce();
    const [url, init] = transport.mock.calls[0]!;
    expect(url).toBe('https://api.brevo.com/v3/smtp/email');
    expect(init).toMatchObject({
      method: 'POST', headers: { 'content-type': 'application/json', 'api-key': 'test-provider-key' },
    });
    expect(timeout).toHaveBeenCalledWith(10_000);
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(String(init?.body))).toEqual({
      sender: { email: 'notifications@example.com', name: 'Snack Manager' },
      to: [{ email: 'contact@example.com' }],
      subject: message.subject,
      textContent: message.text,
      htmlContent: message.html,
      replyTo: message.replyTo,
      headers: { idempotencyKey: message.requestId },
      tags: ['site-contact'],
    });
  });

  it('omet Reply-To si le prospect n’a pas renseigné son adresse', async () => {
    const { mailer, transport } = setup();
    await mailer.send({ ...message, replyTo: null });
    expect(JSON.parse(String(transport.mock.calls[0]![1]?.body))).not.toHaveProperty('replyTo');
  });

  it.each([
    [200, { messageId: '<message-1@example.com>' }],
    [202, { messageId: '<message-1@example.com>' }],
    [201, {}],
    [201, { messageId: null }],
    [201, { messageId: 123 }],
    [201, { messageId: '' }],
    [201, { messageId: '   ' }],
    [201, { messageId: 'x'.repeat(301) }],
    [201, { messageId: 'message\r\nInjected: header' }],
  ])('refuse l’accusé incomplet ou inattendu HTTP %s / %j', async (status, body) => {
    const { mailer } = setup(Response.json(body, { status }));
    await expect(mailer.send(message)).resolves.toEqual({
      accepted: false, retryable: true, code: 'provider_response_invalid',
    });
  });

  it('refuse une réponse 201 non JSON', async () => {
    const { mailer } = setup(new Response('provider response unavailable', { status: 201 }));
    await expect(mailer.send(message)).resolves.toEqual({
      accepted: false, retryable: true, code: 'provider_response_invalid',
    });
  });

  it.each([429, 500, 503])('permet un nouvel essai après HTTP %s', async (status) => {
    const { mailer } = setup(Response.json({ message: 'private provider detail' }, { status }));
    await expect(mailer.send(message)).resolves.toEqual({
      accepted: false, retryable: true, code: 'provider_unavailable',
    });
  });

  it.each([401, 403])('arrête les essais après refus de configuration HTTP %s', async (status) => {
    const { mailer } = setup(Response.json({ message: 'private credential detail' }, { status }));
    await expect(mailer.send(message)).resolves.toEqual({
      accepted: false, retryable: false, code: 'provider_configuration',
    });
  });

  it('accepte uniquement le doublon attesté pour la clé d’idempotence', async () => {
    const { mailer } = setup(Response.json({
      code: 'duplicate_parameter', message: 'Email for the idempotency token has already been processed',
    }, { status: 400 }));
    await expect(mailer.send(message)).resolves.toEqual({ accepted: true, messageId: null });
  });

  it.each([
    [400, { code: 'duplicate_parameter', message: 'Duplicate recipient' }],
    [400, { code: 'invalid_parameter', message: 'Invalid idempotency token' }],
    [400, { code: 'duplicate_parameter' }],
    [409, { code: 'duplicate_parameter', message: 'Idempotency token already used' }],
  ])('ne confond pas les autres refus HTTP %s avec un email déjà accepté', async (status, body) => {
    const { mailer } = setup(Response.json(body, { status }));
    await expect(mailer.send(message)).resolves.toEqual({
      accepted: false, retryable: false, code: 'provider_rejected',
    });
  });

  it.each([
    new DOMException('private timeout for prospect@example.com', 'TimeoutError'),
    new Error('private network error with test-provider-key'),
  ])('ne divulgue ni données personnelles ni erreurs brutes lors d’un échec de transport', async (error) => {
    const logs = ['log', 'info', 'warn', 'error'].map((method) =>
      vi.spyOn(console, method as 'log' | 'info' | 'warn' | 'error').mockImplementation(() => {}));
    const { mailer, transport } = setup();
    transport.mockRejectedValue(error);

    await expect(mailer.send(message)).resolves.toEqual({
      accepted: false, retryable: true, code: 'provider_unavailable',
    });
    for (const log of logs) expect(log).not.toHaveBeenCalled();
  });
});
