import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PhoneVerificationTransportError, type PhoneVerificationFailure } from './phone-verification.port';
import { TwilioVerifyTransport } from './twilio-verify.transport';

// Invented fixtures only. No credential, provider or network is used by this suite.
const config = { accountSid: `AC${'1'.repeat(32)}`, apiKeySid: `SK${'2'.repeat(32)}`, apiKeySecret: 'invented-provider-secret' };
const start = { phone: '+33601020304', serviceSid: `VA${'3'.repeat(32)}` };
const check = { ...start, verificationSid: `VE${'4'.repeat(32)}`, code: '028491' };
const response = { sid: check.verificationSid, service_sid: start.serviceSid,
  account_sid: config.accountSid, to: start.phone, channel: 'sms', status: 'pending' };
const markers = [config.apiKeySecret, config.apiKeySid, config.accountSid, start.phone, start.serviceSid,
  check.verificationSid, check.code, 'provider-raw-detail'];
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const setup = (value: Response = json(response, 201)) => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(value);
  return { fetcher, transport: new TwilioVerifyTransport(config, fetcher) };
};
async function refused(promise: Promise<unknown>, reason: PhoneVerificationFailure) {
  const error: unknown = await promise.catch(value => value);
  expect(error instanceof PhoneVerificationTransportError).toBe(true);
  if (!(error instanceof PhoneVerificationTransportError)) return;
  expect(error.reason).toBe(reason);
  expect('cause' in error).toBe(false);
  const serialized = JSON.stringify(error) + error.message + error.stack;
  expect(markers.some(marker => serialized.includes(marker))).toBe(false);
}

