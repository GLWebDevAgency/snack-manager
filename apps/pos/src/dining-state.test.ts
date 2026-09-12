import { describe, expect, it } from 'vitest';
import type { DiningSession } from '@sm/contracts';
import type { ServerOrderRow } from './service-state';
import { canReleaseDiningSession } from './dining-state';

const session: DiningSession = { id: 'session', tableId: 'table', tableLabel: 'Terrasse', guestCount: 2, revision: 0, state: 'open', openedAt: '2026-09-12T18:00:00Z', closedAt: null, orderIds: ['order'], pendingOperationCount: 0 };
const row: ServerOrderRow = { _id: 'order', clientId: 'client', number: 42, status: 'ready', payment: { method: 'counter', status: 'paid' }, dining: { sessionId: 'session', tableId: 'table', tableLabel: 'Terrasse', servedAt: '2026-09-12T18:01:00Z' } };
describe('libération de la salle', () => {
  it('exige tous les tickets et toutes les admissions confirmés', () => {
    expect(canReleaseDiningSession(session, null)).toBe(false);
    expect(canReleaseDiningSession(session, [])).toBe(false);
    expect(canReleaseDiningSession(session, [{ ...row, _id: 'autre' }])).toBe(false);
    expect(canReleaseDiningSession({ ...session, pendingOperationCount: 1 }, [row])).toBe(false);
    expect(canReleaseDiningSession({ ...session, state: 'closed' }, [row])).toBe(false);
    expect(canReleaseDiningSession({ ...session, orderIds: [] }, [])).toBe(true);
  });
  it('finalise un ticket servi et payé, sans assimiler remboursé à encaissé', () => {
    expect(canReleaseDiningSession(session, [row])).toBe(true);
    expect(canReleaseDiningSession(session, [{ ...row, dining: null }])).toBe(false);
    for (const status of ['pending', 'refunded']) expect(canReleaseDiningSession(session, [{ ...row, payment: { method: 'counter', status } }])).toBe(false);
  });
  it('permet le remboursement après remise terminale et conserve l’annulation existante', () => {
    expect(canReleaseDiningSession(session, [{ ...row, status: 'delivered', payment: { method: 'counter', status: 'refunded' } }])).toBe(true);
    expect(canReleaseDiningSession(session, [{ ...row, status: 'cancelled', payment: { method: 'counter', status: 'pending' } }])).toBe(true);
    expect(canReleaseDiningSession(session, [{ ...row, status: 'delivered', payment: { method: 'counter', status: 'pending' } }])).toBe(false);
  });
});
