import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CounterRefundRequestSchema, CounterRefundConfirmationSchema, CounterRefundNoEffectSchema, CounterRefundOperationViewSchema } from './order-counter-refunds';
const body = () => ({ operationId: randomUUID(), amountCents: 500, reason: 'Article retourné', tender: 'cash' as const,
  allocation: { version: 1, merchandiseCents: 500, deliveryCents: 0 }, clientProtocolVersion: 1,
  authorization: { kind: 'owner_password', password: randomUUID() } });
describe('counter refund protocol — immutable intent and explicit attestation', () => {
  it('accepts only the current explicit protocol and strips nothing silently', () => {
    expect(CounterRefundRequestSchema.parse(body()).clientProtocolVersion).toBe(1);
    for (const version of [undefined, 0, 2, '1', null]) expect(CounterRefundRequestSchema.safeParse({ ...body(), clientProtocolVersion: version }).success).toBe(false);
    expect(CounterRefundRequestSchema.safeParse({ ...body(), mayDisburse: true }).success).toBe(false);
  });
  it.each([0, -1, 0.5, 100_000_001, Number.NaN, Infinity])('rejects non-financial amount %s', amountCents => {
    expect(CounterRefundRequestSchema.safeParse({ ...body(), amountCents }).success).toBe(false);
  });
  it('requires the exact allocation and an authorization of only one type', () => {
    expect(CounterRefundRequestSchema.safeParse({ ...body(), allocation: { version: 1, merchandiseCents: 499, deliveryCents: 0 } }).success).toBe(false);
    expect(CounterRefundRequestSchema.safeParse({ ...body(), authorization: { kind: 'manager_pin', pin: '1234' } }).success).toBe(true);
    expect(CounterRefundRequestSchema.safeParse({ ...body(), authorization: { kind: 'manager_pin', pin: '1234', password: 'forbidden' } }).success).toBe(false);
  });
  it('distinguishes cash returned from a confirmed terminal refund', () => {
    expect(CounterRefundConfirmationSchema.safeParse({ ...body(), attestation: 'cash_returned' }).success).toBe(true);
    expect(CounterRefundConfirmationSchema.safeParse({ ...body(), attestation: 'terminal_refund_confirmed' }).success).toBe(false);
    expect(CounterRefundConfirmationSchema.safeParse({ ...body(), tender: 'card', attestation: 'terminal_refund_confirmed' }).success).toBe(true);
    expect(CounterRefundConfirmationSchema.safeParse({ ...body(), tender: 'card', attestation: 'cash_returned' }).success).toBe(false);
  });
  it('requires a deliberate reason and no-effect attestation, never a timeout shortcut', () => {
    expect(CounterRefundNoEffectSchema.safeParse({ ...body(), attestation: 'no_money_returned', resolutionReason: 'Aucun geste ni paiement en cours' }).success).toBe(true);
    for (const value of [{}, { attestation: 'timeout' }, { attestation: 'no_money_returned', resolutionReason: '  ' }]) {
      expect(CounterRefundNoEffectSchema.safeParse({ ...body(), ...value }).success).toBe(false);
    }
  });
});


describe('counter terminal receipt proof', () => {
  const receipt = () => ({ operationId: randomUUID(), amountCents: 500, reason: 'Retour produit', tender: 'cash',
    allocation: { version: 1, merchandiseCents: 500, deliveryCents: 0 }, state: 'confirmed',
    preparedAt: '2030-01-01T12:00:00.000Z', startedAt: '2030-01-01T12:00:01.000Z',
    disburseExpiresAt: '2030-01-01T12:05:01.000Z', confirmedAt: '2030-01-01T12:00:02.000Z',
    resolvedAt: null, resolutionReason: null, canResume: false });
  it('accepts a coherent confirmed physical act and refuses a terminal label alone', () => {
    expect(CounterRefundOperationViewSchema.safeParse(receipt()).success).toBe(true);
    for (const change of [{ confirmedAt: null }, { startedAt: null }, { disburseExpiresAt: null },
      { canResume: true }, { confirmedAt: '2030-01-01T11:59:59.000Z' }, { disburseExpiresAt: '2030-01-01T12:06:01.000Z' },
      { resolutionReason: 'Unexpected resolution' }, { reason: ' Retour produit ' }]) {
      expect(CounterRefundOperationViewSchema.safeParse({ ...receipt(), ...change }).success).toBe(false);
    }
  });
  it('only accepts a no-effect decision after permission expiry with its exact reason', () => {
    const value = { ...receipt(), state: 'not_executed', confirmedAt: null,
      resolvedAt: '2030-01-01T12:05:01.000Z', resolutionReason: 'Aucun geste ni paiement en cours' };
    expect(CounterRefundOperationViewSchema.safeParse(value).success).toBe(true);
    for (const change of [{ resolvedAt: null }, { resolutionReason: null }, { resolvedAt: '2030-01-01T12:05:00.999Z' }, { resolutionReason: ' Aucun geste ni paiement en cours ' }]) {
      expect(CounterRefundOperationViewSchema.safeParse({ ...value, ...change }).success).toBe(false);
    }
  });
  it('requires a withdrawn receipt to prove withdrawal before any start', () => {
    const value = { ...receipt(), state: 'withdrawn', startedAt: null, disburseExpiresAt: null, confirmedAt: null,
      resolvedAt: '2030-01-01T12:00:02.000Z' };
    expect(CounterRefundOperationViewSchema.safeParse(value).success).toBe(true);
    expect(CounterRefundOperationViewSchema.safeParse({ ...value, resolvedAt: null }).success).toBe(false);
    expect(CounterRefundOperationViewSchema.safeParse({ ...value, startedAt: receipt().startedAt }).success).toBe(false);
  });
});