beforeEach(() => { vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Network forbidden'); })); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('Twilio Verify closed transport', () => {
  it('sends one SMS through the fixed endpoint, with explicit fraud protection and API-key Basic auth', async () => {
    const { transport, fetcher } = setup();
    expect(await transport.start(start)).toEqual({ verificationSid: check.verificationSid });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url === `https://verify.twilio.com/v2/Services/${start.serviceSid}/Verifications`).toBe(true);
    expect(init?.method).toBe('POST');
    expect(init?.redirect).toBe('error');
    expect(init?.signal instanceof AbortSignal).toBe(true);
    const headers = new Headers(init?.headers);
    expect(headers.get('Authorization') === `Basic ${Buffer.from(`${config.apiKeySid}:${config.apiKeySecret}`).toString('base64')}`).toBe(true);
    expect(headers.get('Content-Type')).toBe('application/x-www-form-urlencoded');
    const body = new URLSearchParams(String(init?.body));
    expect([...body.keys()].sort()).toEqual(['Channel', 'Locale', 'RiskCheck', 'To']);
    expect(body.get('To') === start.phone).toBe(true);
    expect(body.get('Channel')).toBe('sms');
    expect(body.get('Locale')).toBe('fr');
    expect(body.get('RiskCheck')).toBe('enable');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('checks the exact verification SID, never authorizes by To, and ignores deprecated valid', async () => {
    const { transport, fetcher } = setup(json({ ...response, valid: true }));
    expect(await transport.check(check)).toBe('pending');
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url === `https://verify.twilio.com/v2/Services/${start.serviceSid}/VerificationCheck`).toBe(true);
    const body = new URLSearchParams(String(init?.body));
    expect([...body.keys()].sort()).toEqual(['Code', 'VerificationSid']);
    expect(body.get('VerificationSid') === check.verificationSid && body.get('Code') === check.code).toBe(true);
    expect(body.has('To')).toBe(false);
  });

  it.each([
    ['approved', 'approved'], ['pending', 'pending'], ['expired', 'expired'],
    ['canceled', 'expired'], ['deleted', 'expired'], ['max_attempts_reached', 'locked'],
  ])('maps a fully correlated %s response to %s', async (status, expected) => {
    expect(await setup(json({ ...response, status, extra: 'ignored' })).transport.check(check)).toBe(expected);
  });

  it.each(['sid', 'service_sid', 'account_sid', 'to', 'channel', 'status'])('rejects missing or foreign response field %s even with approved/valid true', async field => {
    for (const value of [undefined, 'unrelated']) {
      await refused(setup(json({ ...response, status: 'approved', valid: true, [field]: value })).transport.check(check), 'uncertain');
    }
  });

  it.each([
    { sid: `VE${'9'.repeat(32)}` }, { service_sid: `VA${'9'.repeat(32)}` },
    { account_sid: `AC${'9'.repeat(32)}` }, { to: '+33611121314' }, { channel: 'call' },
  ])('rejects well-formed but foreign success correlation', async patch => {
    await refused(setup(json({ ...response, ...patch, status: 'approved' })).transport.check(check), 'uncertain');
  });

  it('accepts no successful start without a complete pending SMS response', async () => {
    for (const patch of [{ status: 'approved' }, { channel: 'call' }, { to: '+33611121314' }, { sid: undefined }]) {
      await refused(setup(json({ ...response, ...patch }, 201)).transport.start(start), 'uncertain');
    }
    await refused(setup(json(response, 200)).transport.start(start), 'uncertain');
    await refused(setup(json({ ...response, status: 'failed' })).transport.check(check), 'rejected');
  });

  it('rejects configuration and input errors before any provider request', async () => {
    const fetcher = vi.fn<typeof fetch>();
    for (const patch of [{ accountSid: 'invalid' }, { apiKeySid: 'invalid' }, { apiKeySecret: '' }, { apiKeySecret: 'secret\r\nheader' }]) {
      expect(() => new TwilioVerifyTransport({ ...config, ...patch }, fetcher)).toThrow(PhoneVerificationTransportError);
    }
    const transport = new TwilioVerifyTransport(config, fetcher);
    for (const patch of [{ phone: '0601020304' }, { phone: '+033601020304' }, { serviceSid: '../elsewhere' }, { Channel: 'call' }]) {
      await refused(transport.start({ ...start, ...patch }), 'invalid_request');
    }
    for (const patch of [{ code: '12345' }, { code: '1234567' }, { code: '12 456' }, { verificationSid: '../elsewhere' }, { To: '+33611121314' }]) {
      await refused(transport.check({ ...check, ...patch }), 'invalid_request');
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    ['check', 429, 60202, 'locked'], ['start', 429, 60203, 'throttled'],
    ['start', 429, 60202, 'throttled'], ['check', 429, 60203, 'throttled'],
    ['check', 404, 20404, 'expired'], ['start', 404, 20404, 'rejected'],
    ['start', 401, 20003, 'configuration'], ['check', 403, 20003, 'configuration'],
    ['check', 500, 60202, 'uncertain'], ['start', 503, 60203, 'uncertain'],
    ['start', 408, 20408, 'uncertain'], ['check', 408, 20408, 'uncertain'],
  ] as const)('classifies %s HTTP %s code %s without disclosing provider content', async (operation, status, code, outcome) => {
    const { transport, fetcher } = setup(json({ code, status, message: markers.join('|') }, status));
    const promise = operation === 'start' ? transport.start(start) : transport.check(check);
    if (outcome === 'locked' || outcome === 'expired') expect(await promise).toBe(outcome);
    else await refused(promise, outcome);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('never reconstitutes approval from a 404, including an ambiguous already-approved provider record', async () => {
    expect(await setup(json({ ...response, status: 'approved' }, 404)).transport.check(check)).toBe('expired');
    expect(await setup(new Response('gone', { status: 404 })).transport.check(check)).toBe('expired');
    expect(await setup(new Response(null, { status: 404 })).transport.check(check)).toBe('expired');
  });

  it('does not follow redirects, retry, or expose a network exception', async () => {
    const { transport, fetcher } = setup(new Response(null, { status: 302, headers: { Location: 'https://elsewhere.invalid/' } }));
    await refused(transport.check(check), 'uncertain');
    expect(fetcher).toHaveBeenCalledTimes(1);
    fetcher.mockRejectedValueOnce(new Error(markers.join('|')));
    await refused(transport.start(start), 'uncertain');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it.each(['not JSON', 'null', '[]', '{"status":"approved"}', '"approved"'])('fails closed on malformed/incomplete provider bodies', async raw => {
    await refused(setup(new Response(raw)).transport.check(check), 'uncertain');
  });

  it('bounds actual streamed bytes rather than trusting Content-Length', async () => {
    const raw = JSON.stringify({ ...response, status: 'approved' });
    expect(await setup(new Response(raw.padEnd(16 * 1024))).transport.check(check)).toBe('approved');
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode(raw)); controller.enqueue(new Uint8Array(16 * 1024)); },
      cancel,
    });
    await refused(setup(new Response(stream, { headers: { 'Content-Length': '1' } })).transport.check(check), 'uncertain');
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('rejects oversized announced bodies, partial stream errors, and invalid UTF-8', async () => {
    await refused(setup(new Response('{}', { headers: { 'Content-Length': '16385' } })).transport.check(check), 'uncertain');
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.error(new Error(markers.join('|'))); } });
    await refused(setup(new Response(stream)).transport.check(check), 'uncertain');
    await refused(setup(new Response(new Uint8Array([0xff, 0xfe]))).transport.check(check), 'uncertain');
  });

  it.each(['headers', 'body'])('enforces the total five-second deadline while awaiting %s, even if the injected fetch ignores abort', async stage => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => stage === 'headers'
      ? new Promise<Response>(() => {}) : new Response(new ReadableStream<Uint8Array>({ cancel })));
    const promise = new TwilioVerifyTransport(config, fetcher).check(check);
    const assertion = refused(promise, 'uncertain');
    let settled = false;
    void promise.then(() => { settled = true; }, () => { settled = true; });
    await vi.advanceTimersByTimeAsync(4999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await assertion;
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    if (stage === 'body') expect(cancel).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps the original five-second deadline when headers arrive after four seconds and the body remains pending', async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    let body: ReadableStream<Uint8Array> | undefined;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(() => new Promise(resolve => {
      setTimeout(() => {
        body = new ReadableStream<Uint8Array>({ cancel });
        resolve(new Response(body));
      }, 4000);
    }));
    const promise = new TwilioVerifyTransport(config, fetcher).check(check);
    const assertion = refused(promise, 'uncertain');
    let settled = false;
    void promise.then(() => { settled = true; }, () => { settled = true; });
    await vi.advanceTimersByTimeAsync(4000);
    expect(body?.locked).toBe(true);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(999);
    expect(settled).toBe(false);
    expect(cancel).not.toHaveBeenCalled();
    expect(fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await assertion;
    expect(settled).toBe(true);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('remains uncertain and cancels an approved response arriving after the deadline instead of consuming or retrying it', async () => {
    vi.useFakeTimers();
    let finish!: (response: Response) => void;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const promise = new TwilioVerifyTransport(config, fetcher).check(check);
    const assertion = refused(promise, 'uncertain');
    const approved = vi.fn();
    void promise.then(approved, () => {});
    await vi.advanceTimersByTimeAsync(5000);
    await assertion;
    expect(fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    const cancel = vi.fn();
    const late = new Response(new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode(JSON.stringify({ ...response, status: 'approved' }))); },
      cancel,
    }));
    const getReader = vi.spyOn(late.body!, 'getReader');
    finish(late);
    await vi.advanceTimersByTimeAsync(0);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(getReader).not.toHaveBeenCalled();
    expect(approved).not.toHaveBeenCalled();
    await refused(promise, 'uncertain');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('snapshots validated input and configuration rather than accepting a mutation during the request', async () => {
    const mutableConfig = { ...config };
    const mutableInput = { ...check };
    let finish!: (response: Response) => void;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const transport = new TwilioVerifyTransport(mutableConfig, fetcher);
    const pending = transport.check(mutableInput);
    void pending.catch(() => {});
    mutableConfig.accountSid = `AC${'9'.repeat(32)}`;
    mutableInput.phone = '+33611121314';
    finish(json({ ...response, status: 'approved' }));
    expect(await pending).toBe('approved');
  });
});
