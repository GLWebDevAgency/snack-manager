import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { Model, Types, type HydratedDocument } from 'mongoose';
import Redis from 'ioredis';
import { DiningAddOrderSchema, DiningRoomSchema, DiningServeSchema, DiningSessionOpenSchema, DiningSessionOperationSchema, DiningSessionSchema,
  DiningSessionTransferSchema, DiningTableCreateSchema, DiningTableSchema, DiningTableUpdateSchema, orderAccessScope, ordersChannel, WS_EVENTS,
  type DiningAddOrder, type DiningSession, type DiningTable, type JwtPayload, type TenantAuditAction } from '@sm/contracts';
import { DINING_ACTIVE_TABLE_INDEX, DINING_TABLE_LABEL_INDEX, DINING_TABLE_POSITION_INDEX, DINING_ORDER_ADMISSION_INDEX, type DiningSessionRecord, type DiningTableRecord, type Order } from '@sm/db';
import { CapacitesService } from '../../common/capacites';
import { REDIS_PUB } from '../../redis.module';
import { AuditService } from '../audit/audit.module';
import { OrdersService } from './orders.service';
import type { DiningOrderCommitter } from './dining-order-commit';

const DURABLE = { writeConcern: { w: 'majority' as const, j: true, wtimeout: 10_000 } };
const READ_ROLES = ['owner', 'cogerant', 'gerant', 'caisse', 'cuisine'];
const WRITE_ROLES = ['owner', 'cogerant', 'gerant', 'caisse'];
const MANAGE_ROLES = ['owner', 'cogerant', 'gerant'];
type SessionDocument = HydratedDocument<DiningSessionRecord>;
type TableDocument = HydratedDocument<DiningTableRecord>;
type Receipt = Pick<DiningSessionRecord['operations'][number], 'id' | 'kind' | 'hash' | 'at' | 'actor' | 'meta' | 'outcome'>;
const recordId = (tenantId: string, id: string) => `${tenantId}:${id}`;
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
const hash = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');
function uncertain(): never { throw new ServiceUnavailableException({ code: 'DINING_RECONCILIATION_REQUIRED', message: 'Service à vérifier. Reprenez la même opération sans recommencer la commande ni le paiement.' }); }
function conflict(message = 'La salle a changé. Actualisez avant de poursuivre.'): never { throw new ConflictException({ code: 'DINING_CONFLICT', message }); }
function rejected(operationId: string, message: string): never { throw new ConflictException({ code: 'DINING_OPERATION_REJECTED', operationId, message }); }
function receipt(id: string, kind: Receipt['kind'], input: unknown, actor: JwtPayload, meta: Record<string, unknown>): Receipt {
  return { id, kind, hash: hash(input), outcome: 'applied', at: new Date(), actor: { sub: actor.sub, role: actor.role, kind: actor.kind }, meta };
}

/** Table service has its own occupancy aggregate. Financial orders remain the
 * established immutable kitchen tickets, with their original payment fences. */
@Injectable()
export class DiningService {
  constructor(
    @InjectModel('DiningTable') private readonly tables: Model<DiningTableRecord>,
    @InjectModel('DiningSession') private readonly sessions: Model<DiningSessionRecord>,
    @InjectModel('Order') private readonly orders: Model<Order>,
    private readonly orderService: OrdersService,
    private readonly capacites: CapacitesService,
    private readonly audit: AuditService,
    @Inject(REDIS_PUB) private readonly redis: Redis,
  ) {}

