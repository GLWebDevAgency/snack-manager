import type { Request } from 'express';
import { describe, expect, it, vi } from 'vitest';
import type { SharedPublicQuota } from '../../common/shared-public-quota';
import { PublicErrorsController } from './public-errors.controller';
import type { OpsService } from './ops.service';

const ERROR = {
  source: 'web',
  message: 'Le panier ne charge plus',
  stack: '',
  url: '/classfood/commande',
  appVersion: 'test',
} as const;

const FUNNEL = { slug: 'classfood', step: 'panier', canal: 'page' } as const;

function request(realIp: string, forwarded = '198.51.100.10'): Request {
  return {
    // `req.ip` simule précisément la valeur contaminée par un XFF préservé.
    ip: forwarded,
    headers: { 'x-real-ip': realIp, 'x-forwarded-for': forwarded },
    socket: { remoteAddress: '10.0.0.2' },
  } as unknown as Request;
}

function harness(reservation: boolean | Error = true) {
  const record = vi.fn().mockResolvedValue(undefined);
  const recordFunnel = vi.fn().mockResolvedValue(undefined);
  const reserve =
    reservation instanceof Error
      ? vi.fn().mockRejectedValue(reservation)
      : vi.fn().mockResolvedValue(reservation);
  const Constructor = PublicErrorsController as unknown as new (
    ops: OpsService,
    quota: SharedPublicQuota,
  ) => PublicErrorsController;
  const controller = new Constructor(
    { record, recordFunnel } as unknown as OpsService,
    { reserve } as unknown as SharedPublicQuota,
  );
  return { controller, record, recordFunnel, reserve };
}

describe('PublicErrorsController — quotas partagés', () => {
  it("utilise X-Real-IP et ignore la valeur X-Forwarded-For fournie par l'appelant", async () => {
    const { controller, reserve } = harness();
    await controller.report(ERROR, request('203.0.113.8', 'attaquant-1, 203.0.113.8'));
    await controller.report(ERROR, request('203.0.113.8', 'attaquant-2, 203.0.113.8'));

    expect(reserve).toHaveBeenCalledTimes(2);
    for (const [input] of reserve.mock.calls) {
      expect(input.clientKey).toBe('203.0.113.8');
      expect(input.scope).toBe('client-errors');
      expect(input.clientLimit).toBe(30);
      expect(input.globalLimit).toBeGreaterThan(input.clientLimit);
    }
  });

  it('écrit une erreur seulement après réservation des deux quotas Redis', async () => {
    const allowed = harness(true);
    await expect(allowed.controller.report(ERROR, request('203.0.113.8'))).resolves.toEqual({ ok: true });
    expect(allowed.record).toHaveBeenCalledOnce();

    const limited = harness(false);
    await expect(limited.controller.report(ERROR, request('203.0.113.8'))).resolves.toEqual({ ok: true });
    expect(limited.record).not.toHaveBeenCalled();
  });

  it('droppe silencieusement la télémétrie si Redis tombe', async () => {
    const { controller, record } = harness(new Error('redis indisponible'));
    await expect(controller.report(ERROR, request('203.0.113.8'))).resolves.toEqual({ ok: true });
    expect(record).not.toHaveBeenCalled();
  });

  it('applique un namespace et des limites propres au funnel', async () => {
    const { controller, reserve, recordFunnel } = harness();
    await controller.funnel(FUNNEL, request('203.0.113.9'));
    expect(reserve).toHaveBeenCalledWith({
      scope: 'funnel',
      clientKey: '203.0.113.9',
      windowMs: 60_000,
      clientLimit: 60,
      globalLimit: 1_000,
    });
    expect(recordFunnel).toHaveBeenCalledOnce();
  });
});
