import { Mongoose } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { OrderSchema } from './schemas';
import { DeliveryHandoffSchema } from './delivery-handoff.schema';

const uuid = 'b0b336b8-d64b-4a0e-b3d3-e30aa158ba8d';
const operation = { operationId: uuid, intentFingerprint: 'a'.repeat(64), fingerprint: 'b'.repeat(64),
  action: 'handoff', outcome: 'rejected', refusalCode: 'proof_incorrect', revision: 2,
  expectedRevision: 1, expectedMissionRevision: 1, at: new Date(), actorKind: 'delivery', actorId: 'operator-fixture' };
const state = { version: 1, revision: 2, proof: { id: uuid, sealed: 'encrypted-fixture', createdAt: new Date(),
  expiresAt: new Date(), failedAttempts: 1, assignmentId: uuid }, operations: [operation] };

describe('remise privée embarquée dans Order', () => {
  it('ne fabrique ni preuve ni protocole pour les anciennes commandes', () => {
    const Order = new Mongoose().model('HandoffLegacy', OrderSchema.clone());
    expect(new Order().get('deliveryHandoff')).toBeNull();
  });
  it('cache le champ dans les lectures ordinaires et toutes les sérialisations hydratées', () => {
    const Order = new Mongoose().model('HandoffPrivacy', OrderSchema.clone());
    const order = new Order({ deliveryHandoff: state });
    expect(order.get('deliveryHandoff.proof.sealed')).toBe('encrypted-fixture');
    expect(OrderSchema.path('deliveryHandoff').options.select).toBe(false);
    expect(order.toObject()).not.toHaveProperty('deliveryHandoff');
    expect(order.toJSON()).not.toHaveProperty('deliveryHandoff');
    expect(JSON.stringify(order)).not.toContain('encrypted-fixture');
  });
  it('valide une preuve complète et un tombstone sans empreinte de secret', () => {
    const Handoff = new Mongoose().model('HandoffValid', DeliveryHandoffSchema.clone());
    expect(new Handoff(state).validateSync()).toBeUndefined();
    expect(new Handoff({ ...state, operations: [{ ...operation, outcome: 'abandoned', refusalCode: 'abandoned', fingerprint: null }] }).validateSync()).toBeUndefined();
  });
  it.each([-1, 0.5, Number.MAX_SAFE_INTEGER + 1])('refuse les révisions non sûres %s', revision => {
    const Handoff = new Mongoose().model('HandoffRevision', DeliveryHandoffSchema.clone());
    expect(new Handoff({ ...state, revision }).validateSync()?.errors.revision).toBeDefined();
  });
  it.each([-1, 1.5, 6])('borne les essais incorrects %s', failedAttempts => {
    const Handoff = new Mongoose().model('HandoffFailures', DeliveryHandoffSchema.clone());
    expect(new Handoff({ ...state, proof: { ...state.proof, failedAttempts } }).validateSync()?.errors['proof.failedAttempts']).toBeDefined();
  });
  it('refuse la 65e opération sans tronquer les preuves anciennes', () => {
    const Handoff = new Mongoose().model('HandoffLimit', DeliveryHandoffSchema.clone());
    const doc = new Handoff({ ...state, operations: Array(65).fill(operation) });
    expect(doc.validateSync()?.errors.operations).toBeDefined();
    expect(doc.operations).toHaveLength(65);
  });
});
