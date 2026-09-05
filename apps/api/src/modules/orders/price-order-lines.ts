import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { CreateOrder } from '@sm/contracts';
import type { Product } from '@sm/db';

type MenuProduct = Pick<Product, 'name' | 'price' | 'variants' | 'optionGroups' | 'outOfStock'> & { _id: unknown };

/** Même calcul pour le devis public et l'écriture finale : jamais de prix client. */
export function priceOrderLines(products: readonly MenuProduct[], input: CreateOrder['lines']) {
  const byId = new Map(products.map((product) => [String(product._id), product]));
  let subtotal = 0;
  const lines = input.map((line) => {
    const prod = byId.get(line.productId);
    if (!prod) throw new NotFoundException(`Produit ${line.productId} introuvable`);
    if (prod.outOfStock) throw new ConflictException(`« ${prod.name} » est en rupture`);
    let variantName: string | null = null;
    let unitPrice = prod.price;
    if (prod.variants.length > 0) {
      const variant = prod.variants.find((value) => value.key === line.variantKey);
      if (!variant) throw new BadRequestException(`Variante requise pour « ${prod.name} »`);
      variantName = variant.name;
      unitPrice = variant.price;
    }
    const options = line.options.map((selection) => {
      const group = prod.optionGroups.find((value) => value.key === selection.groupKey);
      const choice = group?.choices.find((value) => value.key === selection.choiceKey);
      if (!group || !choice) throw new BadRequestException(`Option inconnue pour « ${prod.name} »`);
      const perVariant = line.variantKey && group.perVariant
        ? (group.perVariant as Record<string, { priceDelta?: number }>)[line.variantKey]
        : undefined;
      const priceDelta = perVariant?.priceDelta ?? choice.priceDelta;
      unitPrice += priceDelta;
      return { groupKey: group.key, choiceKey: choice.key, name: choice.name, priceDelta };
    });
    for (const group of prod.optionGroups) {
      const rules = line.variantKey && group.perVariant
        ? (group.perVariant as Record<string, { min?: number; max?: number }>)[line.variantKey]
        : undefined;
      const min = rules?.min ?? group.min ?? 0;
      const max = rules?.max ?? group.max ?? Infinity;
      const count = options.filter((option) => option.groupKey === group.key).length;
      if (count < min || count > max) {
        throw new BadRequestException(`« ${group.name} » : ${min === max ? min : `${min}–${max === Infinity ? '∞' : max}`} choix attendu(s) pour « ${prod.name} »`);
      }
    }
    const lineTotal = unitPrice * line.qty;
    if (!Number.isSafeInteger(lineTotal) || lineTotal < 0) throw new BadRequestException('Montant du produit invalide');
    subtotal += lineTotal;
    return {
      productId: prod._id,
      name: prod.name,
      variantKey: line.variantKey ?? null,
      variantName,
      options,
      removed: line.removed,
      note: line.note ?? null,
      qty: line.qty,
      unitPrice,
      lineTotal,
    };
  });
  if (!Number.isSafeInteger(subtotal)) throw new BadRequestException('Montant de commande invalide');
  return { subtotal, lines };
}
