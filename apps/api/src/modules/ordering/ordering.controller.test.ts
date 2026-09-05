import 'reflect-metadata';
import { ThrottlerGuard } from '@nestjs/throttler';
import { describe, expect, it, vi } from 'vitest';
import { OrderingController } from './ordering.controller';

describe('public order payment routes', () => {
  it('passes only the order ID and tracking token to the counter protocol', async () => {
    const payments = { switchToCounterPayment: vi.fn().mockResolvedValue({ _id: 'order' }) };
    const controller = new OrderingController({} as never, {} as never, payments as never, {} as never, {} as never);
    expect(await controller.counterPayment('order', { t: 'private-tracking-token' })).toEqual({ _id: 'order' });
    expect(payments.switchToCounterPayment).toHaveBeenCalledWith('order', 'private-tracking-token');
  });

  it.each(['counterPayment', 'paymentIntent'] as const)('keeps %s public, rate limited and an explicit POST', (name) => {
    const handler = OrderingController.prototype[name];
    expect(Reflect.getMetadata('isPublic', handler)).toBe(true);
    expect(Reflect.getMetadata('method', handler)).toBe(1); // Nest RequestMethod.POST
    expect(Reflect.getMetadata('__guards__', handler)).toContain(ThrottlerGuard);
    expect(Reflect.getMetadata('THROTTLER:LIMITdefault', handler)).toBe(30);
    expect(Reflect.getMetadata('THROTTLER:TTLdefault', handler)).toBe(60_000);
  });
});
