import { ConflictException, NotFoundException } from '@nestjs/common';
import { CustomerAccountResponses, PublicOrderRejectionReasonSchema, type CustomerAccountEnvelope } from '@sm/contracts';
import type { OnlineOrderCheckoutService } from '../orders/online-order-checkout.service';
import { assertCustomerOrderOwner, type CustomerOrderOwner } from '../orders/customer-order-owner';
import { CustomerIdentityError } from './customer-identity.service';

export type CustomerCommercePrincipal = CustomerOrderOwner & { sessionId: string; expiresAt: number };
type Port = { checkout: Pick<OnlineOrderCheckoutService, 'createForCustomer' | 'listForCustomer' | 'detailForCustomer'>;
  authorize: () => Promise<CustomerCommercePrincipal>; slug: string; client: string; now: () => number };
type Request = { action: 'order-create'; request: CustomerAccountEnvelope<'order-create'>['request'] }
  | { action: 'orders'; request: CustomerAccountEnvelope<'orders'>['request'] }
  | { action: 'order-detail'; request: CustomerAccountEnvelope<'order-detail'>['request'] };
const rejectionMessages = {
  unavailable: 'Le restaurant ne peut pas accepter cette nouvelle commande pour le moment.',
  slot_unavailable: 'Ce créneau ne peut plus être réservé. Choisissez un autre créneau.',
  invalid_order: 'Cette configuration de commande ne peut plus être acceptée. Vérifiez votre panier.',
  abandoned: 'Cette tentative a été abandonnée avant la création de la commande.',
};

/** A PG authorization sample and Mongo commit are not a distributed transaction.
 * The initial owner is immutable; a final read fences personal responses. */
export async function customerCommerce(port: Port, input: Request) {
  const principal = await port.authorize();
  if (principal.expiresAt <= port.now()) throw new CustomerIdentityError('unauthorized');
  const owner = { parentRef: principal.parentRef, tenantRef: principal.tenantRef, accountId: principal.accountId };
  async function recheck() {
    const latest = await port.authorize();
    assertCustomerOrderOwner(owner, { parentRef: latest.parentRef, tenantRef: latest.tenantRef, accountId: latest.accountId });
    if (latest.sessionId !== principal.sessionId || latest.expiresAt <= port.now()
      || latest.expiresAt !== principal.expiresAt) throw new CustomerIdentityError('unauthorized');
    return owner;
  }
  async function query<T>(work: () => Promise<T>): Promise<T> {
    try { return await work(); }
    catch (error) {
      const response = error instanceof NotFoundException ? error.getResponse() : null;
      if (response && typeof response === 'object' && 'code' in response && response.code === 'ORDER_RECOVERY_NOT_FOUND') {
        await recheck();
        // The same fixed response covers absent orders and a different owner.
        // No raw exception message, identifier or existence signal survives.
        throw new CustomerIdentityError('not_found');
      }
      throw error;
    }
  }
  let result: unknown;
  if (input.action === 'orders') result = { expiresAt: principal.expiresAt, ...await query(() => port.checkout.listForCustomer(owner, input.request)) };
  else if (input.action === 'order-detail') result = { expiresAt: principal.expiresAt, order: await query(() => port.checkout.detailForCustomer(owner, input.request.orderId)) };
  else {
    try {
      result = { state: 'created', expiresAt: principal.expiresAt,
        order: await query(() => port.checkout.createForCustomer({ slug: port.slug, body: input.request, owner,
          sourceKey: `customer:${port.client}`, beforeCommit: recheck })) };
    } catch (error) {
      // Only a durable rejection from the common admission protocol is terminal.
      // Other failures may have committed and must stay uncertain for C01 recovery.
      const response = error instanceof ConflictException ? error.getResponse() : null;
      const row = response && typeof response === 'object' ? response as Record<string, unknown> : null;
      const reason = PublicOrderRejectionReasonSchema.safeParse(row?.reason);
      if (row?.code !== 'ORDER_ATTEMPT_REJECTED' || !reason.success) throw error;
      result = { state: 'rejected', expiresAt: principal.expiresAt, reason: reason.data, message: rejectionMessages[reason.data] };
    }
  }
  await recheck();
  return CustomerAccountResponses[input.action].parse(result);
}
