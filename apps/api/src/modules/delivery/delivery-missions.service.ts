import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { createHash, randomUUID } from 'node:crypto';
import { Model, Types } from 'mongoose';
import type Redis from 'ioredis';
import {
  DELIVERY_MISSION_MAX_OPERATIONS, DELIVERY_MISSION_PAGE_SIZE,
  DeliveryMissionAssignSchema, DeliveryMissionDispatchSchema, DeliveryMissionsQuerySchema, DeliveryMissionRefusalCodeSchema, DeliveryMissionResultSchema,
  capacitesEffectives, isAccessBlocked, ordersChannel, WS_EVENTS,
  type DeliveryMissionAssign, type DeliveryMissionDispatch, type DeliveryMissionResult,
  type DeliveryMissionsQuery, type DeliveryMissionsView, type DeliveryMissionView, type JwtPayload,
} from '@sm/contracts';
import { ordering } from '@sm/domain';
import type { DeliveryOperator, Order, Staff, Tenant } from '@sm/db';
import { SOUSCRIPTION_FIELDS } from '../../common/capacites';
import { REDIS_PUB } from '../../redis.module';
import { AuditService, type AuditActor } from '../audit/audit.module';
import { DeliveryAccessService, type DeliveryAccessSession } from './delivery-access.service';
import { MISSION_PROJECTION, missionState, missionView, type MissionOperation, type MissionOrder, type MissionRecord } from './delivery-missions.projection';

const ACTIVE = ['new', 'preparing', 'ready'];
const MANAGERS = ['owner', 'cogerant', 'gerant'];
const writeConcern = { w: 'majority' as const, j: true, wtimeout: 10_000 };
type Principal = { kind: 'manager'; actor: JwtPayload } | { kind: 'courier'; access: DeliveryAccessSession };
type Operator = Pick<DeliveryOperator, 'active' | 'revision' | 'name' | 'staffId' | 'staffSessionVersion'> & { _id: Types.ObjectId };
const changed = () => new ConflictException({ code: 'DELIVERY_MISSION_CHANGED', message: 'Cette mission a changé. Actualisez avant de confirmer une nouvelle action.' });
const unavailable = () => new NotFoundException({ code: 'DELIVERY_MISSION_NOT_FOUND', message: 'Mission de livraison introuvable.' });
const uncertain = () => new ServiceUnavailableException({ code: 'DELIVERY_MISSION_UNCERTAIN', message: 'La confirmation reste à vérifier. Reprenez la même opération sans confirmer un second départ.' });
const invalid = () => new BadRequestException({ code: 'DELIVERY_MISSION_INPUT_INVALID', message: 'Paramètres de mission invalides.' });

@Injectable()
export class DeliveryMissionsService {
  constructor(
    @InjectModel('Order') private readonly orders: Model<Order>,
    @InjectModel('DeliveryOperator') private readonly operators: Model<DeliveryOperator>,
    @InjectModel('Staff') private readonly staff: Model<Staff>,
    @InjectModel('Tenant') private readonly tenants: Model<Tenant>,
    private readonly access: DeliveryAccessService,
    private readonly audit: AuditService,
    @Inject(REDIS_PUB) private readonly redis: Redis,
  ) {}

  private async authorize(tenantId: string, principal: Principal, assignment = false): Promise<void> {
    if (principal.kind === 'courier') {
      if (assignment || principal.access.tenantId !== tenantId) throw new ForbiddenException();
      await this.access.revalidate(principal.access);
      return;
    }
    const actor = principal.actor;
    if (!['user', 'staff'].includes(actor.kind) || actor.tenantId !== tenantId
      || !(assignment ? MANAGERS : [...MANAGERS, 'caisse']).includes(actor.role)) throw new ForbiddenException();
    if (!/^[a-f0-9]{24}$/.test(tenantId)) throw new ForbiddenException();
    const tenant = await this.tenants.findById(tenantId, { ...SOUSCRIPTION_FIELDS, 'account.status': 1 })
      .read('primary').readConcern('majority').maxTimeMS(10_000).lean();
    if (!tenant || isAccessBlocked(tenant.account?.status) || !capacitesEffectives(tenant).includes('delivery')) throw new ForbiddenException();
  }

  private filter(tenantId: string, principal: Principal) {
    return { tenantId, type: 'delivery', ...(principal.kind === 'courier' ? {
      'deliveryMission.assignment.operatorId': principal.access.operatorId, status: { $in: ACTIVE },
    } : {}) };
  }

