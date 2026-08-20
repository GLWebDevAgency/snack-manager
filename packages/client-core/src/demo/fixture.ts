/**
 * Recomposition de l'instantané en données d'API ordinaires.
 *
 * `snapshot.ts` est volontairement compact (clés partagées, âges relatifs) :
 * c'est un format de STOCKAGE. Ce module en fait ce que les applications
 * attendent réellement — un `Menu`, un `TenantPublic`, des `Order` — et rien
 * au-delà ne sait que la fixture était compressée.
 *
 * Une chose ne se fige pas : le TEMPS. Les commandes portent un âge en minutes
 * et reçoivent leur horodatage au démarrage de la démonstration. Sans cela, le
 * minuteur de l'écran cuisine afficherait l'âge du fichier, et la caisse
 * classerait tout le service d'hier hors de sa journée.
 */
import type { Category, Menu, Order, OrderStatus, Product, TenantPublic } from '../types';
import {
  SNAPSHOT_CATEGORIES,
  SNAPSHOT_GROUPS,
  SNAPSHOT_ORDERS,
  SNAPSHOT_PRODUCTS,
  SNAPSHOT_REMOVABLES,
  SNAPSHOT_REMOVABLE_SETS,
  SNAPSHOT_SUPPLEMENTS,
  SNAPSHOT_SUPPLEMENT_SETS,
  SNAPSHOT_TENANT,
  type SnapshotOrder,
  type SnapshotProduct,
} from './snapshot';

/** Le restaurant de démonstration, tel que le sert `/public/tenants/:slug`. */
export const DEMO_TENANT: TenantPublic & { address: string; phones: string[] } = {
  slug: SNAPSHOT_TENANT.slug,
  name: SNAPSHOT_TENANT.name,
  brandColor: SNAPSHOT_TENANT.brandColor,
  logoUrl: SNAPSHOT_TENANT.logoUrl,
  address: SNAPSHOT_TENANT.address,
  phones: [...SNAPSHOT_TENANT.phones],
};

function hydrateProduct(p: SnapshotProduct): Product {
  const supplements = p.supplements ? (SNAPSHOT_SUPPLEMENT_SETS[p.supplements] ?? []) : [];
  const removables = p.removables ? (SNAPSHOT_REMOVABLE_SETS[p.removables] ?? []) : [];
  return {
    _id: p.id,
    name: p.name,
    ...(p.description ? { description: p.description } : null),
    ...(p.price !== undefined ? { price: p.price } : null),
    variants: p.variants ?? [],
    optionGroups: (p.groups ?? []).flatMap((key) => {
      const group = SNAPSHOT_GROUPS[key];
      return group ? [group] : [];
    }),
    removables: removables.flatMap((key) => {
      const label = SNAPSHOT_REMOVABLES[key];
      return label ? [{ key, label }] : [];
    }),
    supplements: supplements.flatMap((key) => {
      const supplement = SNAPSHOT_SUPPLEMENTS[key];
      return supplement ? [supplement] : [];
    }),
    tags: p.tags ?? [],
    isNew: p.isNew ?? false,
    outOfStock: p.outOfStock ?? false,
    active: true,
  };
}

/**
 * La carte complète — 109 produits sur 22 catégories, exactement celle qui a
 * été photographiée. C'est le volume qui rend la démonstration crédible : une
 * carte de six produits ne ressemble à aucun snack.
 */
export function demoMenu(): Menu {
  const byId = new Map<string, Product>(
    SNAPSHOT_PRODUCTS.map((p) => [p.id, hydrateProduct(p)]),
  );
  const categories: Category[] = SNAPSHOT_CATEGORIES.map((c) => ({
    _id: c.id,
    name: c.name,
    products: c.products.flatMap((id) => {
      const product = byId.get(id);
      return product ? [product] : [];
    }),
  }));
  return { categories };
}

/** Index produit — le transport de démonstration chiffre les commandes avec. */
export function indexProducts(menu: Menu): Map<string, Product> {
  const index = new Map<string, Product>();
  for (const category of menu.categories) {
    for (const product of category.products) index.set(product._id, product);
  }
  return index;
}

/**
 * Le service déjà en cours quand le visiteur arrive.
 *
 * Les prix sont RECALCULÉS depuis la carte par l'appelant, jamais recopiés :
 * une commande de démonstration doit obéir aux mêmes règles de tarification
 * que celles qu'on va prendre à l'écran, sinon l'addition ne tombe pas juste
 * au premier coup d'œil du restaurateur.
 */
export function demoSeedOrders(
  price: (line: SnapshotOrder['lines'][number]) => {
    name: string;
    variantName: string | null;
    options: { groupKey: string; choiceKey: string; name: string; priceDelta: number }[];
    unitPrice: number;
  },
  now: number,
  startNumber = 1,
): Order[] {
  return SNAPSHOT_ORDERS.map((seed, i) => {
    const at = new Date(now - seed.ageMin * 60_000).toISOString();
    const lines = seed.lines.map((line) => {
      const priced = price(line);
      return {
        productId: line.productId,
        name: priced.name,
        variantKey: line.variantKey,
        variantName: priced.variantName,
        options: priced.options,
        removed: line.removed,
        note: line.note ?? null,
        qty: line.qty,
        unitPrice: priced.unitPrice,
        lineTotal: priced.unitPrice * line.qty,
      };
    });
    const subtotal = lines.reduce((sum, l) => sum + l.lineTotal, 0);
    return {
      _id: `demo-order-${i + 1}`,
      number: startNumber + i,
      clientId: `demo-client-${i + 1}`,
      channel: seed.channel,
      type: seed.type,
      lines,
      totals: { subtotal, discount: null, total: subtotal },
      // `tender` — avec QUOI le client a payé — ne figure pas encore dans le
      // type `Order` du noyau, mais la clôture de caisse le lit pour ventiler
      // espèces / carte / en ligne. Une commande servie sans lui tomberait dans
      // la colonne « non renseigné » du Z, et le service de démonstration
      // n'aurait pas l'air de se recouper.
      payment: {
        method: seed.payment.method,
        tender: seed.payment.tender,
        status: seed.payment.status,
        cashReceived: null,
        changeGiven: null,
      } as Order['payment'],
      status: seed.status as OrderStatus,
      // Un ticket « prêt » est passé par « en préparation » : l'historique le
      // dit, sans quoi la fiche de suivi client afficherait un trou.
      statusHistory: historyFor(seed.status, at, now),
      pickup: seed.customerName
        ? {
            slot: new Date(now + 10 * 60_000).toISOString(),
            customerName: seed.customerName,
            customerPhone: seed.customerPhone ?? null,
          }
        : null,
      note: seed.note ?? null,
      createdAt: at,
    } satisfies Order;
  });
}

/** Étapes franchies par une commande arrivée à `status`, réparties dans le temps. */
function historyFor(
  status: SnapshotOrder['status'],
  createdAt: string,
  now: number,
): { status: OrderStatus; at: string }[] {
  const steps: OrderStatus[] = ['new', 'preparing', 'ready'];
  const reached = steps.slice(0, steps.indexOf(status) + 1);
  const from = Date.parse(createdAt);
  const span = Math.max(0, now - from);
  return reached.map((step, i) => ({
    status: step,
    at: new Date(from + (span * i) / Math.max(1, reached.length)).toISOString(),
  }));
}

/** Jeton de suivi de démonstration — même forme que le vrai, aucun secret. */
export const demoTrackingToken = (orderId: string): string => `demo-${orderId}`;

export type { SnapshotOrder, SnapshotProduct };
