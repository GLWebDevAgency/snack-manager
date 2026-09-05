import { describe, expect, it } from 'vitest';
import { demoTransport, type Transport, type TransportRequest } from '@sm/client-core';
import type { CollectOrderPayment } from '@sm/contracts';
import { withDemoPayment } from './demo-payment';
import type { ServerOrderRow } from './service-state';
const input: CollectOrderPayment = { operationId: 'a0173871-811a-43ee-ae1c-504163424661', tender: 'cash', expectedTotalCents: 500, cashReceivedCents: 1000 };
const send = (transport: Transport, method: string, path: string, body?: unknown) => transport.send({ method, path, body, headers: {}, baseUrl: 'http://unused.local' });
async function fixture() {
  const base = demoTransport({ latency: false });
  const menu = (await send(base, 'GET', '/public/tenants/classfood/menu')).body as { categories: { products: { _id: string; price?: number; variants: unknown[]; optionGroups: unknown[] }[] }[] };
  const product = menu.categories.flatMap((c) => c.products).find((p) => p.price && p.variants.length === 0 && p.optionGroups.length === 0)!;
  const created = (await send(base, 'POST', '/orders', { clientId: input.operationId, type: 'pickup', channel: 'online', payment: { method: 'counter' }, lines: [{ productId: product._id, qty: 1, options: [], removed: [] }] })).body as ServerOrderRow;
  await send(base, 'PATCH', `/orders/${created._id}/status`, { status: 'preparing' });
  await send(base, 'PATCH', `/orders/${created._id}/status`, { status: 'ready' });
  return { transport: withDemoPayment(base), order: created, operation: { ...input, expectedTotalCents: created.totals!.total!, cashReceivedCents: 10000 } };
}
describe('encaissement en démonstration sans aucune écriture réseau', () => {
  it('garde paiement, liste, ticket et remise cohérents dans le vrai transport mémoire', async () => {
    const { transport, order, operation } = await fixture();
    expect((await send(transport, 'PATCH', `/orders/${order._id}/status`, { status: 'delivered' })).status).toBe(409);
    const result = await send(transport, 'POST', `/orders/${order._id}/collect`, operation);
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ _id: order._id, status: 'ready', payment: { status: 'paid', tender: 'cash', changeGiven: 10000 - operation.expectedTotalCents } });
    expect((await send(transport, 'GET', `/orders/${order._id}`)).body).toMatchObject({ payment: { status: 'paid' } });
    const list = (await send(transport, 'GET', '/orders?status=ready')).body as { rows: ServerOrderRow[] };
    expect(list.rows.find((row) => row._id === order._id)?.payment?.status).toBe('paid');
    const ticket = await send(transport, 'GET', `/public/orders/${order._id}/ticket?t=demo-${order._id}`);
    expect(ticket.body).toMatchObject({ payment: { paid: true, tender: 'cash' } });
    expect((await send(transport, 'POST', `/orders/${order._id}/discount`, { amount: 100, reason: 'Non autorisé' })).status).toBe(409);
    expect((await send(transport, 'PATCH', `/orders/${order._id}/status`, { status: 'delivered' })).body).toMatchObject({ status: 'delivered', payment: { status: 'paid' } });
    expect((await send(transport, 'POST', `/orders/${order._id}/collect`, operation)).body).toMatchObject({ status: 'delivered', payment: { status: 'paid' } });
  });
  it('rejoue le même UUID et refuse une autre perception ou des paramètres modifiés', async () => {
    const { transport, order, operation } = await fixture();
    const results = await Promise.all([send(transport, 'POST', `/orders/${order._id}/collect`, operation), send(transport, 'POST', `/orders/${order._id}/collect`, operation)]);
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect((await send(transport, 'POST', `/orders/${order._id}/collect`, { ...operation, operationId: '849aaf0b-d1d4-4656-b733-1aa1bd489173' })).body).toMatchObject({ code: 'ORDER_COLLECTION_ALREADY_COLLECTED' });
    expect((await send(transport, 'POST', `/orders/${order._id}/collect`, { ...operation, cashReceivedCents: 20000 })).body).toMatchObject({ code: 'ORDER_COLLECTION_OPERATION_CONFLICT' });
  });
  it('délègue les autres routes inchangées', async () => {
    const seen: TransportRequest[] = [];
    const base: Transport = { send: async (request) => { seen.push(request); return { status: 200, body: { ok: true } }; } };
    const request: TransportRequest = { method: 'GET', path: '/loyalty/rewards', baseUrl: '', headers: {} };
    expect(await withDemoPayment(base).send(request)).toEqual({ status: 200, body: { ok: true } });
    expect(seen).toEqual([request]);
  });
});