  private async authorize(tenantId: string, actor: JwtPayload, roles: readonly string[]) {
    if (actor.tenantId !== tenantId || !roles.includes(actor.role) || !['staff', 'user'].includes(actor.kind)) throw new ForbiddenException('Ce service est réservé à l’équipe habilitée de cet établissement.');
    if (orderAccessScope(await this.capacites.pourTenant(tenantId)) !== 'all') throw new ForbiddenException('Le service à table nécessite la caisse de cet établissement.');
  }
  private async indexes() {
    const [tables, sessions] = await Promise.all([this.tables.collection.listIndexes().toArray(), this.sessions.collection.listIndexes().toArray()]);
    if (!tables.some((entry) => entry.name === DINING_TABLE_LABEL_INDEX && entry.unique === true && isDeepStrictEqual(entry.key, { tenantId: 1, labelKey: 1 })
        && isDeepStrictEqual(entry.partialFilterExpression, { state: 'created' }))
      || !tables.some((entry) => entry.name === DINING_TABLE_POSITION_INDEX && entry.unique === true && isDeepStrictEqual(entry.key, { tenantId: 1, position: 1 })
        && isDeepStrictEqual(entry.partialFilterExpression, { state: 'created' }))
      || !sessions.some((entry) => entry.name === DINING_ORDER_ADMISSION_INDEX && entry.unique === true && isDeepStrictEqual(entry.key, { tenantId: 1, 'admissions.clientId': 1 })
        && isDeepStrictEqual(entry.partialFilterExpression, { 'admissions.clientId': { $type: 'string' } }))
      || !sessions.some((entry) => entry.name === DINING_ACTIVE_TABLE_INDEX && entry.unique === true
        && isDeepStrictEqual(entry.key, { tenantId: 1, tableId: 1 }) && isDeepStrictEqual(entry.partialFilterExpression, { state: 'open' }))) uncertain();
  }
  private tableView(table: TableDocument): DiningTable {
    if (table.state === 'rejected') rejected(table.publicId, table.rejection ?? 'Création de table refusée');
    if (table.state !== 'created') uncertain();
    return DiningTableSchema.parse({ id: table.publicId, label: table.label, seats: table.seats, active: table.active, revision: table.revision });
  }
  private sessionView(session: SessionDocument): DiningSession {
    if (session.state === 'rejected') rejected(session.publicId, session.rejection ?? 'Ouverture refusée');
    if (session.state === 'opening') uncertain();
    return DiningSessionSchema.parse({ id: session.publicId, tableId: session.tableId, tableLabel: session.tableLabel,
      guestCount: session.guestCount, revision: session.revision, state: session.state, openedAt: session.openedAt.toISOString(),
      closedAt: session.closedAt?.toISOString() ?? null, orderIds: session.admissions.map((admission) => String(admission.orderId)),
      pendingOperationCount: session.admissions.filter((admission) => admission.state === 'committing').length });
  }
  private async table(tenantId: string, id: string) {
    const table = await this.tables.findOne({ _id: recordId(tenantId, id), tenantId }).select('+operations +grants').read('primary').readConcern('majority').maxTimeMS(10_000);
    if (!table || table.state !== 'created') throw new NotFoundException('Table introuvable');
    return table;
  }
  private async grant(tenantId: string, tableId: string, sessionId: string, operationId: string, guestCount: number, input: unknown) {
    const payloadHash = hash(input);
    for (let attempt = 0; attempt < 8; attempt++) {
      let table: TableDocument;
      try { table = await this.table(tenantId, tableId); }
      catch (error) { if (error instanceof NotFoundException) return null; throw error; }
      const existing = table.grants.find((entry) => entry.operationId === operationId);
      if (existing) {
        if (existing.sessionId !== sessionId || existing.payloadHash !== payloadHash || existing.guestCount !== guestCount) conflict('Cette attribution appartient à une autre intention.');
        return existing;
      }
      if (!table.active || table.seats < guestCount) return null;
      if (table.grants.length >= 200) uncertain();
      const accepted = { operationId, sessionId, payloadHash, guestCount, tableLabel: table.label, seats: table.seats, acceptedAt: new Date() };
      try {
        await this.tables.updateOne({ _id: table._id, tenantId, state: 'created', active: true, revision: table.revision,
          seats: { $gte: guestCount }, 'grants.operationId': { $ne: operationId } },
        { $push: { grants: accepted }, $inc: { revision: 1 } }, DURABLE);
      } catch { /* Read the same grant after an uncertain acknowledgment. */ }
    }
    uncertain();
  }
  private async consumeGrant(tenantId: string, tableId: string, operationId: string, sessionId: string, payloadHash: string) {
    await this.tables.updateOne({ _id: recordId(tenantId, tableId), tenantId }, { $pull: { grants: { operationId, sessionId, payloadHash } } }, DURABLE);
  }
  private async session(tenantId: string, id: string) {
    const session = await this.sessions.findOne({ _id: recordId(tenantId, id), tenantId }).select('+operations +admissions').read('primary').readConcern('majority').maxTimeMS(10_000);
    if (!session) throw new NotFoundException('Tablée introuvable');
    return session;
  }
  private replay(document: TableDocument | SessionDocument, operationId: string, kind: Receipt['kind'], input: unknown) {
    const existing = document.operations.find((entry) => entry.id === operationId);
    if (existing && (existing.kind !== kind || existing.hash !== hash(input))) conflict('Cette opération appartient à une autre intention. Conservez le corps initial.');
    if (existing?.outcome === 'rejected') rejected(operationId, String(existing.meta?.rejection ?? 'Cette opération a été refusée sans être appliquée.'));
    return existing;
  }
  private async auditReceipt(tenantId: string, targetId: string, entry: Receipt) {
    try {
      await this.audit.logOnce({ tenantId, targetId, action: `dining.${entry.kind}` as Extract<TenantAuditAction, `dining.${string}`>,
        actor: { sub: entry.actor.sub, role: entry.actor.role, kind: entry.actor.kind } as Pick<JwtPayload, 'sub' | 'kind' | 'role'>,
        meta: { ...entry.meta, operationId: entry.id, occurredAt: entry.at.toISOString() } }, entry.id);
    } catch { uncertain(); }
  }

