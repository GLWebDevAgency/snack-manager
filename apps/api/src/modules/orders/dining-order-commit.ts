import type { OrderDining } from '@sm/contracts';
import type { Order } from '@sm/db';
import type { HydratedDocument } from 'mongoose';

/** A server-owned admission boundary, after the ordinary pricing pipeline and
 * before Order insertion. The session commits the immutable candidate first. */
export interface DiningOrderCommitter {
  context: OrderDining;
  identity: { operationId: string; sessionId: string; payloadHash: string };
  assertExisting(order: HydratedDocument<Order>): Promise<void>;
  commit(candidate: Record<string, unknown>): Promise<{ order: HydratedDocument<Order>; created: boolean }>;
}
