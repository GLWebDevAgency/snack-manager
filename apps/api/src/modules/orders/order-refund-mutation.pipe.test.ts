import { BadRequestException, ConflictException } from '@nestjs/common';
import { OrderRefundRequestSchema } from '@sm/contracts';
import { describe, expect, it } from 'vitest';
import { OrderRefundMutationPipe } from './order-refund-mutation.pipe';

const business = { operationId: 'a67cb3e8-a0e0-456e-b643-72d5f380102e', amountCents: 250,
  reason: 'Produit indisponible', password: 'local-password-fixture' };
const pipe = new OrderRefundMutationPipe();

describe('refund client protocol boundary', () => {
  it.each([
    business, null, undefined, [], 'invalid',
    ...[null, 0, '1', 2, true, {}, [1]].map(clientProtocolVersion => ({ ...business, clientProtocolVersion })),
    Object.assign(Object.create({ clientProtocolVersion: 1 }), business),
  ])('refuses an old or malformed protocol with a readable update instruction, case %#', value => {
    let error: unknown;
    try { pipe.transform(value); } catch (cause) { error = cause; }
    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getStatus()).toBe(409);
    expect((error as ConflictException).getResponse()).toEqual({ code: 'REFUND_CLIENT_UPDATE_REQUIRED',
      message: 'Actualisez cette page avant de demander un remboursement.' });
    expect(JSON.stringify((error as ConflictException).getResponse())).not.toContain(business.password);
  });

  it('strips only transport metadata and returns the exact strict business request without mutating the caller', () => {
    const input = Object.freeze({ ...business, clientProtocolVersion: 1 });
    const result = pipe.transform(input);
    expect(result).toEqual(business);
    expect(OrderRefundRequestSchema.parse(result)).toEqual(business);
    expect(result).not.toHaveProperty('clientProtocolVersion');
    expect(input.clientProtocolVersion).toBe(1);
  });

  it('preserves the existing business normalization and stable operation UUID', () => {
    expect(pipe.transform({ ...business, reason: ` ${business.reason} `, clientProtocolVersion: 1 })).toEqual(business);
  });

  it.each([
    { unexpected: true }, { amountCents: -1 }, { amountCents: 100_000_001 }, { amountCents: '250' },
    { reason: 'ab' }, { password: '' }, { operationId: 'invalid' },
  ])('uses strict business validation after protocol acceptance, case %#', patch => {
    expect(() => pipe.transform({ ...business, ...patch, clientProtocolVersion: 1 })).toThrow(BadRequestException);
  });
});
