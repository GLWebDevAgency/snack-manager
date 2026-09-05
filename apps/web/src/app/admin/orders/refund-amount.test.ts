import { describe, expect, it } from 'vitest';
import { refundAmountCents, refundAmountInput } from './refund-amount';

describe('refund amount input', () => {
  it('preserves cent amounts with French and dot decimal separators', () => {
    expect(refundAmountCents('10,29')).toBe(1029);
    expect(refundAmountCents('0.01')).toBe(1);
    expect(refundAmountCents(refundAmountInput(1250))).toBe(1250);
  });
  it('refuses negative, fractional cents, exponent syntax and excessive amounts', () => {
    for (const input of ['-1', '0', '1.005', '1e2', 'Infinity', '1000001', '']) expect(refundAmountCents(input)).toBeNull();
  });
});
