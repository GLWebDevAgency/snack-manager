import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { CUSTOMER_ACCOUNT_TURNSTILE_ACTION, customerAccountTurnstileData } from '@sm/contracts';
import { CustomerIdentityError } from './customer-identity.service';

export const CUSTOMER_HUMAN_FETCH = Symbol('CUSTOMER_HUMAN_FETCH');
const resultSchema = z.object({ success: z.literal(true), hostname: z.string().max(253),
  action: z.literal(CUSTOMER_ACCOUNT_TURNSTILE_ACTION), cdata: z.string().max(255) });

@Injectable()
export class CustomerAccountHumanVerifier {
  constructor(@Inject(CUSTOMER_HUMAN_FETCH) private readonly fetcher: typeof fetch) {}

  async verify(input: { secret: string; token: string; origin: string; slug: string; operationId: string }): Promise<boolean> {
    const controller = new AbortController();
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unavailable = () => new CustomerIdentityError('unavailable');
    const work = async () => {
      const response = await this.fetcher('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST', redirect: 'error', signal: controller.signal,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        // The relay supplies a pseudonym, never a raw client IP. Do not forward it as remoteip.
        body: new URLSearchParams({ secret: input.secret, response: input.token }),
      });
      if (controller.signal.aborted || !response.ok || !response.body) {
        void response.body?.cancel().catch(() => undefined); throw unavailable();
      }
      reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
      while (true) {
        const next = await reader.read();
        if (controller.signal.aborted) throw unavailable();
        if (next.done) break;
        size += next.value.byteLength;
        if (size > 16_384) throw unavailable();
        chunks.push(next.value);
      }
      const parsed = resultSchema.safeParse(JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown);
      return parsed.success && parsed.data.hostname === new URL(input.origin).hostname
        && parsed.data.cdata === customerAccountTurnstileData(input.slug, input.operationId);
    };
    try {
      return await Promise.race([work(), new Promise<never>((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(unavailable()); }, 5000);
      })]);
    } catch { throw unavailable(); }
    finally { clearTimeout(timer); controller.abort(); void reader?.cancel().catch(() => undefined); }
  }
}
