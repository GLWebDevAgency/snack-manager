/** Payment extension confined to the volatile POS demo, never the real API. */
import { CollectOrderPaymentSchema, PAYMENT_TENDER_LABELS, type CollectOrderPayment } from '@sm/contracts';
import type { Transport, TransportResponse } from '@sm/client-core';
import { createSerialTaskQueue } from './service-reconciliation';
import { canCollectOrder } from './service-payment';
import type { ServerOrderRow } from './service-state';

export function withDemoPayment(base: Transport): Transport {
  const serial = createSerialTaskQueue();
  const receipts = new Map<string, { operation: CollectOrderPayment; payment: ServerOrderRow['payment'] }>();
  const present = (row: ServerOrderRow): ServerOrderRow => receipts.has(row._id) ? { ...row, payment: receipts.get(row._id)!.payment } : row;
  const reject = (code: string, message: string): TransportResponse => ({ status: 409, body: { code, message } });
  return { send: (request) => serial.run(async () => {
    const path = request.path.split('?')[0];
    const route = /^\/orders\/([^/]+)(?:\/(collect|status|discount|cancel))?$/.exec(path);
    const id = route?.[1];
    if (id && request.method === 'POST' && route?.[2] === 'collect') {
      const parsed = CollectOrderPaymentSchema.safeParse(request.body);
      if (!parsed.success) return { status: 400, body: { message: 'Paramètres d’encaissement invalides.' } };
      const input = parsed.data;
      const response = await base.send({ ...request, method: 'GET', path: `/orders/${id}`, body: undefined });
      if (response.status !== 200) return response;
      const row = present(response.body as ServerOrderRow);
      const previous = receipts.get(id);
      if (previous) {
        if (previous.operation.operationId !== input.operationId) return reject('ORDER_COLLECTION_ALREADY_COLLECTED', 'Commande déjà encaissée. Ne percevez aucun autre règlement.');
        if (JSON.stringify(previous.operation) !== JSON.stringify(input)) return reject('ORDER_COLLECTION_OPERATION_CONFLICT', 'Les paramètres de cette référence sont différents.');
        return { status: 200, body: row };
      }
      if (!canCollectOrder(row) || row.totals?.total !== input.expectedTotalCents) return reject('ORDER_COLLECTION_REJECTED', 'Cette commande ne peut pas être encaissée dans son état actuel.');
      if (input.tender === 'cash' && input.cashReceivedCents < input.expectedTotalCents) return { status: 400, body: { message: 'Montant reçu insuffisant.' } };
      const payment: ServerOrderRow['payment'] = { method: 'counter', status: 'paid', tender: input.tender,
        cashReceived: input.tender === 'cash' ? input.cashReceivedCents : null,
        changeGiven: input.tender === 'cash' ? input.cashReceivedCents - input.expectedTotalCents : null };
      receipts.set(id, { operation: input, payment });
      return { status: 200, body: present(row) };
    }
    if (id && request.method === 'POST' && ['discount', 'cancel'].includes(route?.[2] ?? '') && receipts.has(id)) {
      return reject('ORDER_COLLECTION_REJECTED', 'Cette commande est déjà payée. Faites traiter un éventuel remboursement par un responsable.');
    }
    if (id && request.method === 'PATCH' && route?.[2] === 'status' && (request.body as { status?: string })?.status === 'delivered') {
      const current = await base.send({ ...request, method: 'GET', path: `/orders/${id}`, body: undefined });
      if (current.status !== 200) return current;
      const row = present(current.body as ServerOrderRow);
      if (row.status !== 'ready' || row.payment?.status !== 'paid' || row.type === 'delivery') return reject('ORDER_COLLECTION_REJECTED', 'La remise exige une commande prête et payée.');
    }
    const result = await base.send(request);
    if (result.status !== 200 || !result.body || typeof result.body !== 'object') return result;
    if (path === '/orders' && 'rows' in result.body && Array.isArray(result.body.rows)) return { ...result, body: { ...result.body, rows: result.body.rows.map(present) } };
    if (id && '_id' in result.body) return { ...result, body: present(result.body as ServerOrderRow) };
    const ticketId = /^\/public\/orders\/([^/]+)\/ticket$/.exec(path)?.[1];
    const receipt = ticketId ? receipts.get(ticketId) : undefined;
    if (receipt) return { ...result, body: { ...result.body, payment: { ...receipt.payment, paid: true, methodLabel: 'Au comptoir', statusLabel: 'Payé', tenderLabel: PAYMENT_TENDER_LABELS[receipt.operation.tender] } } };
    return result;
  }) };
}
