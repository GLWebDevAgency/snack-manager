import { HttpException, ServiceUnavailableException } from '@nestjs/common';
import { createHash, createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SharedPublicQuota } from '../../common/shared-public-quota';
import {
  LOYALTY_PUBLIC_GLOBAL_RATE_LIMIT,
  LOYALTY_PUBLIC_SOURCE_RATE_LIMIT,
  LOYALTY_PUBLIC_TOKEN_RATE_LIMIT,
  LoyaltyPublicController,
} from './loyalty-public.controller';
import type { LoyaltyPublicService } from './loyalty-public.service';

const TOKEN = 'A'.repeat(43);

function request(
  realIp?: string,
  forwardedFor = '198.51.100.77',
  extraHeaders: Record<string, string> = {},
) {
  return {
    headers: {
      'x-real-ip': realIp,
      'x-forwarded-for': forwardedFor,
      ...extraHeaders,
    },
    socket: { remoteAddress: '10.0.0.4' },
  };
}

function settle(mock: ReturnType<typeof vi.fn>, result: boolean | Error): void {
  if (result instanceof Error) mock.mockRejectedValueOnce(result);
  else mock.mockResolvedValueOnce(result);
}

function harness({
  sources = [true],
  clients = [true],
}: {
  sources?: Array<boolean | Error>;
  clients?: Array<boolean | Error>;
} = {}) {
  const card = vi.fn().mockResolvedValue({ member: { alias: 'Maya' } });
  const reserve = vi.fn();
  const reserveClient = vi.fn();
  for (const result of sources) settle(reserve, result);
  for (const result of clients) settle(reserveClient, result);
  return {
    controller: new LoyaltyPublicController(
      { card } as unknown as LoyaltyPublicService,
      { reserve, reserveClient } as unknown as SharedPublicQuota,
    ),
    card,
    reserve,
    reserveClient,
  };
}

afterEach(() => vi.unstubAllEnvs());

