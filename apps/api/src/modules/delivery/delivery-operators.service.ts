import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Model, Types } from 'mongoose';
import {
  DELIVERY_INVITE_TTL_MS, DeliveryOperatorCreateSchema, DeliveryOperatorInviteSchema,
  DeliveryOperatorUpdateSchema, DeliveryOperatorViewSchema,
  DeliveryOperatorsQuerySchema, type DeliveryOperatorsQuery,
  type DeliveryOperatorCreate, type DeliveryOperatorInvitation, type DeliveryOperatorUpdate,
  type DeliveryOperatorView, type DeliveryOperatorsView, type JwtPayload,
} from '@sm/contracts';
import type { DeliveryOperator, Staff } from '@sm/db';

const LIMIT = 200;
const PRIVATE = '+creationHash +staffSessionVersion +sessionVersion +invite +session +history';
const writeConcern = { w: 'majority' as const, j: true, wtimeout: 10_000 };
type OperatorRow = DeliveryOperator & { _id: Types.ObjectId };
type StaffRow = Pick<Staff, 'name' | 'active' | 'sessionVersion'> & { _id: Types.ObjectId };
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const versionOf = (member: StaffRow) => String(member.sessionVersion ?? '0');
const displayName = (name: string) => name.trim().slice(0, 160) || 'Équipier';
const changed = () => new ConflictException({ code: 'DELIVERY_OPERATOR_CHANGED', message: 'Cet accès a changé. Actualisez la liste avant de réessayer.' });

/** La clé métier Staff est déterministe : pas de doublon même pendant la
 * construction d'un index sur un nouveau déploiement. Le requestId protège
 * aussi la création d'un livreur dédié contre les réponses réseau perdues. */
export function deliveryOperatorId(tenantId: string, input: DeliveryOperatorCreate): Types.ObjectId {
  const key = input.staffId ? ['staff', input.staffId] : ['request', input.requestId];
  return new Types.ObjectId(digest(JSON.stringify(['delivery-operator/v1', tenantId, ...key])).slice(0, 24));
}

@Injectable()
export class DeliveryOperatorsService {
  constructor(
    @InjectModel('DeliveryOperator') private readonly operators: Model<DeliveryOperator>,
    @InjectModel('Staff') private readonly staff: Model<Staff>,
  ) {}

  private event(action: 'created' | 'enabled' | 'revoked' | 'invited', revision: number, actor: JwtPayload) {
    return { at: new Date(), action, actorId: actor.sub, actorKind: actor.kind, revision };
  }

  private async member(tenantId: string, id: string): Promise<StaffRow | null> {
    return this.staff.findOne({ _id: id, tenantId }, { name: 1, active: 1, sessionVersion: 1 })
      .read('primary').readConcern('majority').maxTimeMS(10_000).lean();
  }

  private async row(tenantId: string, id: string): Promise<OperatorRow> {
    if (!/^[a-f0-9]{24}$/.test(id)) throw new NotFoundException('Accès livreur introuvable');
    const row = await this.operators.findOne({ _id: id, tenantId }).select(PRIVATE)
      .read('primary').readConcern('majority').maxTimeMS(10_000).lean();
    if (!row) throw new NotFoundException('Accès livreur introuvable');
    return row;
  }

  private view(row: OperatorRow, member: StaffRow | null): DeliveryOperatorView {
    const now = Date.now();
    const blockedReason = !row.staffId ? null : !member || member.active !== true ? 'staff_inactive'
      : row.staffSessionVersion !== versionOf(member) ? 'staff_changed' : null;
    const effectiveActive = row.active && blockedReason === null;
    return DeliveryOperatorViewSchema.parse({
      id: String(row._id), name: displayName(member?.name ?? row.name), staffId: row.staffId ? String(row.staffId) : null,
      active: row.active, effectiveActive, blockedReason, revision: row.revision,
      sessionState: !effectiveActive || !row.session || row.session.version !== row.sessionVersion ? 'not_connected'
        : row.session.expiresAt.getTime() > now ? 'connected' : 'expired',
      inviteExpiresAt: effectiveActive && row.invite && row.invite.expiresAt.getTime() > now ? row.invite.expiresAt.toISOString() : null,
    });
  }

  private async viewOf(row: OperatorRow): Promise<DeliveryOperatorView> {
    return this.view(row, row.staffId ? await this.member(String(row.tenantId), String(row.staffId)) : null);
  }

  async list(tenantId: string, raw: DeliveryOperatorsQuery = {}): Promise<DeliveryOperatorsView> {
    const query = DeliveryOperatorsQuerySchema.parse(raw);
    const rows = await this.operators.find({ tenantId, ...(query.after ? { _id: { $gt: query.after } } : {}) })
      .select(PRIVATE).sort({ _id: 1 }).limit(LIMIT + 1).read('primary').readConcern('majority').maxTimeMS(10_000).lean();
    const visible = rows.slice(0, LIMIT);
    const ids = visible.flatMap(row => row.staffId ? [row.staffId] : []);
    const [linked, candidates] = await Promise.all([
      this.staff.find({ tenantId, _id: { $in: ids } }, { name: 1, active: 1, sessionVersion: 1 })
        .read('primary').readConcern('majority').maxTimeMS(10_000).lean(),
      // Projection positive : jamais de salaire, PIN, pointage ou privilège RH.
      this.staff.aggregate<{ _id: Types.ObjectId; name: string }>([
        { $match: { tenantId: new Types.ObjectId(tenantId), active: true } },
        { $lookup: { from: 'delivery_operators', let: { staffId: '$_id', tenantId: '$tenantId' }, pipeline: [
          { $match: { $expr: { $and: [{ $eq: ['$tenantId', '$$tenantId'] }, { $eq: ['$staffId', '$$staffId'] }] } } },
          { $limit: 1 }, { $project: { _id: 1 } },
        ], as: 'deliveryAccess' } },
        { $match: { 'deliveryAccess.0': { $exists: false } } },
        { $sort: { name: 1, _id: 1 } }, { $limit: LIMIT + 1 }, { $project: { _id: 1, name: 1 } },
      ]).read('primary').readConcern('majority').option({ maxTimeMS: 10_000 }),
    ]);
    const byId = new Map(linked.map(member => [String(member._id), member]));
    return {
      operators: visible.map(row => this.view(row, byId.get(String(row.staffId)) ?? null)),
      candidates: candidates.slice(0, LIMIT).map(member => ({ id: String(member._id), name: displayName(member.name) })),
      truncated: candidates.length > LIMIT,
      nextCursor: rows.length > LIMIT ? String(visible.at(-1)!._id) : null,
    };
  }