  /** The rejected receipt increments the same revision a delayed commit needs.
   * Only this durable fence permits the client to forget an uncertain intent. */
  private async rejectSession(tenantId: string, sessionId: string, input: { operationId: string }, kind: Receipt['kind'], actor: JwtPayload, message: string): Promise<never> {
    for (let attempt = 0; attempt < 8; attempt++) {
      const current = await this.session(tenantId, sessionId);
      if (this.replay(current, input.operationId, kind, input)) uncertain();
      const event = { ...receipt(input.operationId, kind, input, actor, { rejection: message }), outcome: 'rejected' as const };
      try {
        await this.sessions.updateOne({ _id: current._id, tenantId, revision: current.revision, 'operations.id': { $ne: input.operationId } },
          { $push: { operations: event }, $inc: { revision: 1 } }, DURABLE);
      } catch { /* Re-read the immutable decision, never infer it from a timeout. */ }
      const observed = await this.session(tenantId, sessionId);
      if (this.replay(observed, input.operationId, kind, input)) uncertain();
    }
    uncertain();
  }

  async room(tenantId: string, actor: JwtPayload) {
    await this.authorize(tenantId, actor, READ_ROLES);
    const [tables, sessions] = await Promise.all([
      this.tables.find({ tenantId, state: 'created' }).sort({ label: 1 }).limit(201),
      this.sessions.find({ tenantId, state: 'open' }).select('+admissions').sort({ openedAt: 1 }).limit(201),
    ]);
    if (tables.length > 200 || sessions.length > 200) uncertain();
    return DiningRoomSchema.parse({ tables: tables.map((table) => this.tableView(table)), sessions: sessions.map((session) => this.sessionView(session)) });
  }

  async createTable(tenantId: string, actor: JwtPayload, input: unknown) {
    await this.authorize(tenantId, actor, MANAGE_ROLES);
    const body = DiningTableCreateSchema.parse(input);
    await this.indexes();
    const id = recordId(tenantId, body.operationId);
    const existing = await this.tables.findOne({ _id: id, tenantId }).select('+operations');
    if (existing) {
      const replay = this.replay(existing, body.operationId, 'table.create', body);
      if (!replay) conflict();
      return this.finishTableCreation(tenantId, existing);
    }
    const event = receipt(body.operationId, 'table.create', body, actor, { tableId: body.operationId, label: body.label, seats: body.seats });
    try {
      await this.tables.updateOne({ _id: id, tenantId }, { $setOnInsert: { publicId: body.operationId, label: body.label,
        labelKey: body.label.normalize('NFKC').toLocaleLowerCase('fr'), seats: body.seats, active: true, state: 'creating', revision: 0, operations: [event] } }, { upsert: true, runValidators: true, ...DURABLE });
    } catch (error) {
      const observed = await this.tables.findOne({ _id: id, tenantId }).select('+operations');
      if (!observed) {
        if ((error as { code?: number }).code === 11000) conflict('Une table porte déjà ce nom.');
        uncertain();
      }
    }
    const table = await this.tables.findOne({ _id: id, tenantId }).select('+operations').read('primary').readConcern('majority');
    if (!table) uncertain();
    const replay = this.replay(table, body.operationId, 'table.create', body);
    if (!replay) uncertain();
    return this.finishTableCreation(tenantId, table);
  }

  private async finishTableCreation(tenantId: string, table: TableDocument): Promise<DiningTable> {
    if (table.state === 'creating') {
      let refusal: string | null = null;
      for (let attempt = 0; attempt < 201; attempt++) {
        const current = await this.tables.findOne({ _id: table._id, tenantId }).read('primary').readConcern('majority');
        if (!current || current.state !== 'creating') break;
        const occupied = await this.tables.find({ tenantId, state: 'created' }).select('position').limit(201).read('primary').readConcern('majority').lean();
        const positions = new Set(occupied.map((entry) => entry.position));
        const position = Array.from({ length: 200 }, (_, index) => index).find((index) => !positions.has(index));
        if (position === undefined) { refusal = 'La salle est limitée à 200 tables.'; break; }
        try {
          await this.tables.updateOne({ _id: table._id, tenantId, state: 'creating' }, { $set: { state: 'created', position } }, DURABLE);
          break;
        } catch (error) {
          const collision = error as { code?: number; keyPattern?: Record<string, unknown> };
          if (collision.code === 11000 && collision.keyPattern?.position === 1) continue;
          if (collision.code === 11000 && collision.keyPattern?.labelKey === 1) refusal = 'Une table porte déjà ce nom.';
          break;
        }
      }
      if (refusal) {
        try {
          await this.tables.updateOne({ _id: table._id, tenantId, state: 'creating' }, { $set: { state: 'rejected', rejection: refusal } }, DURABLE);
        } catch { /* The state below, not an ACK, decides. */ }
      }
    }
    const observed = await this.tables.findOne({ _id: table._id, tenantId }).select('+operations').read('primary').readConcern('majority');
    if (!observed) uncertain();
    const view = this.tableView(observed);
    const event = observed.operations.find((entry) => entry.id === observed.publicId && entry.kind === 'table.create');
    if (!event) uncertain();
    await this.auditReceipt(tenantId, observed.publicId, event);
    return view;
  }

