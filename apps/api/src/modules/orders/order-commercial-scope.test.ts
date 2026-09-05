import { describe, expect, it, vi } from 'vitest';
import type { JwtPayload } from '@sm/contracts';
import { OrdersService } from './orders.service';

const TENANT = '665f0d0a1c2b3d4e5f6a0001';
const ID = '665f0d0a1c2b3d4e5f6a0002';
const actor: JwtPayload = { sub: 'owner1', tenantId: TENANT, role: 'owner', kind: 'user' };

function setup(capabilities: string[], channel = 'online') {
  const row = { _id: ID, tenantId: TENANT, channel, status: 'new', number: 1,
    totals: { total: 1250 }, payment: { status: 'pending' }, statusHistory: [] as unknown[],
    save: vi.fn(async () => undefined), toObject: () => ({ _id: ID, channel }) };
  const findOne = vi.fn(async (filter: Record<string, unknown>) =>
    Object.entries(filter).every(([key, value]) => (row as Record<string, unknown>)[key] === value) ? row : null);
  const find = vi.fn(() => ({ sort: () => ({ limit: () => ({ lean: async () => [] }) }) }));
  const countDocuments = vi.fn(async () => 0);
  const audit = { log: vi.fn(async (_entry: unknown) => undefined) };
  const service = new OrdersService(
    { findOne, find, countDocuments } as never, {} as never, {} as never, {} as never,
    { publish: vi.fn(async () => 1) } as never, audit as never, {} as never,
    { pourTenant: async () => capabilities } as never,
  );
  return { service, row, findOne, find, countDocuments, audit };
}

describe('online standalone order access', () => {
  it('scopes lists and counts to online orders', async () => {
    const { service, find, countDocuments } = setup(['online']);
    await service.list(TENANT, {});
    await service.count(TENANT, {});
    expect(find).toHaveBeenCalledWith({ tenantId: TENANT, channel: 'online' });
    expect(countDocuments).toHaveBeenCalledWith({ tenantId: TENANT, channel: 'online' });
  });
  it('does not expose an old POS order by its identifier', async () => {
    const { service, row } = setup(['online'], 'pos');
    await expect(service.byId(TENANT, ID)).rejects.toThrow('introuvable');
    await expect(service.updateStatus(TENANT, ID, 'preparing', 'owner1')).rejects.toThrow('introuvable');
    await expect(service.cancelAsOwner(TENANT, ID, actor, 'Erreur client')).rejects.toThrow('introuvable');
    expect(row.save).not.toHaveBeenCalled();
  });
  it('refuses even known order identifiers without a command capability', async () => {
    const { service, findOne } = setup(['loyalty']);
    await expect(service.byId(TENANT, ID)).rejects.toThrow('offre');
    expect(findOne).not.toHaveBeenCalled();
  });
  it('keeps POS orders available with the complete back office', async () => {
    const { service, row } = setup(['bo'], 'pos');
    expect(await service.byId(TENANT, ID)).toBe(row);
  });
  it('cancels an online order with a confirmed owner identity and no staff record', async () => {
    const { service, row, audit } = setup(['online']);
    await service.cancelAsOwner(TENANT, ID, actor, 'Erreur client');
    expect(row.status).toBe('cancelled');
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ actor, action: 'order.cancel' }));
    expect(audit.log.mock.calls[0]?.[0]).not.toHaveProperty('staffId');
  });
});
