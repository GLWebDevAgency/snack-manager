import { createHash, createHmac } from 'node:crypto';

/** Dedicated customer relay protocol. The caller must establish the trusted
 * edge address and tenant/origin before signing. No legacy loyalty key. */
export function customerRelayHeaders(input: {
  key: Uint8Array; slug: string; action: string; origin: string;
  clientIp: string; body: string; now?: number;
}): Record<string, string> {
  const at = String(Math.floor((input.now ?? Date.now()) / 1_000));
  const client = createHmac('sha256', input.key)
    .update(`customer-client-v1\0${input.clientIp}`).digest('base64url');
  const payload = ['customer-v1', at, input.slug, input.action, 'POST',
    `/public/customer/${input.slug}/${input.action}`, input.origin, client,
    createHash('sha256').update(input.body).digest('hex')].join('\0');
  return {
    'x-sm-customer-client': client, 'x-sm-customer-at': at,
    'x-sm-customer-origin': input.origin,
    'x-sm-customer-proof': createHmac('sha256', input.key).update(payload).digest('base64url'),
  };
}
