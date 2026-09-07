/**
 * Générateur d'historique réaliste — ~30 jours de commandes pour le tenant
 * pilote `classfood`, construites depuis les VRAIS produits Mongo (variantes,
 * options et prix résolus exactement comme orders.service).
 *
 *   MONGO_URL=mongodb://127.0.0.1:27017/snackmanager_disposable_classfood_local pnpm --filter @sm/db seed:orders
 * Jamais sur une base servie, staging ou production. Voir ../README.md.
 *
 * Réaliste : services 11h30-14h30 & 18h00-22h30 (bimodal, pas de déjeuner
 * lundi/vendredi), 55-75 commandes/jour, rush vendredi & samedi soir ×2.2,
 * canaux pos 60 % / online 25 % / phone 15 %, ~2 % annulées, ~3 % remisées,
 * statusHistory complet, numéros journaliers, journée en cours incluse avec
 * quelques commandes encore ouvertes (live).
 *
 * Idempotent : les commandes générées portent meta.note='seed-history' et sont
 * supprimées (avec les compteurs du tenant) avant chaque ré-exécution — les
 * commandes créées manuellement sont préservées.
 */
import { resolve } from 'node:path';
import { config as dotenv } from 'dotenv';
import mongoose, { Types } from 'mongoose';
import { MODELS } from './schemas';
import { assertDisposableMongoTarget, assertNoDurableOrderData } from './disposable-mongo-target';

dotenv({ path: resolve(__dirname, '../../../.env') });

const TZ = 'Europe/Paris';
const DAY_MS = 86_400_000;
const SEED_TAG = 'seed-history';
const HISTORY_DAYS = 30;

// ─── RNG déterministe (mulberry32, seed fixe) ───

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(0x5eedf00d);

