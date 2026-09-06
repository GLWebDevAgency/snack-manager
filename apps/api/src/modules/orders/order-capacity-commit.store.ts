import { ServiceUnavailableException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Model } from 'mongoose';
import { ORDER_CAPACITY_DAY_INDEX, ORDER_CAPACITY_INDEXES, type Order, type OrderCapacityDay, type PublicOrderAdmission } from '@sm/db';
import { formatDay, parisYmd } from '../ordering/paris-time';
import { recoveryNotFound, sameRecoveryHash, type PublicRecoveryBinding } from './order-recovery';
import { PublicOrderSnapshotInvalid } from './public-order-admission.service';

const DURABLE = { writeConcern: { w: 'majority' as const, j: true, wtimeout: 10_000 } };
const PRIVATE = '+proofHash +payloadHash +validationOwner +capacity';
const MAX_CONTENTION_ATTEMPTS = 101;

export type CapacityCommitResult = {
  state: 'committing' | 'created' | 'rejected' | 'full' | 'stale';
  orderId?: string;
};

function uncertain() {
  return new ServiceUnavailableException({ code: 'ORDER_CAPACITY_UNCERTAIN',
    message: 'La réservation reste à vérifier. Conservez la même tentative de commande.' });
}

function idOf(tenantId: string, clientId: string): string {
  return createHash('sha256').update(JSON.stringify(['sm.order-admission.v1', tenantId, clientId])).digest('hex');
}

function terminal(admission: PublicOrderAdmission): CapacityCommitResult | null {
  if (admission.state === 'rejected') return { state: 'rejected' };
  if (admission.state === 'committing' || admission.state === 'created') {
    if (!admission.orderId) throw uncertain();
    return { state: admission.state, orderId: String(admission.orderId) };
  }
  return null;
}

function firstFree(occupied: Set<number>, capacity: number): number | null {
  // Compter aussi les sièges hors plage : un ancien surbooking ne devient pas
  // disponible après réduction de capacité ou import d'un historique invalide.
  if (occupied.size >= capacity) return null;
  for (let seat = 0; seat < capacity; seat++) if (!occupied.has(seat)) return seat;
  return null;
}

function capacityCollision(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const detail = error as { code?: number; keyPattern?: Record<string, unknown> };
  return detail.code === 11000 && ORDER_CAPACITY_INDEXES.some(({ field }) =>
    detail.keyPattern?.tenantId === 1 && detail.keyPattern?.['capacity.slot'] === 1
      && detail.keyPattern?.[`capacity.${field}`] === 1 && Object.keys(detail.keyPattern).length === 3);
}

/**
 * C15-A : primitive préparatoire, volontairement absente des providers Nest.
 * Ne PAS la brancher seule au checkout : tous les writers (dont POS téléphone)
 * et l'historique doivent partager l'admission/calendrier avant activation C15-B.
 *
 * Aucun verrou/TTL ne décide de la capacité : snapshot et deux places sont
 * engagés par le même CAS dans l'admission, sous deux index uniques Mongo.
 * Un abandon gagne avant ce CAS, ou perd contre lui. Jamais de réservation
 * orpheline séparée de la décision de créer la commande.
 */
export class OrderCapacityCommitStore {
  constructor(
    private readonly admissions: Model<PublicOrderAdmission>,
    private readonly orders: Model<Order>,
    private readonly days: Model<OrderCapacityDay>,
  ) {}

