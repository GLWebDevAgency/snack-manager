import { NotFoundException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { OrdersService } from './orders.service';
import { TicketService } from '../ordering/ticket.service';

/**
 * Fuite RGPD corrigée ici : `/public/orders/:id`, `…/ticket` et `…/escpos`
 * livraient le nom et le téléphone du client à qui connaissait l'ObjectId — or
 * un ObjectId Mongo est partiellement prévisible (horodatage + compteur).
 *
 * Les tests vérifient la conséquence observable : sans jeton, la route se
 * comporte comme si la commande n'existait pas.
 */

const ORDER_ID = '68a3f1c2b4d5e6f7a8b9c0d1';
const TOKEN = 'jeton-de-suivi-non-devinable';

const ORDER = {
  _id: ORDER_ID,
  tenantId: 'tenant-1',
  number: 42,
  status: 'preparing',
  statusHistory: [{ status: 'new', at: new Date('2026-08-18T17:00:00Z') }],
  createdAt: new Date('2026-08-18T17:00:00Z'),
  channel: 'online',
  type: 'pickup',
  lines: [],
  totals: { subtotal: 1250, discount: null, total: 1250 },
  payment: { method: 'counter', tender: null, status: 'pending' },
  // La donnée personnelle que le jeton protège.
  pickup: {
    slot: new Date('2026-08-18T18:30:00Z'),
    customerName: 'Camille Diallo',
    customerPhone: '06 12 34 56 78',
  },
  trackingToken: TOKEN,
  note: null,
};

/** Modèle Mongoose réduit à ce que les services appellent réellement. */
function ordersModel() {
  return {
    findOne: (filter: { _id?: string; trackingToken?: string }) => ({
      lean: async () =>
        filter._id === ORDER._id && filter.trackingToken === ORDER.trackingToken ? ORDER : null,
    }),
  };
}

function trackingService() {
  return new OrdersService(
    ordersModel() as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
}

function ticketService() {
  const tenants = {
    findById: () => ({
      lean: async () => ({ name: 'Class Food', slug: 'classfood', address: '', phones: [] }),
    }),
  };
  return new TicketService(ordersModel() as never, tenants as never);
}

describe('GET /public/orders/:id — suivi', () => {
  it('renvoie le suivi quand le jeton est bon', async () => {
    const tracking = await trackingService().publicTracking(ORDER_ID, TOKEN);

    expect(tracking.number).toBe(42);
    expect(tracking.status).toBe('preparing');
    // La projection de suivi ne porte ni nom ni téléphone, même avec le jeton.
    expect(JSON.stringify(tracking)).not.toContain('Camille');
  });

  it('renvoie 404 sans jeton — et non 403, qui confirmerait la commande', async () => {
    await expect(trackingService().publicTracking(ORDER_ID, undefined)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('renvoie 404 avec un jeton faux', async () => {
    await expect(trackingService().publicTracking(ORDER_ID, 'devine')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('GET /public/orders/:id/ticket — récapitulatif nominatif', () => {
  it('sans jeton, le ticket est introuvable', async () => {
    await expect(ticketService().build(ORDER_ID, undefined)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('avec le jeton, le client retrouve son nom et son téléphone', async () => {
    const ticket = await ticketService().build(ORDER_ID, TOKEN);

    expect(ticket.pickup?.customerName).toBe('Camille Diallo');
    expect(ticket.pickup?.customerPhone).toBe('06 12 34 56 78');
  });
});
