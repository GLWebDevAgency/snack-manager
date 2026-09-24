import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { CustomerLoyaltyMemberSchema, CustomerLoyaltyResponseSchema } from '@sm/contracts';
import { CustomerAccountController } from './customer-account.controller';
import type { CustomerAccountRequest } from './customer-account.guard';
import type { CustomerAccountRuntime } from './customer-account.runtime';

const legacyMember = CustomerLoyaltyMemberSchema.omit({ reservedUnits: true });
describe('customer loyalty controller response compatibility', () => {
  it.each(['member', 'card'] as const)('keeps strict legacy %s responses and exposes reserved units only after opt-in', async state => {
    const result = { state, member: { id: randomUUID(), joinedAt: '2026-09-01T00:00:00.000Z', qrGeneration: 1,
      balanceUnits: 100, reservedUnits: 60, unitLabelSingular: 'point', unitLabelPlural: 'points' },
    expiresAt: Date.now() + 60_000, ...(state === 'card' ? { qrToken: 'A'.repeat(43) } : {}) };
    const original = structuredClone(result);
    const execute = vi.fn().mockResolvedValue(result);
    const controller = new CustomerAccountController({ execute } as unknown as CustomerAccountRuntime);
    for (const optIn of [false, true]) {
      const request = { customerRelay: { slug: 'fixture', action: 'loyalty' }, body: { browserRef: randomUUID(),
        browserSecret: Buffer.alloc(32, 1).toString('base64url'), sessionToken: Buffer.alloc(32, 2).toString('base64url'),
        expectedOperationId: randomUUID(), expectedCheckId: randomUUID(), request: { step: state === 'card' ? 'card' : 'view' },
        ...(optIn ? { orderRewards: 1 } : {}) } } as CustomerAccountRequest;
      const response = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      await controller.action(request, response as never);
      expect(response.status).toHaveBeenCalledWith(200);
      const output = CustomerLoyaltyResponseSchema.parse(response.json.mock.calls[0]![0]);
      expect('member' in output).toBe(true);
      if (!('member' in output)) throw Error('Missing member fixture');
      expect(legacyMember.safeParse(output.member).success).toBe(!optIn);
      expect(output.member.balanceUnits).toBe(100);
      if (optIn) expect(output.member.reservedUnits).toBe(60);
      else expect(output.member).not.toHaveProperty('reservedUnits');
    }
    expect(result).toEqual(original);
    expect(execute).toHaveBeenCalledTimes(2);
  });
});
