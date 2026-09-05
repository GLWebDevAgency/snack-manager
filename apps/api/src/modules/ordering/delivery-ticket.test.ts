import { describe, expect, it, vi } from 'vitest';
import { TicketService } from './ticket.service';

const id = '507f1f77bcf86cd799439011';
const token = 'A'.repeat(32);
const order = {
  _id: id, tenantId: id, type: 'delivery', channel: 'online', status: 'ready', number: 12,
  lines: [], totals: { subtotal: 1800, deliveryFee: 250, total: 2050 },
  payment: { method: 'online', status: 'paid' },
  pickup: { slot: new Date('2026-09-06T18:00:00.000Z'), customerName: 'Camille', customerPhone: '0612345678' },
  delivery: { address: { line1: '12 rue des Fleurs', postalCode: '69001', city: 'Lyon', country: 'FR' }, zoneId: 'centre', zoneName: 'Centre', feeCents: 250, estimatedMinutes: 45, instructions: 'Sonner au 2e' },
};

describe('ticket de livraison', () => {
  it('expose adresse et frais sur le ticket protégé et les imprime sans annoncer un retrait', async () => {
    const orders = { findOne: vi.fn(() => ({ lean: vi.fn().mockResolvedValue(order) })) };
    const tenants = { findById: vi.fn(() => ({ lean: vi.fn().mockResolvedValue({ name: 'Classfood', slug: 'classfood' }) })) };
    const service = new TicketService(orders as never, tenants as never);
    const ticket = await service.build(id, token);
    expect(ticket).toMatchObject({ typeLabel: 'Livraison', totals: { deliveryFee: 250 }, delivery: { address: { postalCode: '69001' } } });
    const printed = service.render(ticket).toString('latin1');
    expect(printed).toContain('12 rue des Fleurs');
    expect(printed).toContain('69001 Lyon');
    expect(printed).toContain('Livraison');
    expect(printed).not.toContain('Retrait 20:00');
  });
});