  private async row(tenantId: string, id: string, principal: Principal): Promise<MissionOrder> {
    if (!/^[a-f0-9]{24}$/.test(id)) throw unavailable();
    const row = await this.orders.findOne({ ...this.filter(tenantId, principal), _id: id }, MISSION_PROJECTION)
      .read('primary').readConcern('majority').maxTimeMS(10_000).lean<MissionOrder | null>();
    if (!row || !row.delivery?.address) throw unavailable();
    if (row.deliveryMission && (row.deliveryMission.version !== 1 || !Number.isSafeInteger(row.deliveryMission.revision)
      || row.deliveryMission.revision < 0 || !Array.isArray(row.deliveryMission.operations))) throw uncertain();
    return row;
  }

  private async operator(tenantId: string, id: string, expectedRevision?: number): Promise<Operator | null> {
    const row = await this.operators.findOne({ _id: id, tenantId }, { active: 1, revision: 1, name: 1, staffId: 1, staffSessionVersion: 1 })
      .read('primary').readConcern('majority').maxTimeMS(10_000).lean<Operator | null>();
    if (!row?.active || (expectedRevision !== undefined && row.revision !== expectedRevision)) return null;
    if (row.staffId) {
      const member = await this.staff.findOne({ _id: row.staffId, tenantId }, { active: 1, sessionVersion: 1, name: 1 })
        .read('primary').readConcern('majority').maxTimeMS(10_000).lean();
      if (!member?.active || row.staffSessionVersion !== String(member.sessionVersion ?? '0')) return null;
      row.name = member.name;
    }
    // Le contrôle n'est pas transactionnel avec Order. Une révocation qui
    // suit cette lecture peut croiser une requête déjà autorisée en vol.
    const current = await this.operators.exists({ _id: id, tenantId, active: true, revision: row.revision })
      .read('primary').readConcern('majority').maxTimeMS(10_000);
    return current ? row : null;
  }

  private async view(row: MissionOrder, principal: Principal): Promise<DeliveryMissionView> {
    const assignment = row.deliveryMission?.assignment;
    const available = !!assignment && !!await this.operator(String(row.tenantId), String(assignment.operatorId));
    return missionView(row, principal.kind === 'manager' && MANAGERS.includes(principal.actor.role), available);
  }

  private async list(tenantId: string, principal: Principal, raw: DeliveryMissionsQuery): Promise<DeliveryMissionsView> {
    const query = DeliveryMissionsQuerySchema.safeParse(raw);
    if (!query.success) throw invalid();
    await this.authorize(tenantId, principal);
    const rows = await this.orders.find({ ...this.filter(tenantId, principal), status: { $in: ACTIVE },
      ...(query.data.after ? { _id: { $gt: query.data.after } } : {}), 'delivery.address': { $ne: null },
    }, MISSION_PROJECTION).sort({ _id: 1 }).limit(DELIVERY_MISSION_PAGE_SIZE + 1)
      .read('primary').readConcern('majority').maxTimeMS(10_000).lean<MissionOrder[]>();
    const visible = rows.slice(0, DELIVERY_MISSION_PAGE_SIZE);
    const missions = await Promise.all(visible.map(row => this.view(row, principal)));
    await this.authorize(tenantId, principal);
    return { missions, nextCursor: rows.length > DELIVERY_MISSION_PAGE_SIZE ? String(visible.at(-1)!._id) : null };
  }

  private async get(tenantId: string, id: string, principal: Principal): Promise<DeliveryMissionView> {
    await this.authorize(tenantId, principal);
    const view = await this.view(await this.row(tenantId, id, principal), principal);
    await this.authorize(tenantId, principal);
    return view;
  }

