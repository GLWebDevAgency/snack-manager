import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CustomerAccountActionSchema, CustomerAccountEnvelopes, CustomerAccountSlugSchema, type CustomerAccountAction } from '@sm/contracts';
import type { Request, Response } from 'express';
import { SharedPublicQuota } from '../../common/shared-public-quota';
import { customerAccessConfiguration } from './customer-account.config';
import { customerHttpError } from './customer-account.error';

export type CustomerRelay = { slug: string; action: CustomerAccountAction; origin: string; client: string };
export type CustomerAccountRequest = Request & { rawBody?: Buffer; customerRelay?: CustomerRelay };
const canonicalToken = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/;
const headers = ['x-sm-customer-client', 'x-sm-customer-at', 'x-sm-customer-origin', 'x-sm-customer-proof'] as const;

/** Not a JWT guard and never sets req.user. A browser bearer, QR or a legacy
 * public relay signature cannot enter this server-to-server boundary. */
@Injectable()
export class CustomerAccountGuard implements CanActivate {
  constructor(@Inject(ConfigService) private readonly config: ConfigService,
    @Inject(SharedPublicQuota) private readonly quota: SharedPublicQuota) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<CustomerAccountRequest>();
    const response = context.switchToHttp().getResponse<Response>();
    response.setHeader('Cache-Control', 'no-store, private');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    const config = customerAccessConfiguration(this.config);
    if (!config) throw customerHttpError('unavailable');
    const action = CustomerAccountActionSchema.safeParse(request.params.action);
    const slug = CustomerAccountSlugSchema.safeParse(request.params.slug);
    if (!action.success || !slug.success || slug.data !== config.slug) throw customerHttpError('relay');
    const path = `/public/customer/${slug.data}/${action.data}`;
    if (request.method !== 'POST' || request.originalUrl !== path) throw customerHttpError('relay');
    const values = headers.map(name => singletonHeader(request, name));
    const [client, at, origin, proof] = values;
    if (!client || !at || !origin || !proof || !canonicalToken.test(client) || !canonicalToken.test(proof)
      || !/^\d{10}$/.test(at) || Math.abs(Math.floor(Date.now() / 1000) - Number(at)) > 60
      || !config.origins.includes(origin)) throw customerHttpError('relay');
    const contentType = singletonHeader(request, 'content-type');
    if (!contentType || !/^application\/json(?:;\s*charset=utf-8)?$/i.test(contentType)
      || request.headers['content-encoding'] !== undefined) throw customerHttpError('invalid_request');
    let serialized: string;
    try { serialized = JSON.stringify(request.body); }
    catch { throw customerHttpError('invalid_request'); }
    if (!serialized || Buffer.byteLength(serialized) > 4096 || (request.rawBody && request.rawBody.byteLength > 4096)) {
      throw customerHttpError('invalid_request');
    }
    const payload = ['customer-v1', at, slug.data, action.data, 'POST', path, origin, client,
      createHash('sha256').update(serialized).digest('hex')].join('\0');
    const expected = createHmac('sha256', Buffer.from(config.relayKey, 'base64')).update(payload).digest();
    if (!timingSafeEqual(expected, Buffer.from(proof, 'base64url'))) throw customerHttpError('relay');
    if (!CustomerAccountEnvelopes[action.data].safeParse(request.body).success) throw customerHttpError('invalid_request');
    let allowed: boolean;
    try {
      allowed = await this.quota.reserve({ scope: 'customer-account-http', clientKey: client,
        windowMs: 60_000, clientLimit: 60, globalLimit: 300 });
    } catch { throw customerHttpError('unavailable'); }
    if (!allowed) throw customerHttpError('limited');
    request.customerRelay = { slug: slug.data, action: action.data, client, origin };
    return true;
  }
}
function singletonHeader(request: Request, name: string): string | null {
  const value = request.headers[name];
  let count = 0;
  for (let i = 0; i < request.rawHeaders.length; i += 2) if (request.rawHeaders[i]?.toLowerCase() === name) count++;
  return count === 1 && typeof value === 'string' && !value.includes(',') ? value : null;
}
