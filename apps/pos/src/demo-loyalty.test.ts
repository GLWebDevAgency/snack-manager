import { describe, expect, it } from 'vitest';
import type { Transport } from '@sm/client-core';
import {
  LoyaltyEnrollmentAcknowledgementResultSchema,
  LoyaltyEnrollmentPrepareResultSchema,
  LoyaltyEnrollmentRecoveryResultSchema,
  LoyaltyMemberCreateResultSchema,
} from '@sm/contracts';
import { DEMO_LOYALTY_QR, withDemoLoyalty } from './demo-loyalty';

const base: Transport = {
  send: async () => ({ status: 418, body: { delegated: true } }),
};

const send = (
  transport: Transport,
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
) => transport.send({ method, path, body, baseUrl: '', headers });

function orderTransport(total = 1_500): Transport {
  const order = {
    _id: 'demo-order-loyalty-1',
    clientId: '',
    status: 'new',
    totals: { total },
    payment: { status: 'paid' },
  };
  return {
    send: async (request) => {
      if (request.method === 'POST' && request.path === '/orders') {
        order.clientId = (request.body as { clientId: string }).clientId;
        return { status: 200, body: { ...order } };
      }
      if (request.method === 'PATCH' && request.path.endsWith('/status')) {
        order.status = (request.body as { status: string }).status;
        return { status: 200, body: { ...order } };
      }
      if (request.method === 'POST' && request.path.endsWith('/cancel')) {
        order.status = 'cancelled';
        return { status: 200, body: { ...order } };
      }
      return { status: 404, body: { message: 'Route de test absente' } };
    },
  };
}

