import { describe, expect, it, vi } from 'vitest';
import { TicketService } from './ticket.service';

const id = '507f1f77bcf86cd799439011', token = 'A'.repeat(32);
function service(table: boolean) {
  const row = { _id: id, tenantId: id, type: 'surplace', channel: 'pos', status: 'ready', number: 42,
    createdAt: new Date('2026-09-12T18:00:00Z'),
    dining: table ? { sessionId: 'private-session', tableId: 'private-table', tableLabel: 'Terrasse 3', servedAt: new Date() } : null,
    lines: [{ qty: 1, name: 'Kebab', options: [{ name: 'Sauce blanche', priceDelta: 0 }], removed: ['oignons'], note: 'Sauce à part', unitPrice: 1250, lineTotal: 1250 }],
    totals: { subtotal: 1250, total: 1250 }, payment: { method: 'counter', status: 'pending' } };
  return new TicketService({ findOne: vi.fn(() => ({ lean: vi.fn().mockResolvedValue(row) })) } as never,
    { findById: vi.fn(() => ({ lean: vi.fn().mockResolvedValue({ name: 'Restaurant de recette', slug: 'recette' }) })) } as never);
}
describe('table sur les tickets existants', () => {
  it('expose seulement le libellé historique et conserve les montants, options et paiement', async () => {
    const ticket = await service(true).build(id, token);
    expect(ticket.dining).toEqual({ tableLabel: 'Terrasse 3' });
    expect(JSON.stringify(ticket)).not.toContain('private-');
    expect(ticket.payment.paid).toBe(false); expect(ticket.totals.total).toBe(1250);
    expect(ticket.lines[0]).toMatchObject({ removed: ['oignons'], note: 'Sauce à part' });
  });
  it('imprime le repère de table en client et cuisine, sans prix sur le bon cuisine', async () => {
    const printer = service(true), ticket = await printer.build(id, token);
    const customer = printer.render(ticket).toString('latin1'), kitchen = printer.render(ticket, { variant: 'kitchen' }).toString('latin1');
    for (const output of [customer, kitchen]) { expect(output).toContain('TABLE : Terrasse 3'); expect(output).toContain('Kebab'); expect(output).toContain('sans oignons'); }
    expect(customer).toContain('12,50'); expect(kitchen).not.toContain('12,50');
  });
  it('la vente ordinaire sur place ne reçoit aucune table inventée', async () => {
    const printer = service(false), ticket = await printer.build(id, token);
    expect(ticket.dining).toBeUndefined(); expect(printer.render(ticket).toString('latin1')).not.toContain('TABLE :');
  });
});
