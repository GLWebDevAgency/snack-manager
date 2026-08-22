/**
 * Générateur de la fixture de démonstration — `snapshot.ts`.
 *
 * Il ne fabrique rien : il PHOTOGRAPHIE une vraie carte servie par l'API, puis
 * l'anonymise. C'est la seule façon d'obtenir une démonstration où un
 * restaurateur reconnaît son métier — un jeu d'essai inventé sonne faux à la
 * troisième catégorie.
 *
 * Exécution (API locale branchée sur la base de staging) :
 *
 *   pnpm --filter @sm/client-core exec tsx src/demo/generate.ts
 *
 * Variables reconnues (toutes facultatives) :
 *   SM_API     racine de l'API           (défaut http://localhost:3001)
 *   SM_TENANT  slug à photographier      (défaut classfood)
 *   SM_PIN     code équipier pour /orders (défaut 1111)
 *
 * ─── ANONYMISATION ───
 *
 * Trois choses ne sortent jamais d'ici telles quelles :
 *   1. l'identité du restaurant  → « Le Comptoir », adresse et téléphones fictifs
 *      (les numéros sont pris dans la plage 06 39 98 xx xx réservée par l'ARCEP
 *      à la fiction : ils ne peuvent sonner chez personne) ;
 *   2. l'identité des clients    → prénoms courts inventés, téléphones fictifs ;
 *   3. les identifiants Mongo    → renumérotés (`p12`, `c3`, `o4`), ce qui
 *      supprime tout lien avec les enregistrements réels et allège la fixture.
 *
 * ─── COMPACITÉ ───
 *
 * La carte photographiée pèse 281 ko en JSON brut, dont 128 ko de pure
 * répétition : les mêmes onze sauces, les mêmes suppléments fromage sur des
 * dizaines de produits. La fixture les déclare une fois et les référence — 52
 * ko pour exactement la même carte, dans un paquet qui part aussi sur les
 * tablettes de production.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { MenuSupplement, OptionGroup, Variant } from '../types';

const API = process.env.SM_API ?? 'http://localhost:3001';
const TENANT = process.env.SM_TENANT ?? 'classfood';
const PIN = process.env.SM_PIN ?? '1111';

// ─────────────────────────────────────────────────────────────
// Formes servies par l'API (souples : on ne dépend pas des types serveur)
// ─────────────────────────────────────────────────────────────

interface ApiProduct {
  _id: string;
  name: string;
  description?: string;
  price?: number;
  variants?: Variant[];
  optionGroups?: OptionGroup[];
  removables?: { key: string; label: string }[];
  supplements?: MenuSupplement[];
  tags?: string[];
  isNew?: boolean;
  outOfStock?: boolean;
  active?: boolean;
}

interface ApiCategory {
  _id: string;
  name: string;
  products: ApiProduct[];
}

interface ApiOrderLine {
  productId: string;
  name: string;
  variantKey?: string | null;
  variantName?: string | null;
  options: { groupKey: string; choiceKey: string; name: string; priceDelta: number }[];
  removed: string[];
  note?: string | null;
  qty: number;
  unitPrice: number;
  lineTotal: number;
}

interface ApiOrder {
  _id: string;
  number: number;
  clientId: string;
  channel: string;
  type: string;
  lines: ApiOrderLine[];
  totals: { subtotal: number; discount?: unknown; total: number };
  payment: { method: string; tender?: string | null; status: string };
  status: string;
  pickup?: { slot: string; customerName: string; customerPhone?: string | null } | null;
  note?: string | null;
  createdAt: string;
}

// ─────────────────────────────────────────────────────────────
// Anonymisation
// ─────────────────────────────────────────────────────────────

const TENANT_NAME = 'Le Comptoir';
const TENANT_SLUG = 'le-comptoir';

/**
 * Noms portant la marque du restaurant photographié. Tout le reste du menu est
 * du vocabulaire de métier (kebab, tacos, américain) : le renommer rendrait la
 * démonstration moins reconnaissable, pas plus anonyme.
 */
const RENAME: Record<string, string> = {
  "Assiette Class'Food": 'Assiette Maison',
  'Class Bowl': 'Le Bowl',
  'Le Class Dog': 'Le Grand Dog',
};

