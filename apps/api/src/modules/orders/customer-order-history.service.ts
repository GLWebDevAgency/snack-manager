import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, type Model } from 'mongoose';
import type { Order } from '@sm/db';
import { CustomerOrdersQuerySchema, type CustomerOrdersQuery } from '@sm/contracts';
import { customerOrderOwnerFilter, validCustomerOrderOwner, type CustomerOrderOwner } from './customer-order-owner';
import { customerOrderDetail, customerOrderSummary, customerOrderReorder } from './customer-order-projection';
import { recoveryNotFound } from './order-recovery';

const SUMMARY = '_id number createdAt status type pickup.slot totals payment.method payment.status payment.refundedCents payment.pendingRefundCents';
const DETAIL = `${SUMMARY} lines note statusHistory.status statusHistory.at delivery.dispatchedAt delivery.deliveredAt delivery.estimatedMinutes`;
const REORDER = '_id number lines.productId lines.name lines.variantKey lines.variantName lines.qty lines.unitPrice lines.options.groupKey lines.options.choiceKey lines.removed';

/** Caller has authenticated the current protected principal. No lookup by phone, QR or clientId. */
@Injectable()
export class CustomerOrderHistoryService {
  constructor(@InjectModel('Order') private readonly orders: Model<Order>) {}
  private filter(owner: CustomerOrderOwner) {
    if (!validCustomerOrderOwner(owner)) throw recoveryNotFound();
    return { tenantId: new Types.ObjectId(owner.tenantRef), ...customerOrderOwnerFilter(owner),
      channel: 'online', type: { $in: ['pickup', 'delivery'] } };
  }
  async listForCustomer(owner: CustomerOrderOwner, raw: CustomerOrdersQuery) {
    const query = CustomerOrdersQuerySchema.parse(raw);
    const filter = { ...this.filter(owner),
      ...(query.filter === 'all' ? {} : { status: { $in: query.filter === 'active' ? ['new', 'preparing', 'ready'] : ['delivered', 'cancelled'] } }),
      ...(query.cursor ? { $or: [ { createdAt: { $lt: new Date(query.cursor.createdAt) } },
        { createdAt: new Date(query.cursor.createdAt), _id: { $lt: new Types.ObjectId(query.cursor.id) } } ] } : {}),
    };
    const rows = await this.orders.find(filter).select(SUMMARY).sort({ createdAt: -1, _id: -1 })
      .limit(query.limit + 1).read('primary').readConcern('majority').maxTimeMS(10_000).lean();
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return { orders: page.map(customerOrderSummary), nextCursor: rows.length > query.limit && last
      ? { createdAt: last.createdAt.toISOString(), id: String(last._id) } : null };
  }
  async detailForCustomer(owner: CustomerOrderOwner, orderId: string) {
    if (!/^[a-f0-9]{24}$/.test(orderId)) throw recoveryNotFound();
    const row = await this.orders.findOne({ ...this.filter(owner), _id: new Types.ObjectId(orderId) }).select(DETAIL)
      .read('primary').readConcern('majority').maxTimeMS(10_000).lean();
    if (!row) throw recoveryNotFound();
    return customerOrderDetail(row);
  }
  async reorderForCustomer(owner: CustomerOrderOwner, orderId: string) {
    if (!/^[a-f0-9]{24}$/.test(orderId)) throw recoveryNotFound();
    const row = await this.orders.findOne({ ...this.filter(owner), _id: new Types.ObjectId(orderId) }).select(REORDER)
      .read('primary').readConcern('majority').maxTimeMS(10_000).lean();
    if (!row) throw recoveryNotFound();
    return customerOrderReorder(row);
  }
}
