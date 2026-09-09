import type { CustomerOrderReorderResponse } from '@sm/contracts';
import { canSubmitCartLines, reconcile, type CartLine, type MenuIndex } from '../order/cart';

export type ReorderEntry = {
  name: string; qty: number; previousUnitPrice: number; priceChanged: boolean;
  line: CartLine | null; reason: string | null;
};
const safeMoney = (amount: number) => Number.isSafeInteger(amount) && amount >= 0;

/** A proposed new basket, not an old order or an automatic substitution.
 * Only explicit confirmation may persist these currently priced selections.
 * Notes, identity, slot, discounts, payment and order capabilities stay behind. */
export function previewReorder(source: CustomerOrderReorderResponse['lines'], index: MenuIndex) {
  let subtotal = 0;
  const entries: ReorderEntry[] = source.map((row, position) => {
    const entry: ReorderEntry = { name: row.name, qty: row.qty, previousUnitPrice: row.unitPrice,
      priceChanged: false, line: null, reason: null };
    const unavailable = (reason: string) => ({ ...entry, reason });
    if (!row.productId || row.options.some(option => !option.groupKey || !option.choiceKey)) {
      return unavailable('Les références de cet ancien article ne permettent pas de reprendre ses choix.');
    }
    if (!Number.isInteger(row.qty) || row.qty < 1 || row.qty > 50) return unavailable('Cette quantité doit être choisie à nouveau dans le menu.');
    const product = index.get(row.productId);
    if (!product) return unavailable('Cet article n’est plus proposé sur la carte en ligne.');
    if (product.outOfStock) return unavailable('Cet article est momentanément en rupture.');
    const original: CartLine = { lineId: `reorder-preview-${position}`, productId: row.productId,
      name: row.name, variantKey: row.variantKey, variantName: row.variantName, qty: row.qty,
      unitPrice: row.unitPrice, photoUrl: null, note: null, removed: [...row.removed],
      options: row.options.map(option => ({ groupKey: option.groupKey!, choiceKey: option.choiceKey!, groupName: '', name: '', priceDelta: 0 })) };
    const line = reconcile([original], index).lines[0];
    if (!line) return unavailable('Les variantes ou les choix ont changé. Personnalisez cet article à nouveau dans le menu.');
    if (!canSubmitCartLines([line])) return unavailable('Ces choix doivent être vérifiés à nouveau dans le menu.');
    const amount = line.unitPrice * line.qty;
    if (!safeMoney(line.unitPrice) || !safeMoney(amount) || !safeMoney(subtotal + amount)) return unavailable('Le prix de cet article doit être vérifié avec le restaurant.');
    subtotal += amount;
    return { ...entry, name: line.name, line, priceChanged: row.unitPrice !== line.unitPrice };
  });
  return { entries, lines: entries.flatMap(entry => entry.line ? [entry.line] : []), subtotal };
}