  listManager(tenantId: string, actor: JwtPayload, query: DeliveryMissionsQuery = {}) { return this.list(tenantId, { kind: 'manager', actor }, query); }
  getManager(tenantId: string, id: string, actor: JwtPayload) { return this.get(tenantId, id, { kind: 'manager', actor }); }
  listCourier(access: DeliveryAccessSession, query: DeliveryMissionsQuery = {}) { return this.list(access.tenantId, { kind: 'courier', access }, query); }
  getCourier(access: DeliveryAccessSession, id: string) { return this.get(access.tenantId, id, { kind: 'courier', access }); }
  assign(tenantId: string, id: string, input: DeliveryMissionAssign, actor: JwtPayload) { return this.mutate(tenantId, id, input, { kind: 'manager', actor }, true); }
  dispatchManager(tenantId: string, id: string, input: DeliveryMissionDispatch, actor: JwtPayload) { return this.mutate(tenantId, id, input, { kind: 'manager', actor }, false); }
  dispatchCourier(access: DeliveryAccessSession, id: string, input: DeliveryMissionDispatch) { return this.mutate(access.tenantId, id, input, { kind: 'courier', access }, false); }

  private async mutate(tenantId: string, id: string, raw: DeliveryMissionAssign | DeliveryMissionDispatch, principal: Principal, assigning: boolean): Promise<DeliveryMissionResult> {
    const parsed = (assigning ? DeliveryMissionAssignSchema : DeliveryMissionDispatchSchema).safeParse(raw);
    if (!parsed.success) throw invalid();
    const input = parsed.data;
    await this.authorize(tenantId, principal, assigning);
    const actorId = principal.kind === 'courier' ? principal.access.operatorId : principal.actor.sub;
    const actorKind = principal.kind === 'courier' ? 'delivery' : principal.actor.kind;
    const action = assigning ? (input as DeliveryMissionAssign).operatorId === null ? 'unassign' : 'assign' : 'dispatch';
    const fingerprint = createHash('sha256').update(JSON.stringify(['delivery-mission/v1', tenantId, id, actorKind, actorId, action,
      input.operationId, input.expectedRevision, assigning ? (input as DeliveryMissionAssign).operatorId : null,
      assigning ? (input as DeliveryMissionAssign).expectedOperatorRevision : null, assigning ? (input as DeliveryMissionAssign).reason : null,
    ])).digest('hex');
    const before = await this.row(tenantId, id, principal);
    const previous = before.deliveryMission?.operations.find(op => op.operationId === input.operationId);
    if (previous) return this.replay(tenantId, id, principal, previous, fingerprint);
    const revision = before.deliveryMission?.revision ?? 0;
    if (revision !== input.expectedRevision) throw changed();
    if (revision === Number.MAX_SAFE_INTEGER || (before.deliveryMission?.operations.length ?? 0) >= DELIVERY_MISSION_MAX_OPERATIONS) {
      throw new ConflictException({ code: 'DELIVERY_MISSION_LIMIT', message: 'Le journal de cette mission est complet. Contactez le responsable.' });
    }
    const state = missionState(before);
    const decision = assigning ? ordering.canAssignDeliveryMission(state) : ordering.canDispatchDeliveryMission(state);
    let refusalCode = decision.ok ? null : DeliveryMissionRefusalCodeSchema.parse(decision.error.code);
    let assignment = before.deliveryMission?.assignment ?? null;
    if (!refusalCode && assigning) {
      const assign = input as DeliveryMissionAssign;
      const target = assign.operatorId ? await this.operator(tenantId, assign.operatorId, assign.expectedOperatorRevision!) : null;
      if (assign.operatorId && !target) refusalCode = 'DELIVERY_OPERATOR_CHANGED';
      else assignment = target ? { operatorId: target._id, operatorName: target.name.trim().slice(0, 160) || 'Livreur',
        assignmentId: randomUUID(), assignedAt: new Date(), assignedBy: actorId } : null;
    } else if (!refusalCode && (!assignment || !await this.operator(tenantId, String(assignment.operatorId)))) {
      refusalCode = 'DELIVERY_OPERATOR_CHANGED';
    }
    const operation: MissionOperation = { operationId: input.operationId, fingerprint, action, revision: revision + 1,
      outcome: refusalCode ? 'rejected' : 'applied', refusalCode, reason: assigning ? (input as DeliveryMissionAssign).reason : null,
      at: new Date(), actorKind, actorId, actorRole: principal.kind === 'courier' ? 'livreur' : principal.actor.role,
      actorName: principal.kind === 'courier' ? principal.access.session.name : null,
      previousOperatorId: before.deliveryMission?.assignment?.operatorId ?? null,
      operatorId: assignment?.operatorId ?? null };
    const mission: MissionRecord = { version: 1, revision: revision + 1, assignment,
      operations: [...(before.deliveryMission?.operations ?? []), operation] };
    await this.authorize(tenantId, principal, assigning);
    const filter = { ...this.filter(tenantId, principal), _id: id, __v: before.__v ?? { $exists: false }, status: before.status,
      ...(!refusalCode ? { 'delivery.dispatchedAt': null } : {}),
      ...(before.deliveryMission ? { 'deliveryMission.version': 1, 'deliveryMission.revision': revision,
        'deliveryMission.assignment.assignmentId': before.deliveryMission.assignment?.assignmentId ?? null } : { deliveryMission: null }),
      ...(!refusalCode && !assigning ? { 'payment.status': 'paid', 'payment.refundedCents': { $in: [0, null] },
        'payment.pendingRefundCents': { $in: [0, null] }, 'paymentFlow.phase': { $in: [null, 'settled'] } } : {}),
    };
    let applied: boolean;
    try {
      const result = await this.orders.updateOne(filter, { $set: { deliveryMission: mission,
        ...(!refusalCode && !assigning ? { 'delivery.dispatchedAt': operation.at, 'delivery.driverName': assignment!.operatorName } : {}) },
        $inc: { __v: 1 } }, { runValidators: true, writeConcern });
      applied = result.modifiedCount === 1;
    } catch {
      // Seule la relecture majoritaire de l'opération exacte prouve un ACK perdu.
      let current: MissionOrder;
      try { current = await this.row(tenantId, id, principal); } catch { throw uncertain(); }
      const proof = current.deliveryMission?.operations.find(op => op.operationId === input.operationId);
      if (proof) return this.replay(tenantId, id, principal, proof, fingerprint);
      throw uncertain();
    }
    if (!applied) {
      const current = await this.row(tenantId, id, principal);
      const proof = current.deliveryMission?.operations.find(op => op.operationId === input.operationId);
      if (proof) return this.replay(tenantId, id, principal, proof, fingerprint);
      throw changed();
    }
    await this.publish(tenantId, id, operation);
    return DeliveryMissionResultSchema.parse({ operationId: input.operationId, appliedRevision: operation.revision, replay: false,
      outcome: operation.outcome, refusalCode: operation.refusalCode, mission: await this.get(tenantId, id, principal) });
  }

