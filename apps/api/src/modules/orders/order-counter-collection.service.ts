import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { CollectOrderPaymentSchema, orderAccessScope, ordersChannel, WS_EVENTS, type CollectOrderPayment, type JwtPayload } from '@sm/contracts';
import type { Order } from '@sm/db';
import { Model, Types, type HydratedDocument } from 'mongoose';
import Redis from 'ioredis';
import { REDIS_PUB } from '../../redis.module';
import { CapacitesService } from '../../common/capacites';
import { AuditService } from '../audit/audit.module';
import { canCollectOrderAtCounter } from '../ordering/order-payment-lifecycle.service';

const ROLES: readonly JwtPayload['role'][] = ['owner', 'cogerant', 'gerant', 'caisse'];
const DURABLE_WRITE = { w: 'majority' as const, j: true, wtimeout: 10_000 };
const MAX_RETRIES = 8;
type OrderDocument = HydratedDocument<Order>;

/** Records an operator's receipt of money for an EXISTING order. No provider,
 * new order, cart or kitchen-status mutation belongs to this use case. */
@Injectable()
export class OrderCounterCollectionService {
  constructor(
    @InjectModel('Order') private readonly orders: Model<Order>,
    private readonly capacites: CapacitesService,
    private readonly audit: AuditService,
    @Inject(REDIS_PUB) private readonly redis: Redis,
  ) {}

  private conflict(operationConflict = false): never {
    throw new ConflictException({ code: operationConflict ? 'ORDER_COLLECTION_OPERATION_CONFLICT' : 'ORDER_COLLECTION_REJECTED',
      message: 'Encaissement non confirmé ou commande modifiée. Actualisez et reprenez la même opération sans encaisser une deuxième fois.' });
  }

  async collect(tenantId: string, id: string, actor: JwtPayload, input: unknown): Promise<OrderDocument> {
    if (actor.tenantId !== tenantId || !ROLES.includes(actor.role) || !['staff', 'user'].includes(actor.kind)) {
      throw new ForbiddenException('L’encaissement est réservé à la caisse ou à un responsable de cet établissement.');
    }
    const parsed = CollectOrderPaymentSchema.safeParse(input);
    if (!parsed.success) throw new BadRequestException('Paramètres d’encaissement invalides. Vérifiez le moyen de paiement et le montant reçu.');
    const body = parsed.data;
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException('Commande introuvable');
    const scope = orderAccessScope(await this.capacites.pourTenant(tenantId));
    if (scope === 'none') throw new NotFoundException('Commande introuvable');
    const filter = { _id: id, tenantId, ...(scope === 'online' ? { channel: 'online' } : {}) };
    for (let retry = 0; retry < MAX_RETRIES; retry++) {
      const order = await this.orders.findOne(filter).select('+paymentFlow +counterCollection')
        .read('primary').readConcern('majority').maxTimeMS(10_000);
      if (!order) throw new NotFoundException('Commande introuvable');
      if (order.counterCollection) {
        this.assertReplay(order, body);
        await this.publishReceipt(order);
        return order;
      }
      if (!['new', 'preparing', 'ready'].includes(order.status) || order.payment.status !== 'pending'
        || !canCollectOrderAtCounter(order)) this.conflict();
      const amount = order.totals.total;
      if (!Number.isSafeInteger(amount) || amount < 0 || amount > 100_000_000 || amount !== body.expectedTotalCents) this.conflict();
      const cashReceived = body.tender === 'cash' ? body.cashReceivedCents : null;
      if (cashReceived !== null && cashReceived < amount) throw new BadRequestException('Le montant reçu est inférieur au total de la commande.');
      const changeGiven = cashReceived === null ? null : cashReceived - amount;
      const receipt = { operationId: body.operationId, amountCents: amount, tender: body.tender,
        cashReceivedCents: cashReceived, changeGivenCents: changeGiven, collectedAt: new Date(),
        actor: { sub: actor.sub, role: actor.role, kind: actor.kind }, deviceId: actor.deviceId ?? null };
      const collected = await this.orders.findOneAndUpdate({ ...filter,
        __v: order.__v ?? { $exists: false }, 'payment.status': 'pending', counterCollection: null,
      }, { $set: { counterCollection: receipt, 'payment.method': 'counter', 'payment.status': 'paid',
        'payment.tender': body.tender, 'payment.cashReceived': cashReceived, 'payment.changeGiven': changeGiven },
        $inc: { __v: 1 } }, { new: true, writeConcern: DURABLE_WRITE })
        .select('+paymentFlow +counterCollection').read('primary');
      if (!collected) continue;
      await this.publishReceipt(collected);
      return collected;
    }
    throw new ServiceUnavailableException({ code: 'ORDER_COLLECTION_RECONCILIATION_REQUIRED',
      message: 'La commande évolue actuellement. Reprenez la même opération sans encaisser une deuxième fois.' });
  }

  private assertReplay(order: OrderDocument, body: CollectOrderPayment): void {
    const receipt = order.counterCollection!;
    if (receipt.operationId !== body.operationId) throw new ConflictException({ code: 'ORDER_COLLECTION_ALREADY_COLLECTED',
      message: 'Cette commande a déjà été encaissée depuis une autre opération. Ne percevez aucun nouveau paiement. Si des fonds ont déjà été reçus ici, faites vérifier la caisse.' });
    if (receipt.amountCents !== body.expectedTotalCents
      || receipt.tender !== body.tender || (receipt.cashReceivedCents ?? null) !== (body.tender === 'cash' ? body.cashReceivedCents : null)
      || order.payment.status === 'pending') this.conflict(true);
    // The immutable receipt proves only this collection. Replays after handoff
    // or refund return CURRENT state; they never rewrite it to paid.
  }

  private async publishReceipt(order: OrderDocument): Promise<void> {
    const receipt = order.counterCollection!;
    const tenantId = String(order.tenantId);
    try {
      await this.audit.logOnce({ tenantId, action: 'order.collect', targetId: order.id,
        actor: { sub: receipt.actor.sub, role: receipt.actor.role, kind: receipt.actor.kind } as Pick<JwtPayload, 'sub' | 'role' | 'kind'>,
        meta: { operationId: receipt.operationId, number: order.number, amountCents: receipt.amountCents,
          tender: receipt.tender, cashReceivedCents: receipt.cashReceivedCents ?? null,
          changeGivenCents: receipt.changeGivenCents ?? null, collectedAt: receipt.collectedAt.toISOString(),
          deviceId: receipt.deviceId ?? null },
      }, receipt.operationId);
      // At-least-once: a replay repairs failure after the Mongo commit. Model
      // transforms strip both private proofs from HTTP and socket payloads.
      await this.redis.publish(ordersChannel(tenantId), JSON.stringify({ event: WS_EVENTS.orderUpdated, payload: order.toObject() }));
    } catch {
      throw new ServiceUnavailableException({ code: 'ORDER_COLLECTION_RECONCILIATION_REQUIRED',
        message: 'Encaissement enregistré, synchronisation à reprendre avec la même opération. Ne réglez pas à nouveau.' });
    }
  }
}
