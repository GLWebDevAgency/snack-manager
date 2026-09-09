import { CustomerOrdersPageSchema, CustomerOrderDetailResponseSchema, CustomerOrderReorderResponseSchema, type CustomerOrdersQuery } from '@sm/contracts';

function expiry(expiresAt: number, now: number, maximum: number) {
  if (expiresAt <= now || expiresAt > Math.min(maximum, now + 7 * 86_400_000)) throw new Error('Invalid private order response');
}
/** UTC timestamps and opaque ids form a stable descending, exclusive cursor. */
function before(a: { createdAt: string; id: string }, b: { createdAt: string; id: string }) {
  const difference = Date.parse(a.createdAt) - Date.parse(b.createdAt);
  return difference < 0 || (difference === 0 && a.id < b.id);
}
export function parseCustomerOrdersPage(raw: unknown, query: CustomerOrdersQuery, now = Date.now(), maximum = now + 7 * 86_400_000) {
  const page = CustomerOrdersPageSchema.parse(raw);
  expiry(page.expiresAt, now, maximum);
  if (page.orders.length > query.limit) throw new Error('Invalid private order response');
  let previous = query.cursor;
  const ids = new Set<string>();
  for (const row of page.orders) {
    const cursor = { createdAt: row.createdAt, id: row._id };
    const terminal = row.status === 'delivered' || row.status === 'cancelled';
    if (ids.has(row._id) || (previous && !before(cursor, previous))
      || (query.filter === 'active' && terminal) || (query.filter === 'past' && !terminal)) throw new Error('Invalid private order response');
    ids.add(row._id); previous = cursor;
  }
  if (page.nextCursor && (!page.orders.length || !previous || page.nextCursor.id !== previous.id
    || page.nextCursor.createdAt !== previous.createdAt)) throw new Error('Invalid private order response');
  return page;
}
export function parseCustomerOrderDetail(raw: unknown, orderId: string, now = Date.now(), maximum = now + 7 * 86_400_000) {
  const response = CustomerOrderDetailResponseSchema.parse(raw);
  expiry(response.expiresAt, now, maximum);
  if (response.order._id !== orderId) throw new Error('Invalid private order response');
  return response;
}

export function parseCustomerOrderReorder(raw: unknown, orderId: string, now = Date.now(), maximum = now + 7 * 86_400_000) {
  const response = CustomerOrderReorderResponseSchema.parse(raw);
  expiry(response.expiresAt, now, maximum);
  if (response.orderId !== orderId) throw new Error('Invalid private order response');
  return response;
}
