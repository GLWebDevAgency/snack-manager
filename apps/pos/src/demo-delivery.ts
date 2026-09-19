/** Livraison de démonstration, uniquement dans le transport volatil du POS. */
import {
  DeliveryAvailableOperatorsViewSchema,
  DeliveryMissionAssignSchema,
  DeliveryMissionResultSchema,
  DeliveryMissionViewSchema,
  DeliveryOperatorsQuerySchema,
  type DeliveryMissionAssign,
  type DeliveryMissionResult,
  type DeliveryMissionView,
} from '@sm/contracts';
import { demoMenu, uuid, type Transport, type TransportResponse } from '@sm/client-core';
import { createSerialTaskQueue } from './service-reconciliation';
import type { ServerOrderRow } from './service-state';

export const DEMO_DELIVERY_ORDER_ID = 'de1100000000000000000001';
export const DEMO_DELIVERY_NUMBER = 900;
const operators = [
  { id: 'de1100000000000000000011', name: 'Samir', revision: 0 },
  { id: 'de1100000000000000000012', name: 'Lina', revision: 0 },
];

/** Ne monte ni serveur, ni timer, ni stockage ; chaque appel crée un monde neuf. */
export function withDemoDelivery(base: Transport, now: () => number = Date.now): Transport {
  const serial = createSerialTaskQueue();
  const createdAt = new Date(now() - 8 * 60_000).toISOString();
  // Prix et libellé issus de la vraie carte démo, sans second tarif inventé.
  const product = demoMenu().categories.flatMap(category => category.products)
    .find(item => typeof item.price === 'number' && item.price > 0 && !item.variants?.length && !item.optionGroups?.length)!;
  const amount = product.price!;
  const address = { line1: '12 rue de la Démonstration', postalCode: '75001', city: 'Paris', country: 'FR' as const };
  const row: ServerOrderRow = {
    _id: DEMO_DELIVERY_ORDER_ID, number: DEMO_DELIVERY_NUMBER,
    clientId: 'c9000000-0000-4000-8000-000000000001', createdAt,
    type: 'delivery', channel: 'online', status: 'ready',
    payment: { method: 'online', status: 'paid', tender: 'online' },
    totals: { subtotal: amount, deliveryFee: 250, total: amount + 250, discount: null },
    lines: [{ productId: product._id, name: product.name, variantName: null, qty: 1,
      unitPrice: amount, lineTotal: amount, options: [], removed: [] }],
    pickup: { slot: new Date(now() + 15 * 60_000).toISOString(), customerName: 'Camille · Démo', customerPhone: null },
    delivery: { address, zoneId: 'demo', zoneName: 'Démonstration', feeCents: 250,
      estimatedMinutes: 30, dispatchedAt: null, deliveredAt: null, driverName: null },
    statusHistory: [{ status: 'new', at: createdAt }, { status: 'preparing', at: createdAt }, { status: 'ready', at: createdAt }],
  };
  let mission: DeliveryMissionView = DeliveryMissionViewSchema.parse({
    id: row._id, number: row.number, createdAt, scheduledAt: row.pickup!.slot,
    orderStatus: 'ready', revision: 0, operator: null, assignmentId: null,
    assignedAt: null, dispatchedAt: null, deliveredAt: null, paymentReady: true,
    canAssign: true, canDispatch: false,
    paymentSummary: { totalCents: amount + 250, method: 'online', status: 'paid', tender: 'online' },
    customer: { name: row.pickup!.customerName, phone: null }, address, instructions: null,
    items: [{ name: product.name, variantName: null, qty: 1 }],
  });
  const operations = new Map<string, { input: DeliveryMissionAssign; result: DeliveryMissionResult }>();
  const ok = (body: unknown): TransportResponse => ({ status: 200, body: structuredClone(body) });
  const refuse = (status: number, code: string, message: string): TransportResponse => ({ status, body: { code, message } });
  return { send: request => serial.run(async () => {
    const [path, search = ''] = request.path.split('?');
    const query = new URLSearchParams(search);
    const method = request.method.toUpperCase();
    if (path === '/delivery/operators/available' && method === 'GET') {
      const parsed = DeliveryOperatorsQuerySchema.safeParse(Object.fromEntries(query));
      if (!parsed.success) return refuse(400, 'DELIVERY_MISSION_INVALID', 'Paramètres invalides.');
      return ok(DeliveryAvailableOperatorsViewSchema.parse({
        operators: operators.filter(operator => !parsed.data.after || operator.id > parsed.data.after)
          .map(operator => ({ ...operator, assignedCount: mission.operator?.id === operator.id ? 1 : 0, departedCount: 0 })),
        nextCursor: null,
      }));
    }
    if (path === `/delivery/missions/${row._id}` && method === 'GET') return ok(mission);
    if (path === `/delivery/missions/${row._id}/assignment` && method === 'POST') {
      const parsed = DeliveryMissionAssignSchema.safeParse(request.body);
      if (!parsed.success) return refuse(400, 'DELIVERY_MISSION_INVALID', 'Affectation invalide.');
      const input = parsed.data;
      const previous = operations.get(input.operationId);
      if (previous) {
        if (JSON.stringify(previous.input) !== JSON.stringify(input)) return refuse(409, 'DELIVERY_MISSION_OPERATION_CONFLICT', 'Cette référence correspond à une autre action.');
        return ok({ ...previous.result, replay: true, mission });
      }
      // La session démo est caisse : elle ne retire ni ne remplace un livreur.
      if (input.expectedRevision !== mission.revision) return refuse(409, 'DELIVERY_MISSION_CHANGED', 'La mission a changé. Actualisez avant de confirmer.');
      if (!input.operatorId || mission.operator) return refuse(403, 'FORBIDDEN', 'Seul un responsable peut modifier cette affectation.');
      const chosen = operators.find(operator => operator.id === input.operatorId && operator.revision === input.expectedOperatorRevision);
      const refusalCode = chosen ? null : 'DELIVERY_OPERATOR_CHANGED';
      mission = { ...mission, revision: mission.revision + 1,
        ...(chosen ? { operator: { id: chosen.id, name: chosen.name }, assignmentId: uuid(),
          assignedAt: new Date(now()).toISOString(), canAssign: false, canDispatch: true } : {}) };
      const result = DeliveryMissionResultSchema.parse({ operationId: input.operationId,
        appliedRevision: mission.revision, replay: false,
        outcome: refusalCode ? 'rejected' : 'applied', refusalCode, mission });
      operations.set(input.operationId, { input, result });
      return ok(result);
    }
    if (path === `/orders/${row._id}` && method === 'GET') return ok(row);
    if (path.startsWith(`/orders/${row._id}/`) || path.startsWith(`/delivery/missions/${row._id}/`)) {
      return refuse(409, 'DEMO_DELIVERY_ASSIGNMENT_ONLY', 'Cette démonstration permet l’affectation, sans départ ni remise simulés.');
    }
    const response = await base.send(request);
    if (method !== 'GET' || response.status !== 200 || !response.body || typeof response.body !== 'object') return response;
    const floor = Date.parse(query.get('since') ?? '');
    const included = (!query.has('status') || query.get('status') === row.status) &&
      (!Number.isFinite(floor) || Date.parse(createdAt) >= floor);
    if (!included) return response;
    if (path === '/orders/count' && 'total' in response.body && typeof response.body.total === 'number') {
      return { ...response, body: { ...response.body, total: response.body.total + 1 } };
    }
    if (path === '/orders' && 'rows' in response.body && Array.isArray(response.body.rows) &&
      'total' in response.body && typeof response.body.total === 'number') {
      const rows = [...response.body.rows as ServerOrderRow[], structuredClone(row)]
        .sort((a, b) => Date.parse(b.createdAt ?? '') - Date.parse(a.createdAt ?? '')).slice(0, 200);
      return { ...response, body: { ...response.body, rows, total: response.body.total + 1,
        truncated: response.body.total + 1 > rows.length } };
    }
    return response;
  }) };
}
