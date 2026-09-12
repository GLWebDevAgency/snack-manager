import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ProductionServerObservationSchema, type ProductionVerificationEvidence } from './production-verification-policy';

const sid = (prefix: string) => z.string().regex(new RegExp(`^${prefix}[0-9a-fA-F]{32}$`));
const inputSchema = z.strictObject({ accountSid: sid('AC'), serviceSid: sid('VA'), tenantRef: z.string().regex(/^[0-9a-f]{24}$/),
  apiKeySid: sid('SK'), apiKeySecret: z.string().regex(/^[\x21-\x7e]{1,256}$/) });
const accountSchema = z.object({ sid: sid('AC'), type: z.literal('Full'), status: z.literal('active') });
const settingsSchema = z.object({ friendly_name: z.string().min(1).max(256), code_length: z.number().int().min(4).max(10),
  custom_code_enabled: z.boolean(), lookup_enabled: z.boolean(), psd2_enabled: z.boolean(),
  do_not_share_warning_enabled: z.boolean(), default_template_sid: sid('HJ').nullable() });
const serviceSchema = settingsSchema.extend({ sid: sid('VA'), account_sid: sid('AC') });
const MAX_BYTES = 16 * 1024, TIMEOUT_MS = 5000, CACHE_MS = 5 * 60_000, MAX_TARGETS = 32;
export type TwilioProductionObservationInput = z.infer<typeof inputSchema>;
export type TwilioProductionObservation = ProductionVerificationEvidence['serverObservation'];
type Entry = { observation: TwilioProductionObservation | null; pending: Promise<TwilioProductionObservation | null> | null };

/** SHA256 of this exact UTF-8 JSON projection, with this fixed key order.
 * No defaults, trimming or provider metadata: a missing setting is not proof.
 * https://www.twilio.com/docs/verify/api/service */
export function twilioVerifySettingsFingerprint(value: unknown): string | null {
  const parsed = settingsSchema.safeParse(value);
  if (!parsed.success) return null;
  const s = parsed.data;
  return createHash('sha256').update(JSON.stringify({ friendly_name: s.friendly_name, code_length: s.code_length,
    custom_code_enabled: s.custom_code_enabled, lookup_enabled: s.lookup_enabled, psd2_enabled: s.psd2_enabled,
    do_not_share_warning_enabled: s.do_not_share_warning_enabled, default_template_sid: s.default_template_sid })).digest('hex');
}

/** Read-only facts, not permission to spend. The caller supplies a separately
 * provisioned SK credential; this adapter never sends an SMS or changes settings.
 * Cache keys contain only digests, and provider bodies/errors are never logged.
 * https://www.twilio.com/docs/iam/api/account */
export class TwilioProductionObserver {
  private readonly entries = new Map<string, Entry>();
  constructor(private readonly fetcher: typeof fetch = fetch, private readonly now: () => number = Date.now) {}

  async observe(input: TwilioProductionObservationInput): Promise<TwilioProductionObservation | null> {
    const parsed = inputSchema.safeParse(input);
    if (!parsed.success) return null;
    const target = parsed.data;
    const key = createHash('sha256').update(JSON.stringify([target.accountSid, target.serviceSid,
      target.tenantRef, target.apiKeySid, target.apiKeySecret])).digest('hex');
    const prior = this.entries.get(key);
    if (prior?.pending) return this.copy(await prior.pending);
    const now = this.now();
    if (prior?.observation && now >= prior.observation.observedAt && now - prior.observation.observedAt < CACHE_MS) {
      this.entries.delete(key); this.entries.set(key, prior);
      return this.copy(prior.observation);
    }
    // Remove expired evidence before attempting a refresh. A failed refresh
    // cannot revive a former success or extend its original observedAt.
    this.entries.delete(key);
    if (this.entries.size >= MAX_TARGETS) {
      const available = [...this.entries].find(([, entry]) => !entry.pending);
      if (!available) return null; // Also bound distinct in-flight targets.
      this.entries.delete(available[0]);
    }
    const entry: Entry = { observation: null, pending: null };
    this.entries.set(key, entry);
    entry.pending = this.read(target).then(observation => {
      if (this.entries.get(key) === entry) {
        entry.pending = null;
        if (observation) entry.observation = observation;
        else this.entries.delete(key);
      }
      return observation;
    });
    return this.copy(await entry.pending);
  }

  private copy(value: TwilioProductionObservation | null) { return value ? { ...value } : null; }

  private async read(target: TwilioProductionObservationInput): Promise<TwilioProductionObservation | null> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error('Observation unavailable')); }, TIMEOUT_MS);
    });
    const work = async () => {
      const authorization = `Basic ${Buffer.from(`${target.apiKeySid}:${target.apiKeySecret}`).toString('base64')}`;
      const account = accountSchema.safeParse(await this.json(
        `https://api.twilio.com/2010-04-01/Accounts/${target.accountSid}.json`, authorization, controller.signal));
      if (!account.success || account.data.sid !== target.accountSid) return null;
      const service = serviceSchema.safeParse(await this.json(
        `https://verify.twilio.com/v2/Services/${target.serviceSid}`, authorization, controller.signal));
      if (!service.success || service.data.sid !== target.serviceSid || service.data.account_sid !== target.accountSid
        || service.data.code_length !== 6 || service.data.custom_code_enabled !== false) return null;
      const settingsFingerprint = twilioVerifySettingsFingerprint(service.data);
      const observation = ProductionServerObservationSchema.safeParse({ reference: `twilio_${randomUUID()}`,
        accountSid: target.accountSid, serviceSid: target.serviceSid, tenantRef: target.tenantRef,
        accountType: account.data.type, accountStatus: account.data.status, codeLength: service.data.code_length,
        observedAt: this.now(), settingsFingerprint });
      return observation.success ? observation.data : null;
    };
    try { return await Promise.race([work(), deadline]); }
    catch { return null; }
    finally { clearTimeout(timer); controller.abort(); }
  }

  private async json(url: string, authorization: string, signal: AbortSignal): Promise<unknown> {
    signal.throwIfAborted();
    const response = await this.fetcher(url, { method: 'GET', redirect: 'error', cache: 'no-store', signal,
      headers: { Authorization: authorization, Accept: 'application/json' } });
    const length = response.headers.get('content-length');
    if (signal.aborted || response.status !== 200
      || !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(response.headers.get('content-type') ?? '')
      || (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_BYTES))) {
      void response.body?.cancel().catch(() => {});
      throw new Error('Observation unavailable');
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Observation unavailable');
    const cancel = () => { void reader.cancel().catch(() => {}); };
    signal.addEventListener('abort', cancel, { once: true });
    let completed = false;
    try {
      const decoder = new TextDecoder('utf-8', { fatal: true });
      let text = '', bytes = 0;
      while (true) {
        signal.throwIfAborted();
        const chunk = await reader.read();
        signal.throwIfAborted();
        if (chunk.done) { completed = true; return JSON.parse(text + decoder.decode()); }
        bytes += chunk.value.byteLength;
        if (bytes > MAX_BYTES) throw new Error('Observation unavailable');
        text += decoder.decode(chunk.value, { stream: true });
      }
    } finally {
      signal.removeEventListener('abort', cancel);
      if (!completed) cancel();
      reader.releaseLock();
    }
  }
}
