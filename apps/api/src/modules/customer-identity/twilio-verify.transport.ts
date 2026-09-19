import { z } from 'zod';
import { CUSTOMER_VERIFICATION_TIMING } from '@sm/contracts';
import { PhoneVerificationTransportError, type PhoneVerificationCheck,
  type PhoneVerificationStart, type PhoneVerificationTransport } from './phone-verification.port';

const sid = (prefix: string) => z.string().regex(new RegExp(`^${prefix}[0-9a-fA-F]{32}$`));
const configuration = z.strictObject({ accountSid: sid('AC'), apiKeySid: sid('SK'),
  apiKeySecret: z.string().regex(/^[\x21-\x7e]{1,256}$/) });
const startRequest = z.strictObject({ phone: z.string().regex(/^\+[1-9]\d{7,14}$/), serviceSid: sid('VA') });
const checkRequest = startRequest.extend({ verificationSid: sid('VE'), code: z.string().regex(/^\d{6}$/) });
const verification = z.object({ sid: sid('VE'), service_sid: sid('VA'), account_sid: sid('AC'),
  to: z.string(), channel: z.literal('sms'),
  date_created: z.unknown().optional(),
  status: z.enum(['pending', 'approved', 'canceled', 'max_attempts_reached', 'deleted', 'failed', 'expired']) });
const providerError = z.object({ code: z.number().int() });
const uncertain = () => new PhoneVerificationTransportError('uncertain');
const maxBodyBytes = 16 * 1024;

/** Provider dates have second precision. Reject permissive Date.parse coercions,
 * calendar normalization, non-GMT offsets and missing/fractional evidence. */
function providerDate(value: unknown, http = false): number | null {
  if (typeof value !== 'string') return null;
  const parsed = Date.parse(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed % 1000 !== 0) return null;
  const date = new Date(parsed);
  return date.toUTCString() === value || (!http &&
    (date.toISOString() === value || date.toISOString().replace('.000Z', 'Z') === value)) ? parsed : null;
}

/** Not registered in Nest: activating this transport requires durable challenge
 * authority and pre-reserved send budgets. A timeout must NEVER auto-retry. */
export class TwilioVerifyTransport implements PhoneVerificationTransport {
  private readonly config: z.infer<typeof configuration>;

  constructor(config: { accountSid: string; apiKeySid: string; apiKeySecret: string },
    private readonly fetcher: typeof fetch = fetch) {
    const parsed = configuration.safeParse(config);
    if (!parsed.success) throw new PhoneVerificationTransportError('configuration');
    this.config = parsed.data;
  }

  async start(input: PhoneVerificationStart) {
    const parsed = startRequest.safeParse(input);
    if (!parsed.success) throw new PhoneVerificationTransportError('invalid_request');
    const target = parsed.data;
    const result = await this.request(target.serviceSid, 'Verifications', {
      To: target.phone, Channel: 'sms', Locale: 'fr', RiskCheck: 'enable',
    });
    this.classifyError(result, false);
    if (result.status !== 201) throw uncertain();
    const record = this.correlate(result.value, target);
    // A cached response's Date could predate the durable local reservation.
    // It cannot establish the time anchor used for a fresh POST response.
    if (record.status !== 'pending' || result.age !== null) throw uncertain();
    const providerCreatedAt = providerDate(record.date_created);
    const providerObservedAt = providerDate(result.date, true);
    if (providerCreatedAt === null || providerObservedAt === null || providerCreatedAt > providerObservedAt) throw uncertain();
    return { verificationSid: record.sid, providerCreatedAt, providerObservedAt };
  }

  async check(input: PhoneVerificationCheck): Promise<'approved' | 'pending' | 'expired' | 'locked'> {
    const parsed = checkRequest.safeParse(input);
    if (!parsed.success) throw new PhoneVerificationTransportError('invalid_request');
    const target = parsed.data;
    const result = await this.request(target.serviceSid, 'VerificationCheck', {
      VerificationSid: target.verificationSid, Code: target.code,
    });
    const terminal = this.classifyError(result, true);
    if (terminal) return terminal;
    if (result.status !== 200) throw uncertain();
    const record = this.correlate(result.value, target);
    if (record.sid !== target.verificationSid) throw uncertain();
    switch (record.status) {
      case 'approved': case 'pending': return record.status;
      case 'max_attempts_reached': return 'locked';
      case 'expired': case 'canceled': case 'deleted': return 'expired';
      default: throw new PhoneVerificationTransportError('rejected');
    }
  }

  private correlate(value: unknown, target: PhoneVerificationStart) {
    const parsed = verification.safeParse(value);
    if (!parsed.success || parsed.data.account_sid !== this.config.accountSid
      || parsed.data.service_sid !== target.serviceSid || parsed.data.to !== target.phone) throw uncertain();
    return parsed.data;
  }

  private classifyError(result: { status: number; value: unknown }, checking: boolean): 'expired' | 'locked' | undefined {
    if (result.status >= 200 && result.status < 300) return;
    // Official Verify semantics: 60202=max CHECKS, 60203=max SENDS.
    // A 404 can also follow approval. Treat it only as non-checkable, never approved.
    if (checking && result.status === 404) return 'expired';
    if (result.status === 429) {
      const error = providerError.safeParse(result.value);
      if (checking && error.success && error.data.code === 60202) return 'locked';
      throw new PhoneVerificationTransportError('throttled');
    }
    if (result.status === 401 || result.status === 403) throw new PhoneVerificationTransportError('configuration');
    if (result.status === 408) throw uncertain();
    if (result.status >= 400 && result.status < 500) throw new PhoneVerificationTransportError('rejected');
    throw uncertain();
  }

  private async request(serviceSid: string, endpoint: 'Verifications' | 'VerificationCheck', form: Record<string, string>) {
    const controller = new AbortController();
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let completed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutMs = endpoint === 'Verifications' ? CUSTOMER_VERIFICATION_TIMING.start.providerMs
      : CUSTOMER_VERIFICATION_TIMING.check.providerMs;
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(uncertain()); }, timeoutMs);
    });
    const work = async () => {
      const response = await this.fetcher(`https://verify.twilio.com/v2/Services/${serviceSid}/${endpoint}`, {
        method: 'POST', redirect: 'error', cache: 'no-store', signal: controller.signal,
        headers: { Authorization: `Basic ${Buffer.from(`${this.config.apiKeySid}:${this.config.apiKeySecret}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json', 'Cache-Control': 'no-store' },
        body: new URLSearchParams(form).toString(),
      });
      if (controller.signal.aborted) {
        void response.body?.cancel().catch(() => {});
        throw uncertain();
      }
      reader = response.body?.getReader();
      if (Number(response.headers.get('Content-Length')) > maxBodyBytes) throw uncertain();
      if (!reader) { completed = true; return { status: response.status, value: null,
        date: response.headers.get('Date'), age: response.headers.get('Age') }; }
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) { completed = true; break; }
        size += chunk.value.byteLength;
        if (size > maxBodyBytes) throw uncertain();
        chunks.push(chunk.value);
      }
      const raw = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, size));
      let value: unknown = null;
      try { value = JSON.parse(raw); } catch { /* No provider body in errors. */ }
      return { status: response.status, value, date: response.headers.get('Date'), age: response.headers.get('Age') };
    };
    try { return await Promise.race([work(), deadline]); }
    catch { throw uncertain(); }
    finally {
      clearTimeout(timer);
      if (!completed) { controller.abort(); void reader?.cancel().catch(() => {}); }
    }
  }
}