describe('fidélité du transport POS de démonstration', () => {
  it('délègue toutes les routes étrangères au transport de commande', async () => {
    await expect(send(withDemoLoyalty(base), 'GET', '/orders')).resolves.toEqual({
      status: 418,
      body: { delegated: true },
    });
  });

  it('résout la carte par QR ou téléphone exact et sert le catalogue actif', async () => {
    const transport = withDemoLoyalty(base);
    const qr = await send(transport, 'POST', '/loyalty/members/resolve', {
      by: 'qr_token',
      qrToken: DEMO_LOYALTY_QR,
    });
    const phone = await send(transport, 'POST', '/loyalty/members/resolve', {
      by: 'phone',
      phone: '06 12 34 56 78',
    });
    expect(qr.status).toBe(200);
    expect(phone.body).toEqual(qr.body);
    expect((await send(transport, 'GET', '/loyalty/rewards')).status).toBe(200);
  });

  it('sécurise tout le handoff avant de rendre une nouvelle carte utilisable', async () => {
    const transport = withDemoLoyalty(base, { now: () => Date.parse('2026-09-01T12:00:00Z') });
    const headers = { Authorization: 'Bearer terminal-a' };
    const body = {
      operationId: '80000000-0000-4000-8000-000000000001',
      firstName: null,
      phone: null,
      termsAccepted: true,
      termsNoticeVersion: 'loyalty-pilot-2026-09',
    };

    const prepared = await send(
      transport,
      'POST',
      '/loyalty/members/enrollments/prepare',
      { operationId: body.operationId },
      headers,
    );
    expect(prepared.status).toBe(200);
    expect(LoyaltyEnrollmentPrepareResultSchema.parse(prepared.body)).toMatchObject({
      operationId: body.operationId,
      status: 'prepared',
    });

    const pending = await send(
      transport,
      'POST',
      '/loyalty/members/enrollments/recover',
      { operationId: body.operationId },
      headers,
    );
    expect(LoyaltyEnrollmentRecoveryResultSchema.parse(pending.body)).toMatchObject({
      status: 'pending',
      operationId: body.operationId,
      retryAfterMs: 750,
    });
    await expect(
      send(
        transport,
        'POST',
        '/loyalty/members/enrollments/recover',
        { operationId: body.operationId },
        { Authorization: 'Bearer terminal-b' },
      ),
    ).resolves.toMatchObject({ status: 403 });

    const first = await send(transport, 'POST', '/loyalty/members', body, headers);
    const replay = await send(transport, 'POST', '/loyalty/members', body, headers);
    expect(first.status).toBe(201);
    const enrollment = LoyaltyMemberCreateResultSchema.parse(first.body);
    expect(enrollment.qrToken).toHaveLength(43);
    expect(enrollment.handoffExpiresAt).toBe('2026-09-01T12:30:00.000Z');
    expect(replay.body).toMatchObject({ replayed: true, operationId: body.operationId });

    // Le secret existe, mais ni le QR ni la référence membre ne sont actifs
    // tant que l'opérateur n'a pas confirmé leur remise au client.
    await expect(
      send(transport, 'POST', '/loyalty/members/resolve', {
        by: 'qr_token',
        qrToken: enrollment.qrToken,
      }),
    ).resolves.toMatchObject({ status: 404 });

    const recovered = await send(
      transport,
      'POST',
      '/loyalty/members/enrollments/recover',
      { operationId: body.operationId },
      headers,
    );
    expect(LoyaltyEnrollmentRecoveryResultSchema.parse(recovered.body)).toMatchObject({
      status: 'ready',
      enrollment: {
        replayed: true,
        operationId: body.operationId,
        qrToken: enrollment.qrToken,
      },
    });

    const acknowledged = await send(
      transport,
      'POST',
      '/loyalty/members/enrollments/acknowledge',
      { operationId: body.operationId },
      headers,
    );
    expect(LoyaltyEnrollmentAcknowledgementResultSchema.parse(acknowledged.body)).toEqual({
      operationId: body.operationId,
      acknowledged: true,
      replayed: false,
    });
    const acknowledgedReplay = await send(
      transport,
      'POST',
      '/loyalty/members/enrollments/acknowledge',
      { operationId: body.operationId },
      headers,
    );
    expect(acknowledgedReplay.body).toMatchObject({ acknowledged: true, replayed: true });
    await expect(
      send(transport, 'POST', '/loyalty/members/resolve', {
        by: 'qr_token',
        qrToken: enrollment.qrToken,
      }),
    ).resolves.toMatchObject({ status: 200, body: { id: enrollment.member.id } });
    await expect(
      send(
        transport,
        'POST',
        '/loyalty/members/enrollments/recover',
        { operationId: body.operationId },
        headers,
      ),
    ).resolves.toMatchObject({ status: 410 });
  });

  it('ne crédite la vente rattachée qu’au passage payé à delivered, une seule fois', async () => {
    const transport = withDemoLoyalty(orderTransport(), {
      now: () => Date.parse('2026-09-01T12:00:00Z'),
    });
    const clientId = '90000000-0000-4000-8000-000000000042';
    await send(transport, 'POST', '/orders', {
      clientId,
      loyaltyMemberId: '70000000-0000-4000-8000-000000000002',
      loyaltyEarnOperationId: '80000000-0000-4000-8000-000000000009',
    });

    await expect(
      send(transport, 'GET', `/orders/by-client/${clientId}/loyalty`),
    ).resolves.toMatchObject({
      status: 200,
      body: { state: 'pending', attempts: 0, errorCode: null },
    });
    await expect(
      send(transport, 'POST', '/loyalty/members/resolve', {
        by: 'member_ref',
        memberRef: '70000000-0000-4000-8000-000000000002',
      }),
    ).resolves.toMatchObject({ body: { balanceUnits: 24 } });

    await send(transport, 'PATCH', '/orders/demo-order-loyalty-1/status', {
      status: 'preparing',
    });
    await expect(
      send(transport, 'GET', `/orders/by-client/${clientId}/loyalty`),
    ).resolves.toMatchObject({ body: { state: 'pending', attempts: 0 } });

    await send(transport, 'PATCH', '/orders/demo-order-loyalty-1/status', {
      status: 'delivered',
    });
    // Rejeu offline/KDS : la seconde transition ne doit jamais recréditer.
    await send(transport, 'PATCH', '/orders/demo-order-loyalty-1/status', {
      status: 'delivered',
    });
    await expect(
      send(transport, 'GET', `/orders/by-client/${clientId}/loyalty`),
    ).resolves.toMatchObject({
      status: 200,
      body: { state: 'completed', attempts: 1, errorCode: null },
    });
    await expect(
      send(transport, 'POST', '/loyalty/members/resolve', {
        by: 'member_ref',
        memberRef: '70000000-0000-4000-8000-000000000002',
      }),
    ).resolves.toMatchObject({ body: { balanceUnits: 39 } });
  });

  it('annule définitivement l’intention avant livraison sans crédit ultérieur', async () => {
    const transport = withDemoLoyalty(orderTransport(), {
      now: () => Date.parse('2026-09-01T12:00:00Z'),
    });
    const clientId = '90000000-0000-4000-8000-000000000043';
    await send(transport, 'POST', '/orders', {
      clientId,
      loyaltyMemberId: '70000000-0000-4000-8000-000000000002',
      loyaltyEarnOperationId: '80000000-0000-4000-8000-000000000010',
    });
    await send(transport, 'POST', '/orders/demo-order-loyalty-1/cancel');
    // Même si un transport défectueux acceptait ensuite une transition tardive,
    // l'intention annulée reste terminale et ne touche jamais le registre.
    await send(transport, 'PATCH', '/orders/demo-order-loyalty-1/status', {
      status: 'delivered',
    });

    await expect(
      send(transport, 'GET', `/orders/by-client/${clientId}/loyalty`),
    ).resolves.toMatchObject({
      status: 200,
      body: { state: 'cancelled', attempts: 0, errorCode: 'sale_cancelled' },
    });
    await expect(
      send(transport, 'POST', '/loyalty/members/resolve', {
        by: 'member_ref',
        memberRef: '70000000-0000-4000-8000-000000000002',
      }),
    ).resolves.toMatchObject({ body: { balanceUnits: 24 } });
  });

  it('refuse tout nouvel accord marketing mais conserve le retrait', async () => {
    const transport = withDemoLoyalty(base, { now: () => Date.parse('2026-09-01T12:00:00Z') });
    const memberId = '70000000-0000-4000-8000-000000000002';
    const granted = await send(transport, 'POST', `/loyalty/members/${memberId}/consents`, {
      operationId: '80000000-0000-4000-8000-000000000006',
      purpose: 'marketing_sms',
      decision: 'granted',
      noticeVersion: 'marketing-sms-pilot-2026-09',
    });
    const withdrawn = await send(transport, 'POST', `/loyalty/members/${memberId}/consents`, {
      operationId: '80000000-0000-4000-8000-000000000007',
      purpose: 'marketing_sms',
      decision: 'withdrawn',
      noticeVersion: 'marketing-sms-pilot-2026-09',
    });

    expect(granted).toMatchObject({ status: 409 });
    expect(withdrawn).toMatchObject({
      status: 201,
      body: { consent: { purpose: 'marketing_sms', decision: 'withdrawn' } },
    });
  });

  it('rend le gain idempotent et suspend toute consommation hors ticket', async () => {
    const transport = withDemoLoyalty(base, { now: () => Date.parse('2026-09-01T12:00:00Z') });
    const memberId = '70000000-0000-4000-8000-000000000002';
    const earn = {
      operationId: '80000000-0000-4000-8000-000000000002',
      purchaseCents: 1_500,
      externalRef: 'pos-order:90000000-0000-4000-8000-000000000042',
    };
    const first = await send(transport, 'POST', `/loyalty/members/${memberId}/earn`, earn);
    const replay = await send(transport, 'POST', `/loyalty/members/${memberId}/earn`, earn);
    expect(first.body).toMatchObject({
      outcome: 'earned',
      awardedUnits: 15,
      member: { balanceUnits: 39 },
    });
    expect(replay.body).toMatchObject({
      replayed: true,
      outcome: 'earned',
      member: { balanceUnits: 39 },
    });

    const suspended = await send(
      transport,
      'POST',
      `/loyalty/members/${memberId}/redemptions`,
      {
        operationId: '80000000-0000-4000-8000-000000000005',
        rewardId: '70000000-0000-4000-8000-000000000010',
        expectedCostUnits: 8,
        externalRef: 'pos-redemption:80000000-0000-4000-8000-000000000005',
      },
    );
    expect(suspended).toMatchObject({ status: 410 });
  });
});
