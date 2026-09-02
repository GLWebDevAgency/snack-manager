import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Order } from '@sm/db';
import { Model, Types } from 'mongoose';

const POS_ORDER_REFERENCE =
  /^pos-order:([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;

export const LOYALTY_POS_TICKET_REFERENCE_INVALID_CODE =
  'loyalty_pos_ticket_reference_invalid';
export const LOYALTY_POS_TICKET_NOT_ELIGIBLE_CODE =
  'loyalty_pos_ticket_not_eligible';
export const LOYALTY_POS_TICKET_AMOUNT_MISMATCH_CODE =
  'loyalty_pos_ticket_amount_mismatch';

interface PosOrderEvidence {
  channel?: unknown;
  status?: unknown;
  totals?: { total?: unknown } | null;
  payment?: { status?: unknown } | null;
}

export interface LoyaltyPurchaseClaim {
  tenantRef: string;
  memberId: string;
  externalRef: string;
  claimedPurchaseCents: number;
}

function invalidReference(): BadRequestException {
  return new BadRequestException({
    statusCode: 400,
    error: 'Bad Request',
    message: 'Référence de ticket POS invalide',
    code: LOYALTY_POS_TICKET_REFERENCE_INVALID_CODE,
  });
}

function ineligibleTicket(): ConflictException {
  return new ConflictException({
    statusCode: 409,
    error: 'Conflict',
    message: 'Ce ticket POS ne peut pas être crédité en fidélité',
    code: LOYALTY_POS_TICKET_NOT_ELIGIBLE_CODE,
  });
}

function amountMismatch(): ConflictException {
  return new ConflictException({
    statusCode: 409,
    error: 'Conflict',
    message: 'Le montant du ticket POS ne correspond pas à la commande encaissée',
    code: LOYALTY_POS_TICKET_AMOUNT_MISMATCH_CODE,
  });
}

/**
 * Preuve Mongo de l'achat qui autorise un gain dans le ledger PostgreSQL.
 *
 * La caisse ne décide ni du montant éligible ni de l'existence du ticket :
 * elle ne transmet qu'une référence opaque. La projection exclut toute donnée
 * client et le même message couvre ticket absent, voisin ou non éligible afin
 * de ne pas transformer cette route en oracle inter-tenant.
 */
@Injectable()
export class LoyaltyPurchaseVerifier {
  constructor(@InjectModel('Order') private readonly orders: Model<Order>) {}

  async confirmedPurchaseCents(claim: LoyaltyPurchaseClaim): Promise<number> {
    const match = POS_ORDER_REFERENCE.exec(claim.externalRef);
    if (!match) throw invalidReference();

    if (!Types.ObjectId.isValid(claim.tenantRef)) throw ineligibleTicket();

    const order = await this.orders
      .findOne(
        {
          tenantId: claim.tenantRef,
          clientId: match[1],
          loyaltyMemberId: claim.memberId,
        },
        {
          _id: 0,
          channel: 1,
          status: 1,
          loyaltyMemberId: 1,
          'payment.status': 1,
          'totals.total': 1,
        },
      )
      .lean<PosOrderEvidence | null>();

    const total = order?.totals?.total;
    if (
      !order ||
      order.channel !== 'pos' ||
      order.status !== 'delivered' ||
      order.payment?.status !== 'paid' ||
      typeof total !== 'number' ||
      !Number.isSafeInteger(total) ||
      total < 0
    ) {
      throw ineligibleTicket();
    }

    if (claim.claimedPurchaseCents !== total) throw amountMismatch();
    return total;
  }
}