const chance = (p: number): boolean => rand() < p;
const ri = (min: number, max: number): number => min + Math.floor(rand() * (max - min + 1));
function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(rand() * arr.length)]!;
}
function pickWeighted<T>(entries: readonly { item: T; weight: number }[]): T {
  const total = entries.reduce((s, e) => s + e.weight, 0);
  let r = rand() * total;
  for (const e of entries) {
    r -= e.weight;
    if (r <= 0) return e.item;
  }
  return entries[entries.length - 1]!.item;
}
function pickDistinct<T>(arr: readonly T[], n: number): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy.slice(0, Math.min(n, copy.length));
}
/** Gaussienne (Box-Muller) sur le RNG déterministe. */
function gauss(mean: number, sd: number): number {
  const u = Math.max(rand(), 1e-9);
  const v = rand();
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// ─── Fuseau Europe/Paris ───

const ymdFmt = new Intl.DateTimeFormat('fr-CA', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const wallFmt = new Intl.DateTimeFormat('fr-CA', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

function parisWallMs(d: Date): number {
  const get = (t: string) => Number(wallFmt.formatToParts(d).find((p) => p.type === t)?.value ?? 0);
  return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
}
/** Instant UTC d'une heure murale Paris. */
function parisWallToUtc(y: number, m: number, d: number, h = 0, min = 0): Date {
  const target = Date.UTC(y, m - 1, d, h, min);
  let ts = target;
  for (let i = 0; i < 2; i++) ts += target - parisWallMs(new Date(ts));
  return new Date(ts);
}
function parisYmd(d: Date): { y: number; m: number; d: number } {
  const [y, m, day] = ymdFmt.format(d).split('-').map(Number);
  return { y: y ?? 1970, m: m ?? 1, d: day ?? 1 };
}

// ─── Types locaux (projection des documents Mongo consommés) ───

type ProdDoc = {
  _id: Types.ObjectId;
  categoryId: Types.ObjectId | null;
  name: string;
  price: number;
  variants: { key: string; name: string; price: number }[];
  optionGroups: {
    key: string;
    name: string;
    type: 'single' | 'multi';
    min?: number | null;
    max?: number | null;
    choices: { key: string; name: string; priceDelta: number }[];
    perVariant?: Record<string, { min?: number; max?: number; priceDelta?: number }> | null;
  }[];
  removables: string[];
};

type OrderLine = {
  productId: Types.ObjectId;
  name: string;
  variantKey: string | null;
  variantName: string | null;
  options: { groupKey: string; choiceKey: string; name: string; priceDelta: number }[];
  removed: string[];
  note: string | null;
  qty: number;
  unitPrice: number;
  lineTotal: number;
};

// ─── Données FR ───

const CUSTOMERS = [
  'Karim B.', 'Sarah L.', 'Mehdi K.', 'Inès D.', 'Lucas M.', 'Emma P.', 'Yanis T.',
  'Léa G.', 'Sofiane R.', 'Camille F.', 'Adam Z.', 'Manon C.', 'Rayan H.', 'Chloé V.',
  'Nassim A.', 'Julie M.', 'Bilal O.', 'Laura S.', 'Hugo D.', 'Nadia B.', 'Théo L.',
  'Samira E.', 'Mattéo R.', 'Amine C.', 'Clara J.', 'Walid M.', 'Élodie N.', 'Kevin P.',
  'Fatima Z.', 'Romain G.', 'Yasmine K.', 'Antoine B.', 'Salma H.', 'Maxime T.',
  'Anissa M.', 'Damien F.', 'Khadija R.', 'Julien V.', 'Meriem S.', 'Nicolas D.',
];
const DISCOUNT_REASONS = [
  'Client fidèle',
  'Geste commercial',
  'Petit retard en cuisine',
  'Offre étudiant',
];
const LINE_NOTES = ['Bien cuit', 'Sauce à part', 'Peu salé', 'Coupé en deux'];
const ORDER_NOTES = ['Appeler en arrivant', 'Sans couverts', 'Ajouter des serviettes svp'];

const phone = (): string =>
  `06 ${ri(10, 99)} ${ri(10, 99)} ${ri(10, 99)} ${ri(10, 99)}`;

// ─── Construction d'une ligne depuis un vrai produit (logique orders.service) ───

function buildLine(prod: ProdDoc): OrderLine {
  let variantKey: string | null = null;
  let variantName: string | null = null;
  let unitPrice = prod.price;

  if (prod.variants.length > 0) {
    // Tailles moyennes favorisées (M/L avant XL/XXL)
    const weights = prod.variants.map((v, i) => ({ item: v, weight: prod.variants.length - i + 1 }));
    const variant = pickWeighted(weights);
    variantKey = variant.key;
    variantName = variant.name;
    unitPrice = variant.price;
  }

  const options: OrderLine['options'] = [];
  for (const group of prod.optionGroups) {
    if (group.choices.length === 0) continue;
    const rules = variantKey && group.perVariant ? group.perVariant[variantKey] : undefined;
    const min = rules?.min ?? group.min ?? 0;
    const maxRaw = rules?.max ?? group.max ?? (group.type === 'single' ? 1 : group.choices.length);
    const max = Math.min(maxRaw ?? group.choices.length, group.choices.length);
    if (max <= 0) continue;

    let count: number;
    if (min > 0) {
      count = min + (max > min && chance(0.12) ? 1 : 0);
    } else if (group.key === 'sauces') {
      count = pickWeighted([
        { item: 0, weight: 20 },
        { item: 1, weight: 50 },
        { item: 2, weight: 30 },
      ]);
    } else if (group.key.startsWith('supp')) {
      count = chance(0.12) ? 1 : 0;
    } else if (group.key === 'gratine') {
      count = chance(0.18) ? 1 : 0;
    } else {
      count = chance(0.15) ? 1 : 0;
    }
    count = Math.min(count, max);
    if (count <= 0) continue;

    for (const choice of pickDistinct(group.choices, count)) {
      // Même règle que orders.service : le delta perVariant du groupe prime
      const priceDelta = rules?.priceDelta ?? choice.priceDelta;
      unitPrice += priceDelta;
      options.push({ groupKey: group.key, choiceKey: choice.key, name: choice.name, priceDelta });
    }
  }

  const removed =
    prod.removables.length > 0 && chance(0.1) ? [pick(prod.removables)] : [];
  const qty = chance(0.87) ? 1 : 2;
  return {
    productId: prod._id,
    name: prod.name,
    variantKey,
    variantName,
    options,
    removed,
    note: chance(0.04) ? pick(LINE_NOTES) : null,
    qty,
    unitPrice,
    lineTotal: unitPrice * qty,
  };
}

// ─── Programme principal ───

async function main() {
  const uri = process.env.MONGO_URL;
  if (!uri) throw new Error('MONGO_URL manquant (racine .env)');
  const target = assertDisposableMongoTarget(uri);
  await mongoose.connect(target.uri, { directConnection: true, serverSelectionTimeoutMS: 5_000 });
  try {
    await assertNoDurableOrderData(mongoose.connection.db!);
    await writeOrderFixtures();
  } finally { await mongoose.disconnect(); }
}

async function writeOrderFixtures() {
  const db = mongoose.connection.db!;
  const ordersCol = db.collection('orders');
  const Counter = mongoose.model(MODELS.Counter.name, MODELS.Counter.schema, MODELS.Counter.collection);

  const tenant = await db.collection('tenants').findOne({ slug: 'classfood' });
  if (!tenant) throw new Error('Tenant classfood introuvable — lancer `pnpm --filter @sm/db seed` d’abord');
  const tenantId = tenant._id as Types.ObjectId;

  const staff = await db.collection('staff').find({ tenantId }).toArray();
  const staffId = (role: string): string => {
    const s = staff.find((x) => x.role === role) ?? staff[0];
    return s ? String(s._id) : 'system';
  };
  const CAISSE = staffId('caisse');
  const CUISINE = staffId('cuisine');
  const GERANT = staffId('gerant');

  const categories = await db.collection('categories').find({ tenantId }).toArray();
  const products = (await db
    .collection('products')
    .find({ tenantId, active: true })
    .toArray()) as unknown as ProdDoc[];
  if (products.length === 0) throw new Error('Aucun produit actif — lancer le seed du menu d’abord');

  // ─── Pools pondérés par catégorie (mix crédible) ───
  const catName = new Map(categories.map((c) => [String(c._id), String(c.name).toLowerCase()]));
  const byCat = (test: (name: string) => boolean): ProdDoc[] =>
    products.filter((p) => {
      const n = p.categoryId ? (catName.get(String(p.categoryId)) ?? '') : '';
      return test(n);
    });

  const tacos = byCat((n) => n.includes('tacos'));
  const burgers = byCat((n) => n.includes('burger') || n.includes('classique'));
  const sandwichs = byCat((n) => n.includes('sandwich'));
  const texmex = byCat((n) => n.includes('tex'));
  const drinks = byCat((n) => n.includes('boisson'));
  const desserts = byCat((n) => n.includes('dessert') || n.includes('glace') || n.includes('milkshake'));
  const matched = new Set([...tacos, ...burgers, ...sandwichs, ...texmex, ...drinks, ...desserts]);
  const others = products.filter((p) => !matched.has(p));

  const mainPools: { item: ProdDoc[]; weight: number }[] = [
    { item: tacos, weight: 22 },
    { item: burgers, weight: 25 },
    { item: sandwichs, weight: 18 },
    { item: texmex, weight: 10 },
    { item: others, weight: 23 },
    { item: drinks.length > 0 ? drinks : others, weight: 2 },
  ].filter((p) => p.item.length > 0);

  const pickMainProduct = (): ProdDoc => pick(pickWeighted(mainPools));

  // ─── Idempotence : purge des commandes générées + compteurs du tenant ───
  const purged = await ordersCol.deleteMany({ tenantId, 'meta.note': SEED_TAG });
  await Counter.deleteMany({ _id: { $regex: `^${String(tenantId)}:` } });
  console.log(`↻ ${purged.deletedCount} commande(s) seed purgée(s), compteurs réinitialisés`);

  // Numéros déjà pris par les commandes conservées (créées à la main)
  const kept = await ordersCol
    .aggregate([
      { $match: { tenantId } },
      {
        $group: {
          _id: { $dateToString: { date: '$createdAt', format: '%Y%m%d', timezone: TZ } },
          max: { $max: '$number' },
        },
      },
    ])
    .toArray();
  const existingMax = new Map<string, number>(kept.map((r) => [String(r._id), Number(r.max)]));

  // ─── Génération jour par jour ───
  const now = new Date();
  const today = parisYmd(now);
  const todayCal = Date.UTC(today.y, today.m - 1, today.d);
  type Pending = {
    t0: Date;
    doc: Record<string, unknown>;
    finalize: (number: number) => void;
  };
  const docs: Record<string, unknown>[] = [];
  let openToday = 0;

  const makeOrder = (t0: Date, dayKey: string, seq: number): Pending => {
    const channel = pickWeighted([
      { item: 'pos' as const, weight: 60 },
      { item: 'online' as const, weight: 25 },
      { item: 'phone' as const, weight: 15 },
    ]);
    const type =
      channel === 'pos' ? (chance(0.45) ? 'surplace' : 'emporter') : 'pickup';

    // Lignes : 1-3 produits principaux + boisson/dessert occasionnels
    const nMain = pickWeighted([
      { item: 1, weight: 55 },
      { item: 2, weight: 30 },
      { item: 3, weight: 15 },
    ]);
    const chosen: ProdDoc[] = [];
    for (let i = 0; i < nMain; i++) {
      const p = pickMainProduct();
      if (!chosen.some((c) => c._id.equals(p._id))) chosen.push(p);
    }
    const lines = chosen.map(buildLine);
    if (drinks.length > 0 && chance(0.5)) lines.push(buildLine(pick(drinks)));
    if (desserts.length > 0 && chance(0.12)) lines.push(buildLine(pick(desserts)));

    const subtotal = lines.reduce((s, l) => s + l.lineTotal, 0);
    const totalQty = lines.reduce((s, l) => s + l.qty, 0);

    // Remise occasionnelle (~3 %)
    let discount: { amount: number; reason: string; staffId: Types.ObjectId } | null = null;
    if (chance(0.03) && subtotal > 300) {
      const amount = Math.min(pick([100, 150, 200, Math.round(subtotal * 0.1 / 10) * 10]), subtotal - 100);
      if (amount > 0) {
        discount = { amount, reason: pick(DISCOUNT_REASONS), staffId: new Types.ObjectId(GERANT) };
      }
    }
    const total = subtotal - (discount?.amount ?? 0);

    // Chronologie : accepté 1-3 min, prêt 8-18 min selon taille, remis 2-6 min après
    const cancelled = chance(0.02);
    const createdBy = channel === 'online' ? 'online' : CAISSE;
    const acceptedAt = new Date(t0.getTime() + ri(60, 180) * 1000);
    const prepSec = Math.round(
      Math.min(18 * 60, Math.max(8 * 60, (7 + 1.7 * totalQty + rand() * 5) * 60)),
    );
    const readyAt = new Date(acceptedAt.getTime() + prepSec * 1000);
    const deliveredAt = new Date(readyAt.getTime() + ri(120, 360) * 1000);

    let status: string;
    let statusHistory: { status: string; at: Date; by: string }[];
    if (cancelled) {
      status = 'cancelled';
      statusHistory = [
        { status: 'new', at: t0, by: createdBy },
        { status: 'cancelled', at: new Date(t0.getTime() + ri(60, 360) * 1000), by: GERANT },
      ];
    } else if (deliveredAt <= now) {
      status = 'delivered';
      statusHistory = [
        { status: 'new', at: t0, by: createdBy },
        { status: 'preparing', at: acceptedAt, by: CUISINE },
        { status: 'ready', at: readyAt, by: CUISINE },
        { status: 'delivered', at: deliveredAt, by: CAISSE },
      ];
    } else if (readyAt <= now) {
      status = 'ready';
      statusHistory = [
        { status: 'new', at: t0, by: createdBy },
        { status: 'preparing', at: acceptedAt, by: CUISINE },
        { status: 'ready', at: readyAt, by: CUISINE },
      ];
    } else if (acceptedAt <= now) {
      status = 'preparing';
      statusHistory = [
        { status: 'new', at: t0, by: createdBy },
        { status: 'preparing', at: acceptedAt, by: CUISINE },
      ];
    } else {
      status = 'new';
      statusHistory = [{ status: 'new', at: t0, by: createdBy }];
    }

    // Paiement cohérent : en ligne payé d'avance, comptoir payé à la remise
    const method = channel === 'online' ? 'online' : 'counter';
    let payStatus: string;
    if (method === 'online') payStatus = cancelled ? 'refunded' : 'paid';
    else payStatus = status === 'delivered' ? 'paid' : 'pending';

    // Créneau de retrait pour online/phone (grille 10 min, nom client FR)
    const pickup =
      type === 'pickup'
        ? {
            slot: new Date(Math.ceil((t0.getTime() + ri(15, 35) * 60_000) / 600_000) * 600_000),
            customerName: pick(CUSTOMERS),
            customerPhone: chance(0.8) ? phone() : null,
          }
        : null;

    const lastAt = statusHistory[statusHistory.length - 1]?.at ?? t0;
    const doc: Record<string, unknown> = {
      _id: new Types.ObjectId(),
      tenantId,
      number: 0, // affecté après tri chronologique du jour
      clientId: `seed-${dayKey}-${String(seq).padStart(3, '0')}`,
      channel,
      type,
      lines,
      totals: { subtotal, discount, total },
      payment: {
        method,
        status: payStatus,
        stripePaymentIntentId: method === 'online' ? `pi_seed_${dayKey}_${seq}` : null,
      },
      status,
      statusHistory,
      pickup,
      note: chance(0.05) ? pick(ORDER_NOTES) : null,
      virtualBrandId: null,
      meta: { note: SEED_TAG },
      createdAt: t0,
      updatedAt: lastAt,
      __v: 0,
    };
    if (['new', 'preparing', 'ready'].includes(status)) openToday++;
    return { t0, doc, finalize: (n: number) => void (doc.number = n) };
  };

  /** Tire un horaire dans un service (pic gaussien, borné). */
  const serviceTime = (
    y: number,
    m: number,
    d: number,
    openH: number,
    openM: number,
    durMin: number,
    peakMin: number,
    sdMin: number,
  ): Date => {
    let min = gauss(peakMin, sdMin);
    if (min < 0 || min > durMin) min = gauss(peakMin, sdMin);
    min = Math.min(Math.max(min, 0), durMin);
    const open = parisWallToUtc(y, m, d, openH, openM);
    return new Date(open.getTime() + Math.round(min * 60) * 1000 + ri(0, 59) * 1000);
  };

  let totalGenerated = 0;
  const perDayCount: string[] = [];

  for (let back = HISTORY_DAYS - 1; back >= 0; back--) {
    const cal = new Date(todayCal - back * DAY_MS);
    const y = cal.getUTCFullYear();
    const m = cal.getUTCMonth() + 1;
    const d = cal.getUTCDate();
    const isoDay = cal.getUTCDay() === 0 ? 7 : cal.getUTCDay(); // 1 = lundi
    const dayKey = `${y}${String(m).padStart(2, '0')}${String(d).padStart(2, '0')}`;

    // Horaires réels Class'Food : pas de déjeuner lundi (1) ni vendredi (5)
    const hasLunch = isoDay !== 1 && isoDay !== 5;
    const variance = 0.85 + rand() * 0.3; // aléa météo/jour
    let lunchN = hasLunch ? Math.round(ri(24, 32) * variance) : 0;
    let dinnerN = Math.round(ri(32, 44) * variance);
    if (isoDay === 5 || isoDay === 6) dinnerN = Math.round(dinnerN * 2.2); // rush ven./sam. soir

    const times: Date[] = [];
    for (let i = 0; i < lunchN; i++) times.push(serviceTime(y, m, d, 11, 30, 180, 65, 40));
    for (let i = 0; i < dinnerN; i++) times.push(serviceTime(y, m, d, 18, 0, 270, 125, 55));
    times.sort((a, b) => a.getTime() - b.getTime());

    let pendings = times
      .filter((t) => t <= now) // la journée en cours s'arrête à l'heure actuelle
      .map((t, i) => makeOrder(t, dayKey, i + 1));

    // Journée en cours : garantit quelques commandes encore ouvertes (live)
    if (back === 0 && openToday === 0) {
      const extras = [4, 11, 19].map((minAgo, i) =>
        makeOrder(new Date(now.getTime() - minAgo * 60_000), dayKey, 900 + i),
      );
      pendings = [...pendings, ...extras].sort((a, b) => a.t0.getTime() - b.t0.getTime());
    }

    // Numérotation journalière après les commandes manuelles conservées
    const base = existingMax.get(dayKey) ?? 0;
    pendings.forEach((p, i) => p.finalize(base + i + 1));
    if (pendings.length > 0) {
      await Counter.updateOne(
        { _id: `${String(tenantId)}:${dayKey}` },
        { $set: { seq: base + pendings.length } },
        { upsert: true },
      );
    }
    docs.push(...pendings.map((p) => p.doc));
    totalGenerated += pendings.length;
    perDayCount.push(`${dayKey.slice(6)}/${dayKey.slice(4, 6)}: ${pendings.length}`);
  }

  if (docs.length > 0) await ordersCol.insertMany(docs, { ordered: false });
  console.log(`✓ ${totalGenerated} commandes générées sur ${HISTORY_DAYS} jours`);
  console.log(`  ${perDayCount.join(' · ')}`);

  // ─── Vérification : agrégat serveur (CA 30 j, moyenne/jour, live) ───
  const windowStart = parisWallToUtc(
    new Date(todayCal - (HISTORY_DAYS - 1) * DAY_MS).getUTCFullYear(),
    new Date(todayCal - (HISTORY_DAYS - 1) * DAY_MS).getUTCMonth() + 1,
    new Date(todayCal - (HISTORY_DAYS - 1) * DAY_MS).getUTCDate(),
  );
  const agg = await ordersCol
    .aggregate([
      {
        $match: {
          tenantId,
          status: { $in: ['ready', 'delivered'] },
          createdAt: { $gte: windowStart },
        },
      },
      { $group: { _id: null, ca: { $sum: '$totals.total' }, n: { $sum: 1 } } },
    ])
    .toArray();
  const ca = Number(agg[0]?.ca ?? 0);
  const n = Number(agg[0]?.n ?? 0);
  const euros = (c: number) => `${(c / 100).toFixed(2).replace('.', ',')} €`;
  console.log(`  CA 30 j (prêtes + livrées) : ${euros(ca)} — ${n} commandes`);
  console.log(`  CA moyen/jour : ${euros(Math.round(ca / HISTORY_DAYS))} — panier moyen : ${euros(n > 0 ? Math.round(ca / n) : 0)}`);

  const live = await ordersCol
    .aggregate([
      { $match: { tenantId, status: { $in: ['new', 'preparing', 'ready'] } } },
      { $group: { _id: '$status', n: { $sum: 1 } } },
    ])
    .toArray();
  console.log(`  Commandes ouvertes (live) : ${live.map((r) => `${String(r._id)}=${Number(r.n)}`).join(' ') || 'aucune'}`);

  if (ca <= 0) {
    throw new Error('CA 30 jours nul — génération invalide');
  }
}

/**
 * N'EXÉCUTE QUE LANCÉ DIRECTEMENT — jamais à l'import.
 *
 * Sans cette garde, importer ce fichier — pour tester une de ses fonctions, ou
 * par une chaîne d'imports involontaire — ouvre une connexion à la base pointée
 * par l'environnement et LANCE le traitement. Sur un poste dont le `.env` vise
 * la production, c'est un script d'administration qui part tout seul.
 */
if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