  private async rejectTable(tenantId: string, id: string, input: { operationId: string }, actor: JwtPayload, message: string): Promise<never> {
    for (let attempt = 0; attempt < 8; attempt++) {
      const current = await this.table(tenantId, id);
      if (this.replay(current, input.operationId, 'table.update', input)) uncertain();
      const event = { ...receipt(input.operationId, 'table.update', input, actor, { rejection: message }), outcome: 'rejected' as const };
      try {
        await this.tables.updateOne({ _id: current._id, tenantId, revision: current.revision, 'operations.id': { $ne: input.operationId } },
          { $push: { operations: event }, $inc: { revision: 1 } }, DURABLE);
      } catch { /* Re-read the durable fence. */ }
      const observed = await this.table(tenantId, id);
      if (this.replay(observed, input.operationId, 'table.update', input)) uncertain();
    }
    uncertain();
  }

  async updateTable(tenantId: string, id: string, actor: JwtPayload, input: unknown) {
    await this.authorize(tenantId, actor, MANAGE_ROLES);
    const body = DiningTableUpdateSchema.parse(input);
    await this.indexes();
    let table = await this.table(tenantId, id);
    const previous = this.replay(table, body.operationId, 'table.update', body);
    if (previous) { await this.auditReceipt(tenantId, id, previous); return this.tableView(table); }
    if (table.revision !== body.expectedRevision) return this.rejectTable(tenantId, id, body, actor, 'La configuration a changé. Actualisez avant de poursuivre.');
    // Disabling prevents future occupations; an already open service remains valid.
    const event = receipt(body.operationId, 'table.update', body, actor, { tableId: id, before: this.tableView(table), changes: body });
    const changes = { ...(body.label !== undefined ? { label: body.label, labelKey: body.label.normalize('NFKC').toLocaleLowerCase('fr') } : {}),
      ...(body.seats !== undefined ? { seats: body.seats } : {}), ...(body.active !== undefined ? { active: body.active } : {}) };
    try {
      await this.tables.updateOne({ _id: table._id, tenantId, revision: body.expectedRevision }, { $set: changes, $inc: { revision: 1 }, $push: { operations: event } }, { runValidators: true, ...DURABLE });
    } catch (error) {
      if ((error as { code?: number }).code === 11000) return this.rejectTable(tenantId, id, body, actor, 'Une table porte déjà ce nom.');
      // A delayed write may still commit. Read its immutable receipt below.
    }
    table = await this.table(tenantId, id);
    const confirmed = this.replay(table, body.operationId, 'table.update', body);
    if (!confirmed) { if (table.revision !== body.expectedRevision) return this.rejectTable(tenantId, id, body, actor, 'La configuration a changé. Actualisez avant de poursuivre.'); uncertain(); }
    await this.auditReceipt(tenantId, id, confirmed);
    return this.tableView(table);
  }

  async open(tenantId: string, actor: JwtPayload, input: unknown) {
    await this.authorize(tenantId, actor, WRITE_ROLES);
    const body = DiningSessionOpenSchema.parse(input);
    await this.indexes();
    const id = recordId(tenantId, body.operationId);
    const existing = await this.sessions.findOne({ _id: id, tenantId }).select('+operations +admissions');
    if (existing) {
      const event = this.replay(existing, body.operationId, 'session.open', body);
      if (!event) conflict();
      return this.finishOpening(tenantId, existing, body);
    }
    const event = receipt(body.operationId, 'session.open', body, actor, { tableId: body.tableId, guestCount: body.guestCount });
    try {
      await this.sessions.updateOne({ _id: id, tenantId }, { $setOnInsert: { publicId: body.operationId,
        tableId: body.tableId, tableLabel: 'Ouverture en cours', guestCount: body.guestCount, state: 'opening', revision: 0,
        openedAt: event.at, closedAt: null, admissions: [], operations: [event] } }, { upsert: true, runValidators: true, ...DURABLE });
    } catch (error) {
      const observed = await this.sessions.findOne({ _id: id, tenantId }).select('+operations +admissions');
      if (!observed) {
        if ((error as { code?: number }).code === 11000) conflict('Cette table est déjà occupée.');
        uncertain();
      }
    }
    const session = await this.session(tenantId, body.operationId);
    const confirmed = this.replay(session, body.operationId, 'session.open', body);
    if (!confirmed) uncertain();
    return this.finishOpening(tenantId, session, body);
  }

