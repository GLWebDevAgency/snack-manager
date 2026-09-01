import { HttpException, ServiceUnavailableException } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PublicOrderGate } from './public-order-gate';

const TENANT = '507f1f77bcf86cd799439011';
const TOKEN = 'preuve-turnstile';

function gate(
  values: Record<string, string | undefined> = {},
  quotaResult: [number, number, number, number] | Error = [1, 1, 1, 1],
) {
  const config = {
    get: (key: string) =>
      ({
        TURNSTILE_SECRET_KEY: 'secret-reel',
        TURNSTILE_ALLOWED_HOSTNAMES: 'snackmanager.fr,localhost',
        ...values,
      })[key],
  };
  const redis = {
    eval: vi.fn().mockImplementation(async (script: string) => {
      if (quotaResult instanceof Error) throw quotaResult;
      return script.includes('ZREMRANGEBYSCORE') ? quotaResult : 1;
    }),
    set: vi.fn().mockResolvedValue('OK'),
  };
  return { service: new PublicOrderGate(config as never, redis as never), redis };
}

function siteverify(over: Record<string, unknown> = {}) {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        success: true,
        hostname: 'classfood.snackmanager.fr',
        action: 'public-order',
        cdata: 'classfood',
        ...over,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('preuve humaine de la commande publique', () => {
  it('valide cote serveur, lie la preuve au tenant et accepte un sous-domaine autorise', async () => {
    const fetchMock = siteverify();
    const { service, redis } = gate();

    const proof = await service.authorize({
      tenantId: TENANT,
      tenantSlug: 'classfood',
      turnstileToken: TOKEN,
    });

    expect(proof.provider).toBe('turnstile');
    expect(proof.hostname).toBe('classfood.snackmanager.fr');
    expect(proof.quotaReservation).toMatchObject({ tenantId: TENANT });
    expect(redis.eval).toHaveBeenCalledOnce();
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(request.body)) as Record<string, unknown>;
    expect(body.secret).toBe('secret-reel');
    expect(body.response).toBe(TOKEN);
    expect(body.idempotency_key).toMatch(/^[0-9a-f-]{36}$/);
    expect(body).not.toHaveProperty('remoteip');
  });

  it.each([
    [{ success: false, 'error-codes': ['invalid-input-response'] }, 'preuve invalide'],
    [{ action: 'contact' }, 'mauvaise action'],
    [{ cdata: 'autre-restaurant' }, 'mauvais tenant'],
    [{ hostname: 'snackmanager.fr.pirate.example' }, 'mauvais hostname'],
  ])('refuse %s avant de consommer le quota (%s)', async (response, _label) => {
    siteverify(response);
    const { service, redis } = gate();
    await expect(
      service.authorize({ tenantId: TENANT, tenantSlug: 'classfood', turnstileToken: TOKEN }),
    ).rejects.toMatchObject({ status: 400 });
    expect(redis.eval).not.toHaveBeenCalled();
  });

  it('refuse une cle de test sur Railway, meme si le drapeau local a ete copie', async () => {
    const fetchMock = siteverify();
    const { service } = gate({
      TURNSTILE_SECRET_KEY: '1x0000000000000000000000000000000AA',
      TURNSTILE_TEST_MODE: '1',
      RAILWAY_ENVIRONMENT_NAME: 'production',
    });
    await expect(
      service.authorize({ tenantId: TENANT, tenantSlug: 'classfood', turnstileToken: TOKEN }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('accepte la cle de test uniquement dans un runtime local explicite', async () => {
    siteverify();
    await expect(
      gate({
        TURNSTILE_SECRET_KEY: '1x0000000000000000000000000000000AA',
        TURNSTILE_TEST_MODE: '1',
        NODE_ENV: 'development',
      }).service.authorize({
        tenantId: TENANT,
        tenantSlug: 'classfood',
        turnstileToken: TOKEN,
      }),
    ).resolves.toMatchObject({ provider: 'turnstile' });

    const fetchMock = siteverify();
    await expect(
      gate({
        TURNSTILE_SECRET_KEY: '1x0000000000000000000000000000000AA',
        TURNSTILE_TEST_MODE: '1',
        NODE_ENV: undefined,
      }).service.authorize({
        tenantId: TENANT,
        tenantSlug: 'classfood',
        turnstileToken: TOKEN,
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('ferme la commande si Siteverify ou sa configuration ne repond pas', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('reseau coupe')));
    await expect(
      gate().service.authorize({
        tenantId: TENANT,
        tenantSlug: 'classfood',
        turnstileToken: TOKEN,
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    await expect(
      gate({ TURNSTILE_SECRET_KEY: undefined }).service.authorize({
        tenantId: TENANT,
        tenantSlug: 'classfood',
        turnstileToken: TOKEN,
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});

describe('quotas partages du restaurant', () => {
  it.each([
    [[0, 12, 1, 1], 'burst tenant'],
    [[0, 1, 60, 1], 'heure tenant'],
    [[0, 1, 1, 300], 'burst global'],
  ] as const)('rend 429 quand le compteur depasse la borne : %s (%s)', async (counts, _label) => {
    siteverify();
    const { service } = gate({}, [...counts]);
    const error = await service
      .authorize({ tenantId: TENANT, tenantSlug: 'classfood', turnstileToken: TOKEN })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(429);
  });

  it('echoue ferme si Redis ne peut plus partager les compteurs', async () => {
    siteverify();
    const { service } = gate({}, new Error('redis coupe'));
    await expect(
      service.authorize({ tenantId: TENANT, tenantSlug: 'classfood', turnstileToken: TOKEN }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('rend atomiquement la reservation quand la commande ne nait pas', async () => {
    siteverify();
    const { service, redis } = gate();
    const proof = await service.authorize({
      tenantId: TENANT,
      tenantSlug: 'classfood',
      turnstileToken: TOKEN,
    });
    await service.release(proof);

    expect(redis.eval).toHaveBeenCalledTimes(2);
    const releaseArgs = redis.eval.mock.calls[1] ?? [];
    expect(String(releaseArgs[0])).toContain('ZREM');
    expect(releaseArgs.at(-1)).toBe(proof.quotaReservation.id);
  });

  it('serialise la seconde lecture et libere le verrou avec son proprietaire', async () => {
    const { service, redis } = gate();
    const work = vi.fn().mockResolvedValue('commande');
    await expect(
      service.serializeSlot(
        { tenantId: TENANT, slot: '2026-08-29T18:00:00.000Z' },
        work,
      ),
    ).resolves.toBe('commande');

    expect(redis.set).toHaveBeenCalledWith(
      expect.stringContaining(`public-orders:slot-lock:${TENANT}:`),
      expect.any(String),
      'PX',
      15_000,
      'NX',
    );
    expect(work).toHaveBeenCalledOnce();
    expect(String(redis.eval.mock.calls[0]?.[0])).toContain('GET');
  });
});