  async commit(tenantId: string, clientId: string, binding: PublicRecoveryBinding,
    candidate: Record<string, unknown>): Promise<CapacityCommitResult> {
    const id = idOf(tenantId, clientId);
    const admission = await this.authenticated(id, binding);
    if (String(candidate.tenantId) !== tenantId || candidate.clientId !== clientId || candidate.channel !== 'online') {
      throw new PublicOrderSnapshotInvalid();
    }
    const now = new Date();
    const document = new this.orders({ ...candidate, publicRecovery: binding, createdAt: now, updatedAt: now, __v: 0 });
    try { await document.validate(); } catch { throw new PublicOrderSnapshotInvalid(); }
    const snapshot = document.toObject({ transform: false });
    const slot = snapshot.pickup?.slot;
    if (!slot || slot.getTime() !== admission.slot.getTime()) throw new PublicOrderSnapshotInvalid();
    const observedTerminal = terminal(admission);
    if (observedTerminal) return observedTerminal;
    if (!binding.validationOwner || admission.validationOwner !== binding.validationOwner) return { state: 'stale' };

    const day = await this.days.findOne({ tenantId, day: formatDay(parisYmd(slot)), state: 'ready' })
      .read('primary').readConcern('majority').maxTimeMS(10_000).lean();
    const capacity = day?.slots.find((entry) => entry.at.getTime() === slot.getTime());
    if (!capacity || !Number.isInteger(capacity.kitchenCapacity) || capacity.kitchenCapacity < 1 || capacity.kitchenCapacity > 100
      || !Number.isInteger(capacity.deliveryCapacity) || capacity.deliveryCapacity < 1 || capacity.deliveryCapacity > 50) throw uncertain();
    // Le calendrier n'est pas déduit des settings courants. Son ouverture sera
    // autorisée uniquement par le bootstrap vérifié du futur lot C15-B.
    await this.assertIndexes();
    const delivery = snapshot.type === 'delivery';

    for (let attempt = 0; attempt < MAX_CONTENTION_ATTEMPTS; attempt++) {
      const current = await this.authenticated(id, binding);
      const result = terminal(current);
      if (result) return result;
      if (current.validationOwner !== binding.validationOwner) return { state: 'stale' };
      const occupants = await this.admissions.find({ tenantId, 'capacity.slot': slot,
        $or: [{ 'capacity.kitchenSeat': { $type: 'number' } }, { 'capacity.deliverySeat': { $type: 'number' } }] })
        .select('+capacity').read('primary').readConcern('majority').maxTimeMS(10_000).limit(151).lean();
      if (occupants.length > 150) throw uncertain();
      const kitchenSeats = new Set<number>();
      const deliverySeats = new Set<number>();
      for (const occupant of occupants) {
        if (typeof occupant.capacity?.kitchenSeat === 'number') kitchenSeats.add(occupant.capacity.kitchenSeat);
        if (typeof occupant.capacity?.deliverySeat === 'number') deliverySeats.add(occupant.capacity.deliverySeat);
      }
      const kitchenSeat = firstFree(kitchenSeats, capacity.kitchenCapacity);
      const deliverySeat = delivery ? firstFree(deliverySeats, capacity.deliveryCapacity) : null;
      if (kitchenSeat === null || (delivery && deliverySeat === null)) {
        // Une lecture de capacité pleine ne décide pas du sort d'un CAS de ce
        // même candidat potentiellement déjà engagé par un autre helper.
        const reread = await this.authenticated(id, binding);
        return terminal(reread) ?? (reread.validationOwner === binding.validationOwner ? { state: 'full' } : { state: 'stale' });
      }
      try {
        await this.admissions.updateOne({ _id: id, tenantId, clientId, slot, state: 'validating',
          validationOwner: binding.validationOwner, proofHash: binding.proofHash, payloadHash: binding.payloadHash },
        { $set: { state: 'committing', snapshot, orderId: snapshot._id,
          capacity: { slot, kitchenSeat, ...(delivery ? { deliverySeat } : {}) } } }, DURABLE);
      } catch (error) {
        const reread = await this.authenticated(id, binding);
        const known = terminal(reread);
        if (known) return known;
        if (reread.validationOwner !== binding.validationOwner) return { state: 'stale' };
        // Seul E11000 de NOS index prouve l'absence d'effet. Un timeout suivi
        // de validating ne prouve pas qu'une écriture retardée ne gagnera pas.
        if (capacityCollision(error)) continue;
        throw uncertain();
      }
      const reread = await this.authenticated(id, binding);
      const known = terminal(reread);
      if (known) return known;
      if (reread.validationOwner !== binding.validationOwner) return { state: 'stale' };
      throw uncertain();
    }
    throw uncertain();
  }

  /** Aucune minuterie/panne de paiement ne constitue une preuve d'annulation. */
  async releaseCancelled(tenantId: string, clientId: string): Promise<boolean> {
    const id = idOf(tenantId, clientId);
    const admission = await this.read(id);
    if (!admission || !['committing', 'created'].includes(admission.state) || !admission.orderId || !admission.capacity) return false;
    const order = await this.orders.findOne({ _id: admission.orderId, tenantId, clientId, status: 'cancelled' })
      .select('_id').read('primary').readConcern('majority').maxTimeMS(10_000).lean();
    if (!order) return false;
    if (admission.capacity.releasedAt) {
      if (admission.capacity.kitchenSeat !== undefined || admission.capacity.deliverySeat !== undefined) throw uncertain();
      return true;
    }
    try {
      await this.admissions.updateOne({ _id: id, tenantId, clientId, orderId: order._id,
        state: { $in: ['committing', 'created'] }, 'capacity.slot': admission.capacity.slot,
        'capacity.releasedAt': { $exists: false } },
      { $unset: { 'capacity.kitchenSeat': '', 'capacity.deliverySeat': '' }, $set: { 'capacity.releasedAt': new Date() } }, DURABLE);
    } catch { /* Lire la preuve de libération, jamais décompter une deuxième fois. */ }
    const reread = await this.read(id);
    if (reread?.capacity?.releasedAt && reread.capacity.kitchenSeat === undefined && reread.capacity.deliverySeat === undefined) return true;
    throw uncertain();
  }

  private async assertIndexes(): Promise<void> {
    const calendarIndexes = await this.days.collection.listIndexes().toArray();
    const calendar = calendarIndexes.find((entry) => entry.name === ORDER_CAPACITY_DAY_INDEX);
    if (!calendar?.unique || JSON.stringify(calendar.key) !== JSON.stringify({ tenantId: 1, day: 1 })
      || calendar.partialFilterExpression || calendar.sparse) throw uncertain();
    const installed = await this.admissions.collection.listIndexes().toArray();
    for (const { name, field } of ORDER_CAPACITY_INDEXES) {
      const index = installed.find((entry) => entry.name === name);
      const seat = `capacity.${field}`;
      if (!index?.unique || Object.keys(index.key).join(',') !== `tenantId,capacity.slot,${seat}`
        || Object.values(index.key).some((value) => value !== 1)
        || JSON.stringify(index.partialFilterExpression) !== JSON.stringify({ [seat]: { $type: 'number' } })) throw uncertain();
    }
  }

  private async authenticated(id: string, binding: PublicRecoveryBinding) {
    const admission = await this.read(id);
    if (!admission || !sameRecoveryHash(admission.proofHash, binding.proofHash)
      || !sameRecoveryHash(admission.payloadHash, binding.payloadHash)) throw recoveryNotFound();
    return admission;
  }
  private read(id: string) {
    return this.admissions.findById(id).select(PRIVATE).read('primary').readConcern('majority').maxTimeMS(10_000).lean();
  }
}