  private async finishOpening(tenantId: string, session: SessionDocument, body: { operationId: string; tableId: string; guestCount: number }): Promise<DiningSession> {
    if (session.state === 'opening') {
      const grant = await this.grant(tenantId, body.tableId, session.publicId, body.operationId, body.guestCount, body);
      let refusal: string | null = grant ? null : 'La table est introuvable, désactivée ou trop petite pour cette tablée.';
      if (!refusal && grant) {
        try {
          await this.sessions.updateOne({ _id: session._id, tenantId, state: 'opening' },
            { $set: { state: 'open', tableLabel: grant.tableLabel }, $inc: { revision: 1 } }, DURABLE);
        } catch (error) {
          if ((error as { code?: number }).code === 11000) refusal = 'Cette table est déjà occupée.';
        }
      }
      if (refusal) {
        try {
          // This CAS fences every delayed opening. A winner already open is never rejected.
          await this.sessions.updateOne({ _id: session._id, tenantId, state: 'opening' },
            { $set: { state: 'rejected', rejection: refusal }, $inc: { revision: 1 } }, DURABLE);
        } catch { /* Only the durable state below establishes rejection. */ }
      }
    }
    const observed = await this.session(tenantId, session.publicId);
    if (observed.state === 'opening') uncertain();
    if (observed.state === 'rejected') {
      await this.consumeGrant(tenantId, body.tableId, body.operationId, session.publicId, hash(body));
      rejected(body.operationId, observed.rejection ?? 'Ouverture refusée');
    }
    const event = this.replay(observed, body.operationId, 'session.open', body);
    if (!event) uncertain();
    await this.auditReceipt(tenantId, observed.publicId, event);
    await this.consumeGrant(tenantId, body.tableId, body.operationId, session.publicId, hash(body));
    return this.sessionView(observed);
  }

  async transfer(tenantId: string, id: string, actor: JwtPayload, input: unknown) {
    await this.authorize(tenantId, actor, WRITE_ROLES);
    const body = DiningSessionTransferSchema.parse(input);
    try {
      const result = await this.transferAuthorized(tenantId, id, actor, body);
      await this.consumeGrant(tenantId, body.tableId, body.operationId, id, hash(body));
      return result;
    } catch (error) {
      const response = error instanceof ConflictException ? error.getResponse() : null;
      if (response && typeof response === 'object' && (response as { code?: string }).code === 'DINING_OPERATION_REJECTED') await this.consumeGrant(tenantId, body.tableId, body.operationId, id, hash(body));
      throw error;
    }
  }
  private async transferAuthorized(tenantId: string, id: string, actor: JwtPayload, body: { operationId: string; expectedRevision: number; tableId: string }) {
    await this.indexes();
    const session = await this.session(tenantId, id);
    const previous = this.replay(session, body.operationId, 'session.transfer', body);
    if (previous) { await this.auditReceipt(tenantId, id, previous); return this.sessionView(session); }
    if (session.state !== 'open' || session.revision !== body.expectedRevision) return this.rejectSession(tenantId, id, body, 'session.transfer', actor, 'La salle a changé. Actualisez avant de transférer.');
    const grant = await this.grant(tenantId, body.tableId, id, body.operationId, session.guestCount, body);
    if (!grant) return this.rejectSession(tenantId, id, body, 'session.transfer', actor, 'Cette table est introuvable, désactivée ou trop petite pour la tablée.');
    return this.changeSession(tenantId, session, body, 'session.transfer', actor, { tableId: body.tableId, tableLabel: grant.tableLabel },
      { fromTableId: session.tableId, toTableId: body.tableId, tableLabel: grant.tableLabel });
  }

  async close(tenantId: string, id: string, actor: JwtPayload, input: unknown) {
    await this.authorize(tenantId, actor, WRITE_ROLES);
    const body = DiningSessionOperationSchema.parse(input);
    const session = await this.session(tenantId, id);
    const previous = this.replay(session, body.operationId, 'session.close', body);
    if (previous) { await this.auditReceipt(tenantId, id, previous); return this.sessionView(session); }
    if (session.state !== 'open' || session.revision !== body.expectedRevision) return this.rejectSession(tenantId, id, body, 'session.close', actor, 'La salle a changé. Actualisez avant de clôturer.');
    if (session.admissions.some((admission) => admission.state !== 'created')) return this.rejectSession(tenantId, id, body, 'session.close', actor, 'Un envoi cuisine reste à confirmer. Reprenez cette tablée avant de la clôturer.');
    let orders = await this.sessionOrders(tenantId, session);
    const finished = (order: Order) => order.status === 'cancelled'
      || (order.status === 'delivered' && ['paid', 'refunded'].includes(order.payment.status));
    const readyAndServed = (order: Order) => order.status === 'ready' && order.payment.status === 'paid' && Boolean(order.dining?.servedAt);
    if (orders.some((order) => !finished(order) && !readyAndServed(order))) {
      return this.rejectSession(tenantId, id, body, 'session.close', actor, 'Encaissez et confirmez la remise de chaque ticket avant de clôturer la tablée.');
    }
    // Service before payment is a separate physical fact. Only after payment
    // does the established handoff transition finalize these served tickets.
    // A partial failure leaves occupancy open; replay resumes the remaining work.
    for (const order of orders.filter(readyAndServed)) await this.orderService.updateStatus(tenantId, String(order._id), 'delivered', actor);
    orders = await this.sessionOrders(tenantId, session);
    if (orders.some((order) => !finished(order))) uncertain();
    return this.changeSession(tenantId, session, body, 'session.close', actor, { state: 'closed', closedAt: new Date() }, { tableId: session.tableId, orderIds: orders.map((order) => String(order._id)) });
  }

