import { mongo } from 'mongoose';
import type { BootstrapAdmissionEvidence, BootstrapFrozenDay, BootstrapOrderEvidence } from './order-capacity-bootstrap.types';

type Document = Record<string, unknown>;
const INVALID = '__invalid_persisted_capacity_value__';

/** Projections natives : ne charger ni coordonnées, ni lignes/prix, ni tokens.
 * $type conserve absent/null/objet/corrompu sans hydrate ni cast de date.
 * https://www.mongodb.com/docs/manual/reference/operator/aggregation/type/
 */
function malformed(path: string): Document {
  return { $cond: [{ $eq: [{ $type: path }, 'missing'] }, '$$REMOVE',
    { $cond: [{ $eq: [{ $type: path }, 'null'] }, null, { $literal: INVALID }] }] };
}
function object(path: string, fields: Document): Document {
  return { $cond: [{ $eq: [{ $type: path }, 'object'] }, fields, malformed(path)] };
}
function fields(path: string, names: string[]): Document {
  return Object.fromEntries(names.map((name) => [name, `${path}.${name}`]));
}
function array(path: string, entry: Document): Document {
  return { $cond: [{ $isArray: path }, { $map: { input: path, as: 'entry', in: object('$$entry', entry) } }, malformed(path)] };
}
function recovery(path: string): Document { return object(path, fields(path, ['version', 'proofHash', 'payloadHash'])); }
function order(path: string): Document {
  return { ...fields(path, ['_id', 'tenantId', 'clientId', 'channel', 'type', 'status']),
    pickup: object(`${path}.pickup`, fields(`${path}.pickup`, ['slot'])),
    publicRecovery: recovery(`${path}.publicRecovery`) };
}
function plan(path: string): Document {
  return { ...fields(path, ['day', 'sourceRevision', 'closedReason']),
    slots: array(`${path}.slots`, fields('$$entry', ['at', 'kitchenCapacity', 'deliveryCapacity'])) };
}

export const CAPACITY_BOOTSTRAP_PROJECTIONS = {
  tenant: {
    _id: 1,
    settings: object('$settings', fields('$settings', ['slotIntervalMin', 'slotCapacity'])),
    delivery: object('$delivery', fields('$delivery', ['slotCapacity'])),
    hours: array('$hours', { day: '$$entry.day',
      lunch: object('$$entry.lunch', fields('$$entry.lunch', ['open', 'close'])),
      dinner: object('$$entry.dinner', fields('$$entry.dinner', ['open', 'close'])) }),
    closures: array('$closures', fields('$$entry', ['from', 'to'])),
    capacityControl: object('$capacityControl', { ...fields('$capacityControl', ['version', 'state', 'bootstrapId', 'cutoverAt', 'configRevision']),
      dayIntent: object('$capacityControl.dayIntent', { ...plan('$capacityControl.dayIntent'),
        ...fields('$capacityControl.dayIntent', ['operationId', 'planHash']) }) }),
  },
  orders: order('$$ROOT'),
  admissions: {
    ...fields('$$ROOT', ['_id', 'tenantId', 'clientId', 'version', 'kind', 'channel', 'state', 'slot', 'orderId', 'proofHash', 'payloadHash']),
    snapshot: object('$snapshot', order('$snapshot')),
    capacity: object('$capacity', fields('$capacity', ['slot', 'kitchenSeat', 'deliverySeat', 'releasedAt'])),
  },
  days: { _id: 1, tenantId: 1, state: 1, ...plan('$$ROOT') },
} as const;

function record(value: unknown): value is Document { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function bsonId(value: unknown): unknown {
  // Un ID texte en base n'est pas un ObjectId : le convertir masquerait une
  // dérive du type BSON et une différence de filtrage/reprise côté writer.
  return value instanceof mongo.ObjectId ? value.toHexString() : INVALID;
}
function orderFootprint(value: unknown): unknown {
  if (!record(value)) return value;
  return { orderId: bsonId(value._id), tenantId: bsonId(value.tenantId), clientId: value.clientId,
    channel: value.channel, type: value.type, status: value.status,
    slot: value.pickup == null ? null : record(value.pickup) ? value.pickup.slot : INVALID,
    publicRecovery: value.publicRecovery };
}

// Frontière volontairement brute : seuls les vrais ObjectId deviennent hex.
// Les autres formes sont conservées/refusées par l'analyseur, pas réparées.
export function bootstrapOrderProjection(value: Document): BootstrapOrderEvidence {
  return orderFootprint(value) as BootstrapOrderEvidence;
}
export function bootstrapAdmissionProjection(value: Document): BootstrapAdmissionEvidence {
  return { admissionId: value._id, tenantId: bsonId(value.tenantId), clientId: value.clientId,
    version: value.version, kind: value.kind, channel: value.channel, state: value.state, slot: value.slot,
    orderId: value.orderId == null ? value.orderId : bsonId(value.orderId), proofHash: value.proofHash, payloadHash: value.payloadHash,
    snapshot: orderFootprint(value.snapshot), capacity: value.capacity } as BootstrapAdmissionEvidence;
}
export function bootstrapDayProjection(value: Document): BootstrapFrozenDay {
  return { tenantId: bsonId(value.tenantId), day: value.day, state: value.state,
    sourceRevision: value.sourceRevision, closedReason: value.closedReason, slots: value.slots } as BootstrapFrozenDay;
}
