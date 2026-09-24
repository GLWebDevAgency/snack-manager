import { describe, expect, it } from 'vitest';
import { CUSTOMER_ACCOUNT_CLOCK_SKEW_MS, customerAccountTimestampWithinFutureBound } from './customer-account-timing';

describe('customer account response clock bound', () => {
  const now = 1_790_033_832_721;
  it.each([0, 35, 30_000])('accepts a future bound with %d ms of clock difference', skew => {
    expect(customerAccountTimestampWithinFutureBound(now + 600_000 + skew, now, 600_000)).toBe(true);
  });
  it('refuses one millisecond beyond the explicit tolerance', () => {
    expect(CUSTOMER_ACCOUNT_CLOCK_SKEW_MS).toBe(30_000);
    expect(customerAccountTimestampWithinFutureBound(now + 630_001, now, 600_000)).toBe(false);
  });
  it('supports a zero-ahead proof timestamp without granting a lifetime', () => {
    expect(customerAccountTimestampWithinFutureBound(now + 30_000, now, 0)).toBe(true);
    expect(customerAccountTimestampWithinFutureBound(now + 30_001, now, 0)).toBe(false);
  });
  it('leaves expiry and terminal-state validation to callers', () => {
    expect(customerAccountTimestampWithinFutureBound(now - 1, now, 600_000)).toBe(true);
    expect(customerAccountTimestampWithinFutureBound(0, 0, 0)).toBe(true);
  });
  it.each([NaN, Infinity, -Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER + 1])('refuses invalid argument %s in every position', value => {
    expect(customerAccountTimestampWithinFutureBound(value, now, 600_000)).toBe(false);
    expect(customerAccountTimestampWithinFutureBound(now, value, 600_000)).toBe(false);
    expect(customerAccountTimestampWithinFutureBound(now, now, value)).toBe(false);
  });
  it.each([null, undefined, '1790033832721'])('does not coerce an untyped argument %s', value => {
    expect(customerAccountTimestampWithinFutureBound(value as never, now, 600_000)).toBe(false);
    expect(customerAccountTimestampWithinFutureBound(now, value as never, 600_000)).toBe(false);
    expect(customerAccountTimestampWithinFutureBound(now, now, value as never)).toBe(false);
  });
  it('does not overflow at safe integer boundaries', () => {
    const max = Number.MAX_SAFE_INTEGER;
    expect(customerAccountTimestampWithinFutureBound(max, max - 30_000, 0)).toBe(true);
    expect(customerAccountTimestampWithinFutureBound(max, max - 30_001, 0)).toBe(false);
    expect(customerAccountTimestampWithinFutureBound(max, 0, max)).toBe(true);
    expect(customerAccountTimestampWithinFutureBound(0, max, max)).toBe(true);
  });
});
