import { describe, expect, it } from 'vitest';
import { demoTransport, type Transport, type TransportRequest } from '@sm/client-core';
import { DeliveryAvailableOperatorsViewSchema, DeliveryMissionResultSchema, DeliveryMissionViewSchema, type DeliveryMissionAssign } from '@sm/contracts';
import { DEMO_DELIVERY_ORDER_ID as id, withDemoDelivery } from './demo-delivery';
const now = () => Date.parse('2026-09-19T12:00:00Z');
const input: DeliveryMissionAssign = { operationId: 'a0173871-811a-43ee-ae1c-504163424661', expectedRevision: 0, operatorId: 'de1100000000000000000011', expectedOperatorRevision: 0, reason: 'Affectation depuis la caisse' };
const send = (transport: Transport, method: string, path: string, body?: unknown) => transport.send({ method, path, body, headers: {}, baseUrl: 'http://unused.local' });
const make = () => withDemoDelivery(demoTransport({ latency: false, now }), now);
describe('affectation livraison dans la démonstration volatile du POS', () => {
  it('expose une vraie projection de mission et des compteurs cohérents sans départ', async () => {
    const transport = make();
    const before = DeliveryMissionViewSchema.parse((await send(transport, 'GET', `/delivery/missions/${id}`)).body);
    expect(before).toMatchObject({ operator: null, revision: 0, canAssign: true, dispatchedAt: null });
    const first = DeliveryAvailableOperatorsViewSchema.parse((await send(transport, 'GET', '/delivery/operators/available')).body);
    expect(first.operators.map(operator => [operator.assignedCount, operator.departedCount])).toEqual([[0, 0], [0, 0]]);
    const result = DeliveryMissionResultSchema.parse((await send(transport, 'POST', `/delivery/missions/${id}/assignment`, input)).body);
    expect(result).toMatchObject({ outcome: 'applied', replay: false, appliedRevision: 1,
      mission: { operator: { name: 'Samir' }, revision: 1, orderStatus: 'ready', dispatchedAt: null, canAssign: false } });
    expect((await send(transport, 'GET', `/orders/${id}`)).body).toMatchObject({ status: 'ready', payment: { status: 'paid' }, delivery: { dispatchedAt: null, driverName: null } });
    const after = DeliveryAvailableOperatorsViewSchema.parse((await send(transport, 'GET', '/delivery/operators/available')).body);
    expect(after.operators.map(operator => [operator.assignedCount, operator.departedCount])).toEqual([[1, 0], [0, 0]]);
    expect((await send(transport, 'POST', `/delivery/missions/${id}/dispatch`, { operationId: input.operationId, expectedRevision: 1 })).status).toBe(409);
    expect((await send(transport, 'PATCH', `/orders/${id}/status`, { status: 'delivered' })).status).toBe(409);
  });
  it('rejoue la même intention concurrente et refuse remplacement/retrait ou UUID réutilisé autrement', async () => {
    const transport = make();
    const results = await Promise.all([send(transport, 'POST', `/delivery/missions/${id}/assignment`, input), send(transport, 'POST', `/delivery/missions/${id}/assignment`, input)]);
    expect(results.map(result => DeliveryMissionResultSchema.parse(result.body).replay)).toEqual([false, true]);
    expect((await send(transport, 'POST', `/delivery/missions/${id}/assignment`, { ...input, reason: 'Autre intention' })).body).toMatchObject({ code: 'DELIVERY_MISSION_OPERATION_CONFLICT' });
    expect((await send(transport, 'POST', `/delivery/missions/${id}/assignment`, { ...input, operationId: '749aaf0b-d1d4-4656-b733-1aa1bd489173' })).body).toMatchObject({ code: 'DELIVERY_MISSION_CHANGED' });
    for (const operatorId of [null, 'de1100000000000000000012']) {
      expect((await send(transport, 'POST', `/delivery/missions/${id}/assignment`, { ...input, operationId: '749aaf0b-d1d4-4656-b733-1aa1bd489173', expectedRevision: 1, operatorId, expectedOperatorRevision: operatorId ? 0 : null })).status).toBe(403);
    }
  });
  it('consomme le refus de révision livreur et conserve sa preuve de rejeu', async () => {
    const transport = make();
    const stale = { ...input, expectedOperatorRevision: 9 };
    const result = DeliveryMissionResultSchema.parse((await send(transport, 'POST', `/delivery/missions/${id}/assignment`, stale)).body);
    expect(result).toMatchObject({ outcome: 'rejected', refusalCode: 'DELIVERY_OPERATOR_CHANGED', appliedRevision: 1, mission: { operator: null, revision: 1 } });
    expect((await send(transport, 'POST', `/delivery/missions/${id}/assignment`, stale)).body).toMatchObject({ replay: true, outcome: 'rejected' });
    expect((await send(transport, 'POST', `/delivery/missions/${id}/assignment`, { ...input, operationId: '749aaf0b-d1d4-4656-b733-1aa1bd489173' })).body).toMatchObject({ code: 'DELIVERY_MISSION_CHANGED' });
  });
  it('ajoute exactement une livraison aux listes/comptages compatibles, sans modifier la fixture de base', async () => {
    const base = demoTransport({ latency: false, now }); const transport = withDemoDelivery(base, now);
    for (const suffix of ['', '?status=ready', '?status=new', '?since=2026-09-19T12:01:00.000Z']) {
      const original = (await send(base, 'GET', `/orders${suffix}`)).body as { rows: { _id: string }[]; total: number };
      const current = (await send(transport, 'GET', `/orders${suffix}`)).body as { rows: { _id: string }[]; total: number };
      const expected = suffix === '' || suffix === '?status=ready' ? 1 : 0;
      expect(current.rows.filter(row => row._id === id)).toHaveLength(expected);
      expect(current.total).toBe(original.total + expected);
      expect((await send(transport, 'GET', `/orders/count${suffix}`)).body).toEqual({ total: current.total });
      expect(original.rows.some(row => row._id === id)).toBe(false);
    }
  });
  it('isole les instances et les objets retournés, valide les corps, délègue les autres routes', async () => {
    const transport = make();
    const read = (await send(transport, 'GET', `/delivery/missions/${id}`)).body as { revision: number };
    read.revision = 99;
    expect((await send(transport, 'GET', `/delivery/missions/${id}`)).body).toMatchObject({ revision: 0 });
    expect((await send(transport, 'POST', `/delivery/missions/${id}/assignment`, { ...input, tenantId: id })).status).toBe(400);
    await send(transport, 'POST', `/delivery/missions/${id}/assignment`, input);
    expect((await send(make(), 'GET', `/delivery/missions/${id}`)).body).toMatchObject({ revision: 0, operator: null });
    const seen: TransportRequest[] = [];
    const base: Transport = { send: async request => { seen.push(request); return { status: 200, body: { delegated: true } }; } };
    const request: TransportRequest = { method: 'GET', path: '/loyalty/rewards', baseUrl: '', headers: {} };
    expect(await withDemoDelivery(base, now).send(request)).toEqual({ status: 200, body: { delegated: true } });
    expect(seen).toEqual([request]);
  });
});