  async create(tenantId: string, raw: DeliveryOperatorCreate, actor: JwtPayload): Promise<DeliveryOperatorView> {
    const input = DeliveryOperatorCreateSchema.parse(raw);
    const _id = deliveryOperatorId(tenantId, input);
    const creationHash = digest(JSON.stringify([input.staffId ?? null, input.name ?? null]));
    const existing = await this.operators.findOne({ _id, tenantId }).select(PRIVATE)
      .read('primary').readConcern('majority').maxTimeMS(10_000).lean();
    const verify = async (row: OperatorRow) => {
      if (row.creationHash !== creationHash) throw new ConflictException({
        code: 'DELIVERY_OPERATOR_REQUEST_CONFLICT', message: 'Cette tentative correspond à un autre accès. Vérifiez la liste avant de recommencer.',
      });
      // Un ancien accès révoqué reste révoqué : créer n'est pas réactiver.
      return this.viewOf(row);
    };
    if (existing) return verify(existing);
    const member = input.staffId ? await this.member(tenantId, input.staffId) : null;
    if (input.staffId && (!member || member.active !== true)) throw new NotFoundException('Équipier actif introuvable');
    try {
      await this.operators.create([{
        _id, tenantId, staffId: input.staffId ?? null, name: member?.name ?? input.name!, creationHash,
        active: true, revision: 0, sessionVersion: randomUUID(), staffSessionVersion: member ? versionOf(member) : null,
        history: [this.event('created', 0, actor)],
      }], { writeConcern });
    } catch (error) {
      // Collision ou ACK perdu : seul le document identique constitue preuve.
      const persisted = await this.operators.findOne({ _id, tenantId }).select(PRIVATE)
        .read('primary').readConcern('majority').maxTimeMS(10_000).lean();
      if (!persisted) throw error;
      return verify(persisted);
    }
    return this.viewOf(await this.row(tenantId, String(_id)));
  }

  async update(tenantId: string, id: string, raw: DeliveryOperatorUpdate, actor: JwtPayload): Promise<DeliveryOperatorView> {
    const input = DeliveryOperatorUpdateSchema.parse(raw);
    const before = await this.row(tenantId, id);
    const action = input.active ? 'enabled' : 'revoked';
    if (before.revision !== input.expectedRevision) {
      const last = before.history.at(-1);
      if (before.revision === input.expectedRevision + 1 && last?.revision === before.revision
        && last.action === action && last.actorId === actor.sub && last.actorKind === actor.kind) return this.viewOf(before);
      throw changed();
    }
    const member = before.staffId ? await this.member(tenantId, String(before.staffId)) : null;
    if (input.active && before.staffId && (!member || member.active !== true)) throw new ConflictException({
      code: 'DELIVERY_OPERATOR_STAFF_INACTIVE', message: 'Cet équipier est désactivé. Réactivez son profil avant de lui redonner un accès livraison.',
    });
    const updated = await this.operators.findOneAndUpdate({ _id: id, tenantId, revision: input.expectedRevision }, {
      $set: { active: input.active, sessionVersion: randomUUID(), invite: null, session: null,
        ...(input.active ? { staffSessionVersion: member ? versionOf(member) : null } : {}) },
      $inc: { revision: 1 }, $push: { history: this.event(action, input.expectedRevision + 1, actor) },
    }, { new: true, runValidators: true, writeConcern }).select(PRIVATE).lean();
    if (!updated) throw changed();
    return this.viewOf(updated);
  }

  async invitation(tenantId: string, id: string, expectedRevision: number, actor: JwtPayload): Promise<DeliveryOperatorInvitation> {
    DeliveryOperatorInviteSchema.parse({ expectedRevision });
    const before = await this.row(tenantId, id);
    if (before.revision !== expectedRevision) throw changed();
    const view = await this.viewOf(before);
    if (!view.effectiveActive) throw new ConflictException({
      code: 'DELIVERY_OPERATOR_INACTIVE', message: 'Réactivez cet accès avant d’associer un téléphone.',
    });
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + DELIVERY_INVITE_TTL_MS);
    const updated = await this.operators.findOneAndUpdate({ _id: id, tenantId, active: true, revision: expectedRevision }, {
      $set: { invite: { hash: digest(token), expiresAt }, session: null, sessionVersion: randomUUID() },
      $inc: { revision: 1 }, $push: { history: this.event('invited', expectedRevision + 1, actor) },
    }, { new: true, runValidators: true, writeConcern }).select(PRIVATE).lean();
    if (!updated) throw changed();
    return { operator: await this.viewOf(updated), token, expiresAt: expiresAt.toISOString() };
  }
}
