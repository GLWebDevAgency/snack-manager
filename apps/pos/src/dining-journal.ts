import type { DayEntry } from './pos-state';
import type { DiningOperation } from './dining-operation';
import type { ServerOrderRow } from './service-state';

/** Seule la commande confirmée fait foi, jamais les prix du brouillon. */
export function diningJournalEntry(operation: Extract<DiningOperation, { action: 'order' }>, row: ServerOrderRow): DayEntry {
  if (row.clientId !== operation.body.operationId || row.dining?.sessionId !== operation.sessionId
    || !/^[a-f0-9]{24}$/i.test(row._id) || !Number.isSafeInteger(row.number) || row.number < 1
    || row.channel !== 'pos' || row.type !== 'surplace' || !Number.isSafeInteger(row.totals?.total) || row.totals!.total! < 0
    || !row.lines?.length || row.lines.some((line) => !Number.isSafeInteger(line.qty) || line.qty < 1)
    || !row.createdAt || !Number.isFinite(Date.parse(row.createdAt)) || row.payment?.method !== 'counter'
    || !['pending', 'paid', 'refunded'].includes(row.payment.status ?? '')) {
    throw new Error('Commande de table non confirmée. Conservez sa référence et vérifiez le même envoi.');
  }
  // Ce journal conserve l'encaissement historique ; un remboursement n'est ni
  // un nouveau paiement ni une dette. Son état courant est affiché séparément.
  const paid = row.payment.status === 'paid' || row.payment.status === 'refunded';
  const discount = row.totals?.discount?.amount ?? 0;
  const total = row.totals!.total! + discount;
  if (!Number.isSafeInteger(discount) || discount < 0 || !Number.isSafeInteger(total)) throw new Error('Remise de table à vérifier avant de confirmer le journal.');
  const tender = row.payment.tender;
  if (paid && !['cash', 'card', 'meal_voucher'].includes(tender ?? '')) throw new Error('Règlement de table à vérifier avant de confirmer le journal.');
  return {
    clientId: row.clientId, localNumber: row.number, serverId: row._id, serverNumber: row.number,
    trackingToken: row.trackingToken ?? null, mode: 'surplace',
    method: !paid ? 'retrait' : tender === 'cash' ? 'especes' : tender === 'meal_voucher' ? 'tr' : 'cb',
    paid, total, ...(discount ? { discount } : {}),
    ...(row.payment.status === 'refunded' ? { refunded: true as const } : {}),
    items: row.lines.reduce((sum, line) => sum + line.qty, 0),
    customerName: null, at: Date.parse(row.createdAt),
    ...(operation.body.order.loyaltyEarnOperationId ? { loyalty: { state: 'awaiting_order' as const } } : {}),
    ...(paid && tender === 'cash' && Number.isSafeInteger(row.payment.cashReceived) && Number.isSafeInteger(row.payment.changeGiven)
      ? { received: row.payment.cashReceived!, change: row.payment.changeGiven! } : {}),
  };
}

/** Un acquittement répété ne remet jamais un ticket payé dans l'état « à payer ». */
export function appendDiningEntry(entries: readonly DayEntry[], entry: DayEntry): DayEntry[] {
  return entries.some((item) => item.clientId === entry.clientId || item.serverId === entry.serverId) ? [...entries] : [...entries, entry];
}