  private async replay(tenantId: string, id: string, principal: Principal, operation: MissionOperation, fingerprint: string): Promise<DeliveryMissionResult> {
    if (operation.fingerprint !== fingerprint) throw new ConflictException({ code: 'DELIVERY_MISSION_OPERATION_CONFLICT', message: 'Cette opération correspond à une autre action. Actualisez la mission.' });
    await this.authorize(tenantId, principal);
    await this.publish(tenantId, id, operation);
    return DeliveryMissionResultSchema.parse({ operationId: operation.operationId, appliedRevision: operation.revision, replay: true,
      outcome: operation.outcome, refusalCode: operation.refusalCode, mission: await this.get(tenantId, id, principal) });
  }

  private async publish(tenantId: string, id: string, operation: MissionOperation): Promise<void> {
    // Le refus est durable, mais ne prétend ni affectation ni départ effectué.
    if (operation.outcome === 'rejected') return;
    try {
      const actor: AuditActor = operation.actorKind === 'delivery'
        ? { kind: 'delivery', sub: operation.actorId, role: 'livreur', name: operation.actorName ?? 'Livreur' }
        : { kind: operation.actorKind, sub: operation.actorId, role: operation.actorRole as JwtPayload['role'] };
      await this.audit.logOnce({ tenantId, targetId: id, action: operation.action === 'dispatch' ? 'order.dispatch' : 'order.assign', actor,
        meta: { operationId: operation.operationId, revision: operation.revision, action: operation.action, at: new Date(operation.at).toISOString(),
          actorKind: operation.actorKind, actorId: operation.actorId, reason: operation.reason, previousOperatorId: operation.previousOperatorId ? String(operation.previousOperatorId) : null,
          operatorId: operation.operatorId ? String(operation.operatorId) : null } }, operation.operationId);
      const order = await this.orders.findOne({ _id: id, tenantId }).read('primary').readConcern('majority').maxTimeMS(10_000);
      if (!order) throw unavailable();
      const payload = order.toObject() as Record<string, unknown>;
      delete payload.deliveryMission;
      await this.redis.publish(ordersChannel(tenantId), JSON.stringify({ event: WS_EVENTS.orderUpdated, payload }));
    } catch { throw uncertain(); }
  }
}