/** Prénoms courts inventés — un client de démonstration n'a pas de nom. */
const FIRST_NAMES = ['Sarah', 'Malik', 'Théo', 'Inès', 'Yanis', 'Léa', 'Noé', 'Jade'];

/** Plage 06 39 98 xx xx : réservée à la fiction, elle ne sonne nulle part. */
const fakePhone = (i: number): string => `06 39 98 ${String(10 + i * 7).padStart(2, '0')} ${String(20 + i * 13).padStart(2, '0')}`;

const scrub = (text: string): string =>
  text.replace(/class'?\s*food/gi, TENANT_NAME).replace(/\bclass\b/gi, 'Maison');

const rename = (name: string): string => RENAME[name] ?? scrub(name);

// ─────────────────────────────────────────────────────────────
// Récupération
// ─────────────────────────────────────────────────────────────

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, init);
  if (!res.ok) throw new Error(`${path} → ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

async function staffToken(): Promise<string> {
  const { token } = await api<{ token: string }>('/auth/pin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tenantSlug: TENANT, pin: PIN }),
  });
  return token;
}

// ─────────────────────────────────────────────────────────────
// Émission
// ─────────────────────────────────────────────────────────────

const json = (value: unknown): string => JSON.stringify(value);

/** Table `clé: valeur` sur une ligne par entrée — relisible en revue de code. */
function record(entries: [string, unknown][]): string {
  return `{\n${entries.map(([k, v]) => `  ${JSON.stringify(k)}: ${json(v)},`).join('\n')}\n}`;
}

/**
 * Nomme un jeu de clés, une seule fois pour toutes ses occurrences.
 * Un jeu VIDE ne reçoit pas de nom : le produit n'aura pas le champ du tout.
 */
function intern(table: Map<string, string>, prefix: string, keys: string[]): string | null {
  if (keys.length === 0) return null;
  const sig = json(keys);
  const existing = table.get(sig);
  if (existing) return existing;
  const name = `${prefix}${table.size + 1}`;
  table.set(sig, name);
  return name;
}

async function main() {
  const token = await staffToken();
  const auth = { Authorization: `Bearer ${token}` };

  const tenant = await api<{ name: string; brandColor: string }>(`/public/tenants/${TENANT}`);
  const menu = await api<{ categories: ApiCategory[] }>(`/public/tenants/${TENANT}/menu`);
  const byStatus = await Promise.all(
    (['new', 'preparing', 'ready'] as const).map(async (status) => ({
      status,
      rows: (await api<{ rows: ApiOrder[] }>(`/orders?status=${status}`, { headers: auth })).rows,
    })),
  );

  // ── Catalogues partagés ──
  /** Groupes d'options distincts, dédupliqués sur leur contenu exact. */
  const groups = new Map<string, string>();
  const groupById: Record<string, OptionGroup> = {};
  /** Un supplément (clé → libellé + prix) n'existe qu'une fois. */
  const supplements: Record<string, MenuSupplement> = {};
  /** Un retrait (clé → libellé) n'existe qu'une fois. */
  const removables: Record<string, string> = {};
  /** Jeux de clés : « les 40 suppléments des sandwichs » est une seule ligne. */
  const supSets = new Map<string, string>();
  const remSets = new Map<string, string>();

  const productIds = new Map<string, string>();
  const products: unknown[] = [];
  const categories: unknown[] = [];

  for (const [ci, cat] of menu.categories.entries()) {
    const catId = `c${ci + 1}`;
    const ids: string[] = [];
    for (const p of cat.products) {
      const pid = `p${products.length + 1}`;
      productIds.set(p._id, pid);
      ids.push(pid);

      const gk: string[] = [];
      for (const g of p.optionGroups ?? []) {
        const sig = json(g);
        let key = groups.get(sig);
        if (!key) {
          key = `g${groups.size + 1}`;
          groups.set(sig, key);
          groupById[key] = g;
        }
        gk.push(key);
      }

      for (const s of p.supplements ?? []) supplements[s.key] = s;
      for (const r of p.removables ?? []) removables[r.key] = r.label;

      // Un jeu vide ne se nomme pas : le produit n'aura simplement pas le champ.
      const sKey = intern(supSets, 's', (p.supplements ?? []).map((s) => s.key));
      const rKey = intern(remSets, 'r', (p.removables ?? []).map((r) => r.key));

      products.push({
        id: pid,
        name: rename(p.name),
        ...(p.description ? { description: scrub(p.description) } : null),
        ...(p.price !== undefined ? { price: p.price } : null),
        ...(p.variants?.length ? { variants: p.variants } : null),
        ...(gk.length ? { groups: gk } : null),
        ...(sKey ? { supplements: sKey } : null),
        ...(rKey ? { removables: rKey } : null),
        ...(p.tags?.length ? { tags: p.tags } : null),
        ...(p.isNew ? { isNew: true } : null),
        ...(p.outOfStock ? { outOfStock: true } : null),
      });
    }
    categories.push({ id: catId, name: rename(cat.name), products: ids });
  }

  // ── Commandes en cours ──
  /**
   * On garde les VRAIES lignes (produits, options, prix), on jette tout le
   * reste : les commandes de test, les identités, et les horodatages. Une
   * commande figée il y a huit mois afficherait « 340 000 min » au minuteur de
   * la cuisine ; la fixture porte donc un ÂGE, que la démonstration convertit
   * en heure réelle au démarrage.
   */
  const AGES: Record<string, number[]> = { new: [2, 5, 9], preparing: [13, 17], ready: [22, 27] };
  const orders: unknown[] = [];
  let seat = 0;
  for (const { status, rows } of byStatus) {
    const ages = AGES[status] ?? [];
    const usable = rows
      .filter((o) => !/test/i.test(o.note ?? '') && !/test/i.test(o.pickup?.customerName ?? ''))
      .filter((o) => o.lines.every((l) => productIds.has(l.productId)))
      // Les plus fournies d'abord : une commande à quatre lignes montre mieux
      // ce que l'écran cuisine sait faire qu'une commande à une ligne.
      .sort((a, b) => b.lines.length - a.lines.length)
      .slice(0, ages.length);

    for (const [i, o] of usable.entries()) {
      const name = FIRST_NAMES[seat % FIRST_NAMES.length] ?? 'Sarah';
      orders.push({
        status,
        ageMin: ages[i] ?? 5,
        channel: o.channel,
        type: o.type,
        payment: { method: o.payment.method, tender: o.payment.tender ?? null, status: o.payment.status },
        ...(o.pickup ? { customerName: name, customerPhone: fakePhone(seat) } : null),
        ...(o.note ? { note: scrub(o.note) } : null),
        lines: o.lines.map((l) => ({
          productId: productIds.get(l.productId),
          variantKey: l.variantKey ?? null,
          options: l.options.map((opt) => ({ groupKey: opt.groupKey, choiceKey: opt.choiceKey })),
          removed: l.removed,
          ...(l.note ? { note: l.note } : null),
          qty: l.qty,
        })),
      });
      seat++;
    }
  }
  // Les plus anciennes portent les plus petits numéros — un service se lit ainsi.
  orders.sort((a, b) => (b as { ageMin: number }).ageMin - (a as { ageMin: number }).ageMin);

  const out = `/**
 * INSTANTANÉ DE DÉMONSTRATION — FICHIER GÉNÉRÉ, NE PAS ÉDITER À LA MAIN.
 *
 * D'où il vient : \`GET /public/tenants/:slug/menu\` et \`GET /orders\` de l'API
 * Snack Manager, photographiés le ${new Date().toISOString().slice(0, 10)} sur la base de STAGING,
 * puis anonymisés (restaurant « ${TENANT_NAME} », prénoms inventés, téléphones
 * de la plage fictive ARCEP, identifiants renumérotés).
 *
 * Comment le régénérer :
 *
 *   pnpm --filter @sm/client-core exec tsx src/demo/generate.ts
 *
 * (API locale sur http://localhost:3001 ; voir \`generate.ts\` pour les variables.)
 *
 * Forme COMPACTE assumée : les groupes d'options, suppléments et retraits sont
 * déclarés une fois et référencés par clé. \`fixture.ts\` les recompose en un
 * \`Menu\` ordinaire au démarrage. Écrit à plat, ce même contenu pèserait 281 ko
 * au lieu de 52 — dans un paquet qui part aussi sur les tablettes en service.
 *
 * ${products.length} produits · ${categories.length} catégories · ${orders.length} commandes en cours.
 */
import type { MenuSupplement, OptionGroup, Variant } from '../types';

export const SNAPSHOT_TENANT = {
  slug: ${json(TENANT_SLUG)},
  name: ${json(TENANT_NAME)},
  brandColor: ${json(tenant.brandColor)},
  logoUrl: null,
  address: '14 rue des Halles — 76000 Rouen',
  // Plages réservées par l'ARCEP à la fiction : elles ne sonnent nulle part.
  phones: ['01 99 00 12 34', '06 39 98 76 54'],
} as const;

/** Groupes d'options distincts de la carte. */
export const SNAPSHOT_GROUPS: Record<string, OptionGroup> = ${record(
    Object.entries(groupById),
  )};

/** Suppléments payants, dérivés des recettes côté serveur. */
export const SNAPSHOT_SUPPLEMENTS: Record<string, MenuSupplement> = ${record(
    Object.entries(supplements),
  )};

/** Retraits proposés, dérivés des recettes côté serveur : clé → libellé. */
export const SNAPSHOT_REMOVABLES: Record<string, string> = ${record(Object.entries(removables))};

/** Jeux de suppléments partagés par plusieurs produits. */
export const SNAPSHOT_SUPPLEMENT_SETS: Record<string, string[]> = ${record(
    [...supSets.entries()].map(([sig, key]) => [key, JSON.parse(sig) as string[]]),
  )};

/** Jeux de retraits partagés par plusieurs produits. */
export const SNAPSHOT_REMOVABLE_SETS: Record<string, string[]> = ${record(
    [...remSets.entries()].map(([sig, key]) => [key, JSON.parse(sig) as string[]]),
  )};

export interface SnapshotProduct {
  id: string;
  name: string;
  description?: string;
  price?: number;
  variants?: Variant[];
  /** Clés dans SNAPSHOT_GROUPS. */
  groups?: string[];
  /** Clé dans SNAPSHOT_SUPPLEMENT_SETS. */
  supplements?: string;
  /** Clé dans SNAPSHOT_REMOVABLE_SETS. */
  removables?: string;
  tags?: string[];
  isNew?: boolean;
  outOfStock?: boolean;
}

export const SNAPSHOT_PRODUCTS: SnapshotProduct[] = [
${products.map((p) => `  ${json(p)},`).join('\n')}
];

export const SNAPSHOT_CATEGORIES: { id: string; name: string; products: string[] }[] = [
${categories.map((c) => `  ${json(c)},`).join('\n')}
];

export interface SnapshotOrderLine {
  productId: string;
  variantKey: string | null;
  options: { groupKey: string; choiceKey: string }[];
  removed: string[];
  note?: string;
  qty: number;
}

export interface SnapshotOrder {
  status: 'new' | 'preparing' | 'ready';
  /** Âge en minutes au démarrage de la démonstration — jamais une date figée. */
  ageMin: number;
  channel: 'online' | 'pos' | 'phone';
  type: 'surplace' | 'emporter' | 'pickup';
  payment: { method: 'online' | 'counter'; tender: 'cash' | 'card' | 'online' | null; status: 'pending' | 'paid' };
  customerName?: string;
  customerPhone?: string;
  note?: string;
  lines: SnapshotOrderLine[];
}

/** Le service déjà en cours quand le visiteur arrive. */
export const SNAPSHOT_ORDERS: SnapshotOrder[] = [
${orders.map((o) => `  ${json(o)},`).join('\n')}
];
`;

  const here = dirname(fileURLToPath(import.meta.url));
  const file = join(here, 'snapshot.ts');
  writeFileSync(file, out, 'utf8');
  // eslint-disable-next-line no-console
  console.log(
    `snapshot.ts écrit — ${products.length} produits, ${categories.length} catégories, ${orders.length} commandes, ${(Buffer.byteLength(out) / 1024).toFixed(0)} ko`,
  );
}

void main();
