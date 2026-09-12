import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TwilioProductionObserver, twilioVerifySettingsFingerprint } from './twilio-production-observer';

// Synthetic credentials and responses only: every outbound call is injected.
const input = { accountSid: `AC${'1'.repeat(32)}`, serviceSid: `VA${'2'.repeat(32)}`, tenantRef: 'a'.repeat(24),
  apiKeySid: `SK${'3'.repeat(32)}`, apiKeySecret: 'invented-observation-secret' };
const account = { sid: input.accountSid, type: 'Full', status: 'active', auth_token: 'must-not-be-retained' };
const settings = { friendly_name: 'Fixture Comptoir', code_length: 6, custom_code_enabled: false, lookup_enabled: false,
  psd2_enabled: false, do_not_share_warning_enabled: true, default_template_sid: null };
const service = { ...settings, sid: input.serviceSid, account_sid: input.accountSid };
const accountUrl = `https://api.twilio.com/2010-04-01/Accounts/${input.accountSid}.json`;
const serviceUrl = `https://verify.twilio.com/v2/Services/${input.serviceSid}`;
const NOW = 1_800_000_000_000, TTL = 300_000;
const json = (value: unknown) => Response.json(value);
function setup() {
  let now = NOW;
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async url => json(String(url).startsWith('https://api.twilio.com/') ? account : service));
  const observer = new TwilioProductionObserver(fetcher, () => now);
  return { fetcher, observer, at: (value: number) => { now = value; } };
}
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('Twilio production observer — isolated read-only transport', () => {
  it('reads only the exact account and service, projects facts without provider secrets or spending claims', async () => {
    const { observer, fetcher, at } = setup();
    fetcher.mockImplementationOnce(async () => json(account)).mockImplementationOnce(async () => { at(NOW + 321); return json(service); });
    const result = await observer.observe(input);
    expect(result).toEqual({ reference: expect.stringMatching(/^twilio_[a-f0-9-]+$/), accountSid: input.accountSid,
      serviceSid: input.serviceSid, tenantRef: input.tenantRef, accountType: 'Full', accountStatus: 'active',
      codeLength: 6, observedAt: NOW + 321, settingsFingerprint: twilioVerifySettingsFingerprint(settings) });
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([accountUrl, serviceUrl]);
    for (const [, init] of fetcher.mock.calls) {
      expect(init).toMatchObject({ method: 'GET', redirect: 'error', cache: 'no-store' });
      expect(init?.body).toBeUndefined();
      const headers: Record<string, string> = {}; new Headers(init?.headers).forEach((value, name) => { headers[name] = value; });
      expect(headers).toEqual({ accept: 'application/json',
        authorization: `Basic ${Buffer.from(`${input.apiKeySid}:${input.apiKeySecret}`).toString('base64')}` });
    }
    expect(JSON.stringify(result)).not.toContain(input.apiKeySecret);
    expect(JSON.stringify(result)).not.toContain(account.auth_token);
    expect(result).not.toHaveProperty('smsEnabled'); expect(result).not.toHaveProperty('fraudGuardEnabled');
  });
  it('fingerprints only the seven ordered settings, independent of upstream field order or irrelevant fields', () => {
    const canonical = '{"friendly_name":"Fixture Comptoir","code_length":6,"custom_code_enabled":false,"lookup_enabled":false,"psd2_enabled":false,"do_not_share_warning_enabled":true,"default_template_sid":null}';
    const expected = createHash('sha256').update(canonical).digest('hex');
    expect(twilioVerifySettingsFingerprint(settings)).toBe(expected);
    expect(twilioVerifySettingsFingerprint({ extra: 'ignored', ...Object.fromEntries(Object.entries(service).reverse()) })).toBe(expected);
    for (const patch of [{ friendly_name: 'Fixture Elsewhere' }, { code_length: 7 }, { custom_code_enabled: true },
      { lookup_enabled: true }, { psd2_enabled: true }, { do_not_share_warning_enabled: false }, { default_template_sid: `HJ${'4'.repeat(32)}` }]) {
      expect(twilioVerifySettingsFingerprint({ ...settings, ...patch })).not.toBe(expected);
    }
    for (const field of Object.keys(settings)) {
      const incomplete: Record<string, unknown> = { ...settings }; delete incomplete[field];
      expect(twilioVerifySettingsFingerprint(incomplete)).toBeNull();
    }
  });
  it.each([
    { accountSid: '../elsewhere' }, { serviceSid: '../elsewhere' }, { tenantRef: 'other' },
    { apiKeySid: input.accountSid }, { apiKeySecret: '' }, { apiKeySecret: 'secret\r\nheader' }, { unexpected: true },
  ])('rejects invalid input before any request (%#)', async patch => {
    const { observer, fetcher } = setup(); expect(await observer.observe({ ...input, ...patch })).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([{ sid: `AC${'9'.repeat(32)}` }, { sid: undefined }, { type: 'Trial' }, { type: 'full' },
    { status: 'suspended' }, { status: 'closed' }, { status: undefined }])('stops before the service for an invalid account (%#)', async patch => {
    const { observer, fetcher } = setup(); fetcher.mockResolvedValueOnce(json({ ...account, ...patch }));
    expect(await observer.observe(input)).toBeNull(); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([{ sid: `VA${'9'.repeat(32)}` }, { account_sid: `AC${'9'.repeat(32)}` }, { code_length: 4 }, { code_length: '6' },
    { custom_code_enabled: true }, { custom_code_enabled: undefined }, { lookup_enabled: undefined },
    { psd2_enabled: undefined }, { do_not_share_warning_enabled: undefined }, { default_template_sid: undefined },
    { default_template_sid: '' }, { friendly_name: '' }])('requires correlated explicit service facts (%#)', async patch => {
    const { observer, fetcher } = setup();
    fetcher.mockResolvedValueOnce(json(account)).mockResolvedValueOnce(json({ ...service, ...patch }));
    expect(await observer.observe(input)).toBeNull(); expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it.each([301, 302, 307, 308, 401, 403, 404, 429, 500, 503])('does not follow, retry or disclose HTTP %i', async status => {
    const { observer, fetcher } = setup(); const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    fetcher.mockResolvedValueOnce(new Response(account.auth_token, { status, headers: { Location: 'http://127.0.0.1/', 'content-type': 'application/json' } }));
    expect(await observer.observe(input)).toBeNull(); expect(fetcher).toHaveBeenCalledTimes(1); expect(log).not.toHaveBeenCalled();
  });
  it.each(['application/javascript', 'text/html', '', 'application/json; charset=iso-8859-1'])('refuses content type %j', async type => {
    const { observer, fetcher } = setup(); fetcher.mockResolvedValueOnce(new Response(JSON.stringify(account), { headers: { 'content-type': type } }));
    expect(await observer.observe(input)).toBeNull(); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each(['not-json', 'null', '[]', '"Full"'])('refuses malformed or structurally invalid JSON %j', async body => {
    const { observer, fetcher } = setup(); fetcher.mockResolvedValueOnce(new Response(body, { headers: { 'content-type': 'application/json' } }));
    expect(await observer.observe(input)).toBeNull();
  });
  it('bounds streamed bytes independently of Content-Length and cancels an oversized response', async () => {
    const { observer, fetcher } = setup(), cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode(JSON.stringify(account))); c.enqueue(new Uint8Array(16_384)); }, cancel });
    fetcher.mockResolvedValueOnce(new Response(stream, { headers: { 'content-type': 'application/json', 'content-length': '1' } }));
    expect(await observer.observe(input)).toBeNull(); expect(cancel).toHaveBeenCalledTimes(1); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each(['16385', '-1', 'NaN'])('refuses announced body length %s without reading it', async length => {
    const { observer, fetcher } = setup(), cancel = vi.fn();
    fetcher.mockResolvedValueOnce(new Response(new ReadableStream({ cancel }), { headers: { 'content-type': 'application/json', 'content-length': length } }));
    expect(await observer.observe(input)).toBeNull(); expect(cancel).toHaveBeenCalledTimes(1);
  });
  it('refuses malformed UTF-8 and interrupted streams without exposing the exception', async () => {
    const { observer, fetcher } = setup();
    fetcher.mockResolvedValueOnce(new Response(new Uint8Array([0xff, 0xfe]), { headers: { 'content-type': 'application/json' } }));
    expect(await observer.observe(input)).toBeNull();
    fetcher.mockResolvedValueOnce(new Response(new ReadableStream({ start(c) { c.error(new Error(input.apiKeySecret)); } }), { headers: { 'content-type': 'application/json' } }));
    expect(await observer.observe(input)).toBeNull();
    fetcher.mockRejectedValueOnce(new Error(input.apiKeySecret)); expect(await observer.observe(input)).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it.each(['headers', 'account-body', 'service-body'] as const)('bounds the entire pair of reads to five seconds during %s', async stage => {
    vi.useFakeTimers(); const { observer, fetcher } = setup(), cancel = vi.fn();
    const silent = () => new Response(new ReadableStream({ cancel }), { headers: { 'content-type': 'application/json' } });
    if (stage === 'headers') fetcher.mockImplementationOnce(() => new Promise(() => {}));
    else if (stage === 'account-body') fetcher.mockResolvedValueOnce(silent());
    else fetcher.mockImplementationOnce(async () => { await new Promise(resolve => setTimeout(resolve, 3000)); return json(account); }).mockResolvedValueOnce(silent());
    let settled = false; const result = observer.observe(input).then(value => { settled = true; return value; });
    await vi.advanceTimersByTimeAsync(4999); expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1); expect(await result).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(stage === 'service-body' ? 2 : 1);
    expect(fetcher.mock.calls[0]![1]!.signal?.aborted).toBe(true);
    if (stage !== 'headers') expect(cancel).toHaveBeenCalledTimes(1);
  });
  it('discards a late response after timeout and never issues its second GET or caches it', async () => {
    vi.useFakeTimers(); const { observer, fetcher } = setup(); let release!: (value: Response) => void;
    fetcher.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const pending = observer.observe(input); await vi.advanceTimersByTimeAsync(5000); expect(await pending).toBeNull();
    const cancel = vi.fn(); release(new Response(new ReadableStream({ cancel }), { headers: { 'content-type': 'application/json' } }));
    await vi.advanceTimersByTimeAsync(0); expect(cancel).toHaveBeenCalledTimes(1); expect(fetcher).toHaveBeenCalledTimes(1);
    expect(await observer.observe(input)).not.toBeNull(); expect(fetcher).toHaveBeenCalledTimes(3);
  });
});

describe('Twilio production observer — bounded evidence cache', () => {
  it('coalesces a target in flight and returns independent copies without changing observation time', async () => {
    const { observer, fetcher, at } = setup(); let release!: (value: Response) => void;
    fetcher.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const a = observer.observe(input), b = observer.observe({ ...input });
    expect(fetcher).toHaveBeenCalledTimes(1); at(NOW + 100); release(json(account));
    const [first, second] = await Promise.all([a, b]); expect(first).toEqual(second); expect(first).not.toBe(second);
    expect(first?.observedAt).toBe(NOW + 100); first!.accountSid = 'mutated';
    at(NOW + 1000); const cached = await observer.observe(input);
    expect(cached).toEqual(second); expect(cached).not.toBe(second); expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('expires at exactly five minutes and never revives the former success after a failed refresh', async () => {
    const { observer, fetcher, at } = setup(); const initial = await observer.observe(input);
    at(NOW + TTL - 1); expect(await observer.observe(input)).toEqual(initial); expect(fetcher).toHaveBeenCalledTimes(2);
    at(NOW + TTL); fetcher.mockResolvedValueOnce(new Response(null, { status: 401 }));
    expect(await observer.observe(input)).toBeNull(); expect(fetcher).toHaveBeenCalledTimes(3);
    // Even a clock rollback cannot bring that deleted successful entry back.
    at(NOW + TTL - 1); fetcher.mockResolvedValueOnce(new Response(null, { status: 503 }));
    expect(await observer.observe(input)).toBeNull(); expect(fetcher).toHaveBeenCalledTimes(4);
    const refreshed = await observer.observe(input); expect(refreshed?.reference).not.toBe(initial?.reference);
    expect(refreshed?.observedAt).toBe(NOW + TTL - 1); expect(fetcher).toHaveBeenCalledTimes(6);
  });
  it.each(['tenantRef', 'apiKeySid', 'apiKeySecret'] as const)('never shares cached facts across %s changes', async field => {
    const { observer, fetcher } = setup(); await observer.observe(input);
    const value = field === 'tenantRef' ? 'b'.repeat(24) : field === 'apiKeySid' ? `SK${'4'.repeat(32)}` : 'replacement-credential';
    expect(await observer.observe({ ...input, [field]: value })).not.toBeNull(); expect(fetcher).toHaveBeenCalledTimes(4);
  });
  it.each(['accountSid', 'serviceSid'] as const)('does not accept a former cached success for a changed %s', async field => {
    const { observer, fetcher } = setup(); await observer.observe(input);
    expect(await observer.observe({ ...input, [field]: `${field === 'accountSid' ? 'AC' : 'VA'}${'4'.repeat(32)}` })).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(field === 'accountSid' ? 3 : 4);
  });
  it('evicts the oldest completed target after 32 entries', async () => {
    const { observer, fetcher } = setup();
    for (let i = 0; i < 33; i++) expect(await observer.observe({ ...input, tenantRef: i.toString(16).padStart(24, '0') })).not.toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(66);
    await observer.observe({ ...input, tenantRef: '1'.padStart(24, '0') }); expect(fetcher).toHaveBeenCalledTimes(66);
    await observer.observe({ ...input, tenantRef: '0'.repeat(24) }); expect(fetcher).toHaveBeenCalledTimes(68);
  });
  it('also caps in-flight targets, keeps coalescence and frees failed entries', async () => {
    vi.useFakeTimers(); const { observer, fetcher } = setup(); fetcher.mockImplementation(() => new Promise(() => {}));
    const targets = Array.from({ length: 32 }, (_, i) => ({ ...input, tenantRef: i.toString(16).padStart(24, '0') }));
    const pending = targets.map(target => observer.observe(target));
    const duplicate = observer.observe(targets[0]!); expect(fetcher).toHaveBeenCalledTimes(32);
    expect(await observer.observe(input)).toBeNull(); expect(fetcher).toHaveBeenCalledTimes(32);
    await vi.advanceTimersByTimeAsync(5000); expect(await Promise.all([...pending, duplicate])).toEqual(Array(33).fill(null));
    fetcher.mockImplementation(async url => json(String(url).startsWith('https://api.twilio.com/') ? account : service));
    expect(await observer.observe(input)).not.toBeNull(); expect(fetcher).toHaveBeenCalledTimes(34);
  });
});
