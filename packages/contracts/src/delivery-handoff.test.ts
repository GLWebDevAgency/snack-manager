import { describe, expect, it } from 'vitest';
import { DeliveryHandoffSubmitSchema, DeliveryProofRequestSchema, DeliveryHandoffResolveSchema,
  DeliveryHandoffStateSchema, DeliveryHandoffReasonSchema, parseDeliveryHandoffQr } from './delivery-handoff';

const orderId = 'a'.repeat(24);
const proofId = '11111111-1111-4111-8111-111111111111';
const base = { operationId: proofId, expectedRevision: 1, expectedMissionRevision: 2 };
const qr = `sm-handoff:v1:${orderId}:${proofId}:${'a'.repeat(43)}`;
describe('strict delivery handoff contracts', () => {
  it('accepts a zero-prefixed PIN and exact dedicated QR', () => {
    expect(DeliveryHandoffSubmitSchema.parse({ ...base, proof: { kind: 'pin', value: '000012' } }).proof.value).toBe('000012');
    expect(DeliveryHandoffSubmitSchema.safeParse({ ...base, proof: { kind: 'qr', value: qr } }).success).toBe(true);
    expect(parseDeliveryHandoffQr(qr)).toEqual({ orderId, proofId, token: 'a'.repeat(43) });
  });
  it.each(['12345', '1234567', ' 123456', '１２３４５６', '123a56', 123456])('rejects malformed PIN %s', value => {
    expect(DeliveryHandoffSubmitSchema.safeParse({ ...base, proof: { kind: 'pin', value } }).success).toBe(false);
  });
  it.each(['https://example.test/loyalty?token=private', '123456', `${qr}?next=foo`, `${qr}\n`, qr.replace('v1', 'v2'), qr.replace(proofId, '-'.repeat(36))])('scanner never navigates or accepts another protocol', value => {
    expect(parseDeliveryHandoffQr(value)).toBeNull();
  });
  it('rejects forged authors/tenants and secrets in a resolve envelope', () => {
    for (const extra of [{ tenantId: orderId }, { actorId: orderId }, { proof: { kind: 'pin', value: '123456' } }, { reason: 'secret' }]) {
      expect(DeliveryHandoffResolveSchema.safeParse({ ...base, action: 'handoff', ...extra }).success).toBe(false);
    }
    expect(DeliveryHandoffResolveSchema.safeParse({ ...base, action: 'delivered' }).success).toBe(false);
  });
  it('requires a purchaser recovery proof, not a tracking token', () => {
    expect(DeliveryProofRequestSchema.safeParse({ clientId: proofId, recoveryProof: 'b'.repeat(64) }).success).toBe(true);
    expect(DeliveryProofRequestSchema.safeParse({ clientId: proofId, trackingToken: 'b'.repeat(32) }).success).toBe(false);
  });
  it('requires an explicit meaningful override/rotation reason', () => {
    expect(DeliveryHandoffReasonSchema.safeParse({ ...base, reason: '  ok  ' }).success).toBe(false);
    expect(DeliveryHandoffReasonSchema.parse({ ...base, reason: '  Remise constatée par le responsable  ' }).reason).toBe('Remise constatée par le responsable');
  });
  it('rejects unsafe revisions', () => {
    for (const expectedRevision of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, Infinity, '1']) {
      expect(DeliveryHandoffResolveSchema.safeParse({ ...base, expectedRevision, action: 'handoff' }).success).toBe(false);
    }
  });
  it('operational state cannot contain a customer secret', () => {
    const state = { missionId: orderId, revision: 0, missionRevision: 0, orderStatus: 'ready', proof: null, incident: null,
      canHandoff: false, canOverride: false, canRotate: false };
    expect(DeliveryHandoffStateSchema.safeParse(state).success).toBe(true);
    for (const key of ['pin', 'qr', 'recoveryProof', 'trackingToken', 'customer']) {
      expect(DeliveryHandoffStateSchema.safeParse({ ...state, [key]: 'private' }).success).toBe(false);
    }
  });
});