describe('LoyaltyPublicController — quotas partagés', () => {
  it('réserve la source globale puis la carte dans cet ordre', async () => {
    const { controller, card, reserve, reserveClient } = harness();

    await expect(
      controller.card('classfood', { qrToken: TOKEN }, request('203.0.113.41') as never),
    ).resolves.toEqual({ member: { alias: 'Maya' } });

    expect(reserve).toHaveBeenNthCalledWith(1, {
      scope: 'loyalty-card-source',
      clientKey: 'network:203.0.113.41',
      windowMs: 60_000,
      clientLimit: LOYALTY_PUBLIC_SOURCE_RATE_LIMIT,
      globalLimit: LOYALTY_PUBLIC_GLOBAL_RATE_LIMIT,
    });
    expect(reserveClient).toHaveBeenNthCalledWith(1, {
      scope: 'loyalty-card-token',
      clientKey: `tenant:classfood\0token:${TOKEN}`,
      windowMs: 60_000,
      clientLimit: LOYALTY_PUBLIC_TOKEN_RATE_LIMIT,
    });
    expect(card).toHaveBeenCalledWith('classfood', TOKEN);
  });

  it('ignore X-Forwarded-For et arrête toute réservation secondaire si la source est pleine', async () => {
    const { controller, card, reserve, reserveClient } = harness({ sources: [false] });

    await expect(
      controller.card('classfood', { qrToken: TOKEN }, request(undefined, 'spoof') as never),
    ).rejects.toSatisfy(
      (cause: unknown) => cause instanceof HttpException && cause.getStatus() === 429,
    );
    expect(reserve).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ clientKey: 'network:10.0.0.4' }),
    );
    expect(reserveClient).not.toHaveBeenCalled();
    expect(card).not.toHaveBeenCalled();
  });

  it('arrête la carte si le budget de son secret est plein', async () => {
    const { controller, card, reserveClient } = harness({ clients: [false] });
    await expect(
      controller.card('classfood', { qrToken: TOKEN }, request('203.0.113.41') as never),
    ).rejects.toSatisfy(
      (cause: unknown) => cause instanceof HttpException && cause.getStatus() === 429,
    );
    expect(reserveClient).toHaveBeenCalledOnce();
    expect(card).not.toHaveBeenCalled();
  });

  it('échoue fermé quand Redis ne peut pas réserver les fenêtres', async () => {
    const { controller, card } = harness({ sources: [new Error('redis down')] });
    await expect(
      controller.card('classfood', { qrToken: TOKEN }, request('203.0.113.41') as never),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(card).not.toHaveBeenCalled();
  });

  it('cloisonne deux restaurants sans permettre au slug de faire tourner la borne source', async () => {
    const { controller, reserve, reserveClient } = harness({
      sources: [true, true],
      clients: [true, true],
    });
    const relay = request('203.0.113.41') as never;

    await controller.card('classfood', { qrToken: TOKEN }, relay);
    await controller.card('autre-resto', { qrToken: TOKEN }, relay);

    expect(reserve.mock.calls[0]?.[0].clientKey).toBe('network:203.0.113.41');
    expect(reserve.mock.calls[1]?.[0].clientKey).toBe('network:203.0.113.41');
    expect(reserveClient.mock.calls[0]?.[0].clientKey).toBe(
      `tenant:classfood\0token:${TOKEN}`,
    );
    expect(reserveClient.mock.calls[1]?.[0].clientKey).toBe(
      `tenant:autre-resto\0token:${TOKEN}`,
    );
  });

  it("utilise le visiteur attesté plutôt que l'egress partagé du relais Web", async () => {
    const secret = Buffer.alloc(32, 7);
    vi.stubEnv('SM_PUBLIC_RELAY_SIGNING_KEY', secret.toString('base64'));
    const slug = 'classfood';
    const at = String(Math.floor(Date.now() / 1_000));
    const client = createHmac('sha256', secret)
      .update('client\0edge-ip:203.0.113.41')
      .digest('base64url');
    const requestBinding = createHash('sha256')
      .update(`POST\0/public/loyalty/card\0${TOKEN}`)
      .digest('base64url');
    const proof = createHmac('sha256', secret)
      .update(['v2', at, slug, client, requestBinding].join('\0'))
      .digest('base64url');
    const { controller, reserve } = harness();

    await controller.card(
      slug,
      { qrToken: TOKEN },
      request('10.0.0.9', '', {
        'x-sm-relay-client': client,
        'x-sm-relay-at': at,
        'x-sm-relay-proof': proof,
      }) as never,
    );

    expect(reserve).toHaveBeenCalledWith(
      expect.objectContaining({ clientKey: `network:relay:${client}` }),
    );
    expect(reserve.mock.calls[0]?.[0].clientKey).not.toContain('10.0.0.9');
  });

  it('échoue fermé si la preuve du relais est expirée ou signée avec une autre clé', async () => {
    const configured = Buffer.alloc(32, 7);
    const wrong = Buffer.alloc(32, 9);
    vi.stubEnv('SM_PUBLIC_RELAY_SIGNING_KEY', configured.toString('base64'));
    const slug = 'classfood';
    const client = createHmac('sha256', configured)
      .update('client\0edge-ip:203.0.113.41')
      .digest('base64url');
    const requestBinding = createHash('sha256')
      .update(`POST\0/public/loyalty/card\0${TOKEN}`)
      .digest('base64url');
    const headers = (at: string, secret: Uint8Array) => ({
      'x-sm-relay-client': client,
      'x-sm-relay-at': at,
      'x-sm-relay-proof': createHmac('sha256', secret)
        .update(['v2', at, slug, client, requestBinding].join('\0'))
        .digest('base64url'),
    });
    const { controller, reserve, card } = harness({ sources: [true, true] });

    const expiredAt = String(Math.floor(Date.now() / 1_000) - 91);
    await expect(
      controller.card(
        slug,
        { qrToken: TOKEN },
        request('10.0.0.9', '', headers(expiredAt, configured)) as never,
      ),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    const freshAt = String(Math.floor(Date.now() / 1_000));
    await expect(
      controller.card(
        slug,
        { qrToken: TOKEN },
        request('10.0.0.9', '', headers(freshAt, wrong)) as never,
      ),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(reserve).not.toHaveBeenCalled();
    expect(card).not.toHaveBeenCalled();
  });
});