  private async changeSession(tenantId: string, session: SessionDocument, body: { operationId: string; expectedRevision: number }, kind: Receipt['kind'], actor: JwtPayload,
    changes: Record<string, unknown>, meta: Record<string, unknown>) {
    if (session.state !== 'open' || session.revision !== body.expectedRevision) return this.rejectSession(tenantId, session.publicId, body, kind, actor, 'La salle a changé. Actualisez avant de poursuivre.');
    const event = receipt(body.operationId, kind, body, actor, meta);
    try {
      await this.sessions.updateOne({ _id: session._id, tenantId, state: 'open', revision: body.expectedRevision },
        { $set: changes, $inc: { revision: 1 }, $push: { operations: event } }, { runValidators: true, ...DURABLE });
    } catch (error) {
      if ((error as { code?: number }).code === 11000) return this.rejectSession(tenantId, session.publicId, body, kind, actor, 'La table de destination est déjà occupée.');
    }
    const observed = await this.session(tenantId, session.publicId);
    const confirmed = this.replay(observed, body.operationId, kind, body);
    if (!confirmed) { if (observed.revision !== body.expectedRevision || observed.state !== 'open') return this.rejectSession(tenantId, session.publicId, body, kind, actor, 'La salle a changé. Actualisez avant de poursuivre.'); uncertain(); }
    await this.auditReceipt(tenantId, observed.publicId, confirmed);
    return this.sessionView(observed);
  }

  private assertOrder(order: HydratedDocument<Order>, session: SessionDocument, clientId: string) {
    const admission = session.admissions.find((entry) => entry.clientId === clientId);
    if (!admission || String(order._id) !== String(admission.orderId) || String(order.tenantId) !== String(session.tenantId)
      || order.clientId !== clientId || order.dining?.sessionId !== session.publicId || order.type !== 'surplace' || order.channel !== 'pos') uncertain();
  }
  private async sessionOrders(tenantId: string, session: SessionDocument) {
    const rows = await this.orders.find({ tenantId, _id: { $in: session.admissions.map((entry) => entry.orderId) } }).select('+diningServeReceipt').read('primary').readConcern('majority').maxTimeMS(10_000);
    if (rows.length !== session.admissions.length) uncertain();
    for (const row of rows) {
      this.assertOrder(row, session, row.clientId);
      if (row.diningServeReceipt) await this.publishServeReceipt(tenantId, row);
    }
    return rows;
  }

  private async publishServeReceipt(tenantId: string, order: HydratedDocument<Order>) {
    const proof = order.diningServeReceipt;
    if (!proof || proof.sessionId !== order.dining?.sessionId || proof.servedAt.getTime() !== order.dining.servedAt?.getTime()) uncertain();
    try {
      await this.audit.logOnce({ tenantId, targetId: String(order._id), action: 'dining.session.serve',
        actor: { sub: proof.actor.sub, role: proof.actor.role, kind: proof.actor.kind } as Pick<JwtPayload, 'sub' | 'role' | 'kind'>,
        meta: { operationId: proof.operationId, sessionId: proof.sessionId, tableId: proof.tableId, tableLabel: proof.tableLabel,
          number: order.number, servedAt: proof.servedAt.toISOString() } }, proof.operationId);
      await this.redis.publish(ordersChannel(tenantId), JSON.stringify({ event: WS_EVENTS.orderUpdated, payload: order.toObject() }));
    } catch { uncertain(); }
  }

  async serve(tenantId: string, sessionId: string, orderId: string, actor: JwtPayload, input: unknown) {
    await this.authorize(tenantId, actor, WRITE_ROLES);
    const body = DiningServeSchema.parse(input);
    if (!Types.ObjectId.isValid(orderId)) throw new NotFoundException('Ticket introuvable');
    for (let attempt = 0; attempt < 8; attempt++) {
      const session = await this.session(tenantId, sessionId);
      const order = await this.orders.findOne({ _id: orderId, tenantId, 'dining.sessionId': sessionId })
        .select('+diningServeReceipt +diningServeRejections +paymentFlow').read('primary').readConcern('majority').maxTimeMS(10_000);
      if (!order) throw new NotFoundException('Ticket introuvable');
      this.assertOrder(order, session, order.clientId);
      const refusal = order.diningServeRejections.find((entry) => entry.operationId === body.operationId);
      if (refusal) rejected(body.operationId, refusal.reason);
      if (order.diningServeReceipt) {
        if (order.diningServeReceipt.operationId !== body.operationId) rejected(body.operationId, 'Ce ticket a déjà été servi par une autre opération.');
        await this.publishServeReceipt(tenantId, order);
        return { session: this.sessionView(session), order };
      }
      const unavailable = session.state !== 'open' || order.status !== 'ready' || order.payment.status === 'refunded'
        || (order.paymentFlow && ['closing', 'closed', 'review_required'].includes(order.paymentFlow.phase));
      const filter = { _id: order._id, tenantId, __v: order.__v ?? { $exists: false }, 'dining.sessionId': sessionId, diningServeReceipt: null };
      if (unavailable) {
        // The rejection changes the very Order version a delayed serve needs.
        // A later kitchen transition cannot revive this exact refused intent.
        try {
          await this.orders.updateOne(filter, { $push: { diningServeRejections: { operationId: body.operationId,
            reason: 'Le ticket doit être prêt, sans annulation ni fermeture de paiement, dans une tablée ouverte.' } }, $inc: { __v: 1 } }, DURABLE);
        } catch { /* Loop reads proof. No timeout is a definitive rejection. */ }
        continue;
      }
      const servedAt = new Date();
      const proof = { operationId: body.operationId, sessionId, tableId: session.tableId, tableLabel: session.tableLabel, servedAt,
        actor: { sub: actor.sub, role: actor.role, kind: actor.kind } };
      try {
        await this.orders.updateOne({ ...filter, status: 'ready', 'dining.servedAt': null },
          { $set: { 'dining.servedAt': servedAt, diningServeReceipt: proof }, $inc: { __v: 1 } }, DURABLE);
      } catch { /* Resume with the exact operation and read its committed proof. */ }
    }
    uncertain();
  }

  private async materialize(tenantId: string, sessionId: string, clientId: string) {
    let session = await this.session(tenantId, sessionId);
    const admission = session.admissions.find((entry) => entry.clientId === clientId);
    if (!admission) uncertain();
    if (admission.state === 'committing') {
      const snapshot = admission.snapshot as Record<string, unknown> | null;
      if (!snapshot || !(snapshot._id instanceof Types.ObjectId) || String(snapshot._id) !== String(admission.orderId)
        || String(snapshot.tenantId) !== tenantId || snapshot.clientId !== clientId) uncertain();
      try {
        await this.orders.updateOne({ _id: admission.orderId, tenantId, clientId }, { $setOnInsert: snapshot },
          { upsert: true, runValidators: true, setDefaultsOnInsert: false, timestamps: false, ...DURABLE });
      } catch { /* Read the exact committed identity. Missing ACK is not a rejected order. */ }
    }
    const order = await this.orders.findOne({ _id: admission.orderId, tenantId, clientId }).read('primary').readConcern('majority').maxTimeMS(10_000);
    if (!order) uncertain();
    this.assertOrder(order, session, clientId);
    const event = session.operations.find((entry) => entry.id === clientId && entry.kind === 'session.order');
    if (!event) uncertain();
    await this.auditReceipt(tenantId, sessionId, event);
    try {
      await this.redis.publish(ordersChannel(tenantId), JSON.stringify({ event: admission.state === 'committing' ? WS_EVENTS.orderCreated : WS_EVENTS.orderUpdated, payload: order.toObject() }));
    } catch { uncertain(); }
    if (admission.state === 'committing') {
      try {
        await this.sessions.updateOne({ _id: session._id, tenantId, admissions: { $elemMatch: { clientId, orderId: order._id, state: 'committing' } } },
          { $set: { 'admissions.$.state': 'created', 'admissions.$.snapshot': null }, $inc: { revision: 1 } }, DURABLE);
      } catch { /* Keep the snapshot until a majority read proves materialization. */ }
      session = await this.session(tenantId, sessionId);
      if (session.admissions.find((entry) => entry.clientId === clientId)?.state !== 'created') uncertain();
    }
    return { session, order };
  }

  async detail(tenantId: string, id: string, actor: JwtPayload) {
    await this.authorize(tenantId, actor, READ_ROLES);
    let session = await this.session(tenantId, id);
    // A read repairs an already committed intent; it never invents a new sale.
    for (const admission of session.admissions.filter((entry) => entry.state === 'committing')) await this.materialize(tenantId, id, admission.clientId);
    session = await this.session(tenantId, id);
    return { session: this.sessionView(session), orders: await this.sessionOrders(tenantId, session) };
  }

  async addOrder(tenantId: string, id: string, actor: JwtPayload, input: unknown) {
    await this.authorize(tenantId, actor, WRITE_ROLES);
    const body = DiningAddOrderSchema.parse(input);
    try { return await this.addOrderAuthorized(tenantId, id, actor, body); }
    catch (error) {
      const response = error instanceof ConflictException ? error.getResponse() : null;
      if (response && typeof response === 'object' && (response as { code?: string }).code === 'DINING_OPERATION_REJECTED'
        && (response as { operationId?: string }).operationId === body.operationId) {
        // Repair quota compensation before declaring the rejected intent safe to forget.
        await this.orderService.releaseDiningPromotion(tenantId, { operationId: body.operationId, sessionId: id, payloadHash: hash(body) });
      }
      throw error;
    }
  }

  private async addOrderAuthorized(tenantId: string, id: string, actor: JwtPayload, body: DiningAddOrder) {
    await this.indexes();
    const session = await this.session(tenantId, id);
    if (this.replay(session, body.operationId, 'session.order', body)) {
      const result = await this.materialize(tenantId, id, body.operationId);
      return { session: this.sessionView(result.session), order: result.order };
    }
    if (session.state !== 'open' || session.revision !== body.expectedRevision) return this.rejectSession(tenantId, id, body, 'session.order', actor, 'La salle a changé. Actualisez avant d’envoyer la commande.');
    if (session.admissions.length >= 200) return this.rejectSession(tenantId, id, body, 'session.order', actor, 'Cette tablée contient déjà 200 tickets. Terminez ce service avant de poursuivre.');
    const committer = this.committer(tenantId, session, body, actor);
    try {
      await this.orderService.createWithOutcome(tenantId, body.order, actor.sub, actor.deviceId ?? null, undefined, 'staff', undefined, undefined, committer);
    } catch (error) {
      const failure = error instanceof ConflictException ? error.getResponse() : null;
      if (failure && typeof failure === 'object' && (failure as { code?: string }).code === 'DINING_PRICING_IDENTITY_CONFLICT') throw error;
      if (error instanceof BadRequestException || error instanceof NotFoundException || error instanceof ForbiddenException || error instanceof ConflictException) {
        return this.rejectSession(tenantId, id, body, 'session.order', actor, error.message);
      }
      throw error;
    }
    const result = await this.materialize(tenantId, id, body.operationId);
    return { session: this.sessionView(result.session), order: result.order };
  }

  private committer(tenantId: string, initial: SessionDocument, body: DiningAddOrder, actor: JwtPayload): DiningOrderCommitter {
    const context = { sessionId: initial.publicId, tableId: initial.tableId, tableLabel: initial.tableLabel };
    return {
      context,
      identity: { operationId: body.operationId, sessionId: initial.publicId, payloadHash: hash(body) },
      assertExisting: async (order) => {
        const current = await this.session(tenantId, initial.publicId);
        if (!this.replay(current, body.operationId, 'session.order', body)) conflict('Cette clé de commande est déjà utilisée hors de cette tablée.');
        this.assertOrder(order, current, body.operationId);
      },
      commit: async (candidate) => {
        if (String(candidate.tenantId) !== tenantId || candidate.clientId !== body.operationId || candidate.type !== 'surplace' || candidate.channel !== 'pos'
          || !isDeepStrictEqual(candidate.dining, context)) throw new BadRequestException('Candidat de table invalide');
        const now = new Date();
        const document = new this.orders({ ...candidate, createdAt: now, updatedAt: now, __v: 0 });
        await document.validate();
        const snapshot = document.toObject({ transform: false });
        const event = receipt(body.operationId, 'session.order', body, actor, { tableId: context.tableId, tableLabel: context.tableLabel, orderId: String(document._id), number: document.number });
        try {
          await this.sessions.updateOne({ _id: initial._id, tenantId, state: 'open', revision: body.expectedRevision, 'operations.id': { $ne: body.operationId } },
            { $push: { admissions: { clientId: body.operationId, hash: hash(body), orderId: document._id, state: 'committing', snapshot }, operations: event },
              $inc: { revision: 1 } }, { runValidators: true, ...DURABLE });
        } catch (error) {
          if ((error as { code?: number }).code === 11000) conflict('Cette clé de commande appartient déjà à une tablée.');
        }
        const observed = await this.session(tenantId, initial.publicId);
        const confirmed = this.replay(observed, body.operationId, 'session.order', body);
        if (!confirmed) { if (observed.revision !== body.expectedRevision || observed.state !== 'open') conflict(); uncertain(); }
        const committed = observed.admissions.find((entry) => entry.clientId === body.operationId);
        if (!committed) uncertain();
        const result = await this.materialize(tenantId, initial.publicId, body.operationId);
        return { order: result.order, created: String(committed.orderId) === String(document._id) };
      },
    };
  }
}
