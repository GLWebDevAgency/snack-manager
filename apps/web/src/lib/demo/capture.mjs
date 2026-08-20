/**
 * GÉNÉRATEUR DE LA FIXTURE DU BACK-OFFICE DE DÉMONSTRATION — écrit `snapshot.ts`.
 *
 * Il n'invente rien : il PHOTOGRAPHIE en LECTURE SEULE les réponses réelles de
 * l'API Snack Manager pour le compte gérant, puis les anonymise et les
 * dé-date. Écrire quarante-cinq charges utiles à la main produirait des formes
 * fausses — et une forme fausse, ici, ne se voit pas en revue de code : elle se
 * voit à l'écran, six semaines plus tard, sous la forme d'un tableau vide
 * devant un restaurateur qu'on essayait de convaincre.
 *
 * ─── EXÉCUTION ───
 *
 *   # API locale branchée sur la base de staging, gérant connu de cette base
 *   SM_EMAIL=… SM_PASSWORD=… node apps/web/src/lib/demo/capture.mjs
 *
 * Variables reconnues :
 *   SM_API       racine de l'API        (défaut http://localhost:3001)
 *   SM_EMAIL     e-mail du gérant       (obligatoire)
 *   SM_PASSWORD  mot de passe du gérant (obligatoire — il vient du .env RACINE,
 *                                        il ne doit être recopié nulle part)
 *
 * Le script n'émet QUE des GET, plus le POST /auth/login qui ouvre la session.
 * Il ne peut donc rien abîmer dans la base de staging.
 *
 * ─── ANONYMISATION (obligatoire, jamais négociable) ───
 *
 *   1. l'établissement devient « Le Comptoir », adresse et téléphones fictifs —
 *      le MÊME établissement que la démonstration de caisse, pour que les deux
 *      racontent une seule histoire ;
 *   2. aucun nom, téléphone ou e-mail réel ne survit : clients, équipiers et
 *      contacts fournisseurs reçoivent des prénoms courts inventés et des
 *      numéros pris dans les plages que l'ARCEP réserve à la fiction
 *      (01 99 00 xx xx, 06 39 98 xx xx) — ils ne sonnent chez personne ;
 *   3. les avis clients sont RÉÉCRITS, pas recopiés : on garde la note et
 *      l'ancienneté, le texte est neuf ;
 *   4. les identifiants Mongo/UUID sont renumérotés (`p12`, `c3`, `i7`), ce qui
 *      coupe tout lien avec les enregistrements réels et allège la fixture.
 *
 * ─── LES DATES NE SONT JAMAIS FIGÉES ───
 *
 * Aucune date absolue ne sort d'ici. Tout horodatage devient un ÂGE en minutes,
 * que `state.ts` reconvertit en date réelle au démarrage de la démonstration.
 * Sans cela, un visiteur qui arrive dans trois mois lirait « dernière commande
 * il y a 94 jours » au-dessus d'un graphique plat : la démonstration se
 * périmerait toute seule, sans que personne ne s'en aperçoive.
 *
 * ─── CE QUE LE GÉNÉRATEUR NE PEUT PAS PHOTOGRAPHIER ───
 *
 * Quatre listes reviennent VIDES de la base de staging : promotions, écrans TV,
 * mouvements de stock et noms de domaine. Les photographier donnerait quatre
 * écrans vides — exactement ce que la démonstration doit éviter. Elles sont
 * donc composées à la main dans `seed.ts`, à partir des types de
 * `@sm/contracts` (donc vérifiées par le compilateur, pas supposées), et le
 * script le signale à chaque exécution.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const API = process.env.SM_API ?? 'http://localhost:3001';
const EMAIL = process.env.SM_EMAIL;
const PASSWORD = process.env.SM_PASSWORD;

if (!EMAIL || !PASSWORD) {
  console.error('SM_EMAIL et SM_PASSWORD sont obligatoires (voir le .env RACINE).');
  process.exit(1);
}

// ─────────────────────────────────────────────────────────────
// Identité de démonstration
// ─────────────────────────────────────────────────────────────

const TENANT_NAME = 'Le Comptoir';
const TENANT_SLUG = 'le-comptoir';
const TENANT_ADDRESS = '14 rue des Halles — 76000 Rouen';
/** Plages réservées par l'ARCEP à la fiction : elles ne sonnent nulle part. */
const TENANT_PHONES = ['01 99 00 12 34', '06 39 98 76 54'];

/** Prénoms courts inventés : un client de démonstration n'a pas de patronyme. */
const CUSTOMERS = ['Sarah', 'Malik', 'Théo', 'Inès', 'Yanis', 'Léa', 'Noé', 'Jade', 'Ambre', 'Ilyes'];

/**
 * Équipe du Comptoir — inventée : les équipiers réels ne sortent pas de la
 * base. Les rôles sont les trois que l'API connaît (`gerant`, `caisse`,
 * `cuisine`) ; la base de staging n'en compte qu'un par rôle, ce qui donnerait
 * un planning à trois lignes — six lignes montrent enfin une semaine.
 */
const CREW = [
  { name: 'Karim', role: 'gerant' },
  { name: 'Sofia', role: 'caisse' },
  { name: 'Élodie', role: 'cuisine' },
  { name: 'Rayan', role: 'cuisine' },
  { name: 'Manon', role: 'caisse' },
  { name: 'Bilal', role: 'cuisine' },
];

/** Contacts fournisseurs — raisons sociales et interlocuteurs inventés. */
const SUPPLIER_ALIASES = [
  { name: 'Halles du Vexin', contactName: 'Nadia', phone: '01 99 00 21 40', email: 'commandes@halles-vexin.test' },
  { name: 'Grossiste Normandie Pro', contactName: 'Pierre', phone: '01 99 00 33 07', email: 'adv@normandie-pro.test' },
  { name: 'Cash & Food', contactName: 'Sonia', phone: '01 99 00 44 18', email: 'service.client@cash-food.test' },
  { name: 'Boissons Express', contactName: 'Hugo', phone: '01 99 00 55 62', email: 'contact@boissons-express.test' },
];

/**
 * Avis RÉÉCRITS. On conserve de l'original la note et l'ancienneté — c'est ce
 * qui fait la distribution d'étoiles et la fraîcheur de la page — et rien
 * d'autre. Le texte d'un client réel n'a pas à circuler dans une vitrine.
 */
const REVIEW_TEXTS = {
  5: [
    "Le tacos est énorme et la sauce maison change tout. Service rapide même le samedi soir.",
    "Commande en ligne prête à l'heure pile, tout était encore chaud. Rien à redire.",
    "Meilleur burger du quartier, la viande est vraiment bonne. L'équipe est adorable.",
    "On commande tous les vendredis, jamais déçus. Portions généreuses.",
    "Frites parfaites, bien croustillantes. Et l'accueil est top.",
    "Rapport qualité-prix imbattable, je recommande les yeux fermés.",
  ],
  4: [
    "Très bon dans l'ensemble, un peu d'attente au coup de feu mais ça vaut le coup.",
    "Bon produit, portions correctes. Je retire un point pour le manque de places assises.",
    "Sandwich très bon, j'aurais aimé un peu plus de sauce. Sinon parfait.",
  ],
  3: ["Correct sans plus ce soir-là, les frites étaient tièdes. Le reste était bon."],
  2: [
    "Trop d'attente pour une commande passée en ligne à l'avance, dommage.",
    "Il manquait une boisson dans le sac. Le tacos était bon en revanche.",
  ],
  1: ["Commande arrivée froide, je ne suis pas revenu depuis."],
};

/**
 * Réponses du gérant, réécrites et APPARIÉES À LA NOTE.
 *
 * Tirer la réponse au hasard produisait des attelages absurdes — « désolé pour
 * ce désagrément » sous un cinq étoiles enthousiaste. Personne ne lit une
 * vitrine ligne à ligne, mais celui qui le fait est justement celui qu'on
 * essaie de convaincre.
 */
const REVIEW_REPLIES = {
  good: [
    'Merci beaucoup, à très vite au comptoir !',
    'Merci pour votre retour, on transmet à toute l’équipe.',
    'Content que ça vous ait plu — au plaisir de vous revoir.',
  ],
  bad: [
    'Désolé pour cette attente, on a renforcé l’équipe du vendredi depuis. Au plaisir de vous revoir.',
    'Merci de nous l’avoir signalé — passez nous voir, on vous offre la boisson manquante.',
    'Navré pour ce service en dessous de nos standards. On aimerait vous revoir pour se rattraper.',
  ],
};

// ─────────────────────────────────────────────────────────────
// Outils
// ─────────────────────────────────────────────────────────────

async function api(path, init) {
  const res = await fetch(`${API}${path}`, init);
  const text = await res.text();
  if (!res.ok) throw new Error(`${path} → ${res.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

let TOKEN = '';
const auth = () => ({ Authorization: `Bearer ${TOKEN}` });
const GET = (path) => api(path, { headers: auth() });

const json = (v) => JSON.stringify(v);
/** Minutes écoulées entre `iso` et l'instant de capture (négatif = futur). */
const NOW = Date.now();
const ageMin = (iso) => Math.round((NOW - Date.parse(iso)) / 60000);

/**
 * Remplace TOUTE date ISO d'une structure par un jeton `@<âge en minutes>`.
 *
 * Les charges utiles très imbriquées (l'abonnement et ses factures) portent
 * une douzaine d'horodatages à des profondeurs variées ; les énumérer un par
 * un serait une source d'oublis, et un oubli ici, c'est une facture datée de
 * l'an dernier affichée comme la prochaine échéance.
 */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z?$/;
function stampAges(value) {
  if (typeof value === 'string') return ISO_DATE.test(value) ? `@${ageMin(value)}` : value;
  if (Array.isArray(value)) return value.map(stampAges);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, stampAges(v)]));
  }
  return value;
}

/** Table `clé: valeur`, une entrée par ligne — relisible en revue de code. */
const record = (entries) =>
  `{\n${entries.map(([k, v]) => `  ${json(String(k))}: ${json(v)},`).join('\n')}\n}`;
const list = (rows) => `[\n${rows.map((r) => `  ${json(r)},`).join('\n')}\n]`;

/** Nomme un jeu de clés une fois pour toutes ses occurrences. */
function intern(table, prefix, value) {
  const sig = json(value);
  const existing = table.get(sig);
  if (existing) return existing;
  const name = `${prefix}${table.size + 1}`;
  table.set(sig, name);
  return name;
}

/** Efface toute trace de l'enseigne photographiée dans un texte libre. */
const scrub = (text) =>
  String(text ?? '')
    .replace(/class'?\s*food/gi, TENANT_NAME)
    .replace(/\bclass\b/gi, 'Maison');

// ─────────────────────────────────────────────────────────────
// Capture
// ─────────────────────────────────────────────────────────────

async function main() {
  const { token } = await api('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: json({ email: EMAIL, password: PASSWORD }),
  });
  TOKEN = token;

  const empties = [];
  const note = (label, value) => {
    if (Array.isArray(value) ? value.length === 0 : !value) empties.push(label);
    return value;
  };

  const tenant = await GET('/tenants/me');
  const menu = await GET('/menu');
  const ingredients = await GET('/supply/ingredients');
  const suppliers = await GET('/supply/suppliers');
  const alerts = await GET('/supply/alerts');
  const reviews = await GET('/reviews');
  const reviewSummary = await GET('/reviews/summary');
  const devices = await GET('/devices');
  const billing = await GET('/billing/me?limit=200');
  const heatmap = await GET('/stats/heatmap');
  note('promotions', await GET('/promotions'));
  note('écrans TV', await GET('/screens'));
  note('mouvements de stock', await GET('/supply/movements?limit=200'));
  note('noms de domaine', (await GET('/site/domains')).domains);

  const PERIODS = ['1d', '7d', '30d'];
  const stats = {};
  for (const p of PERIODS) {
    stats[p] = {
      overview: await GET(`/stats/overview?period=${p}`),
      channels: await GET(`/stats/channels?period=${p}`),
      topProducts: await GET(`/stats/top-products?period=${p}&limit=8`),
      prepTimes: await GET(`/stats/prep-times?period=${p}`),
      timeseries: await GET(`/stats/timeseries?period=${p}`),
    };
  }

  const orderPages = {};
  for (const s of ['new', 'preparing', 'ready', 'delivered', 'cancelled']) {
    orderPages[s] = (await GET(`/orders?status=${s}`)).rows ?? [];
  }

  // ── Ingrédients : renumérotation et allègement ──
  const ingId = new Map();
  const ings = ingredients.map((ing, i) => {
    const id = `i${i + 1}`;
    ingId.set(ing.id, id);
    return {
      id,
      name: ing.name,
      category: ing.category,
      unit: ing.unit,
      allergens: ing.allergens ?? [],
      costPerUnitCents: ing.costPerUnitCents,
      currentStock: ing.currentStock,
      parLevel: ing.parLevel,
      storage: ing.storage,
      removable: ing.removable === true,
      supplementPriceCents: ing.supplementPriceCents ?? null,
      displayName: ing.displayName ?? null,
      isOut: ing.isOut === true,
      brands: (ing.brands ?? []).map((b, k) => ({
        id: `${id}b${k + 1}`,
        name: b.name,
        preferred: b.preferred === true,
        notes: b.notes ?? null,
      })),
    };
  });

  // ── Fournisseurs : raisons sociales et contacts remplacés ──
  const supId = new Map();
  const sups = suppliers.map((s, i) => {
    const alias = SUPPLIER_ALIASES[i % SUPPLIER_ALIASES.length];
    const id = `f${i + 1}`;
    supId.set(s.id, id);
    return {
      id,
      name: alias.name,
      contactName: alias.contactName,
      phone: alias.phone,
      email: alias.email,
      paymentTerms: s.paymentTerms ?? null,
      deliveryDays: s.deliveryDays ?? null,
      notes: scrub(s.notes ?? '') || null,
      active: s.active !== false,
      createdAtAgeMin: ageMin(s.createdAt),
      items: (s.items ?? [])
        .filter((it) => ingId.has(it.ingredientId))
        .map((it, k) => ({
          id: `${id}it${k + 1}`,
          ingredientId: ingId.get(it.ingredientId),
          brandId: null,
          sku: it.sku ?? null,
          packQty: it.packQty,
          packPriceCents: it.packPriceCents,
          active: it.active !== false,
          updatedAtAgeMin: ageMin(it.updatedAt),
        })),
    };
  });

  const priceIncreases = (alerts.priceIncreases ?? [])
    .filter((a) => ingId.has(a.ingredientId))
    .map((a, i) => ({
      itemId: `pi${i + 1}`,
      supplierId: supId.get(a.supplierId) ?? 'f1',
      ingredientId: ingId.get(a.ingredientId),
      sku: a.sku ?? null,
      previousPriceCents: a.previousPriceCents,
      packPriceCents: a.packPriceCents,
      increasePct: a.increasePct,
      recordedAtAgeMin: ageMin(a.recordedAt),
    }));

  // ── Carte : interning des blocs répétés ──
  const groups = new Map();
  const groupSets = new Map();
  const supSets = new Map();
  const remSets = new Map();
  const groupById = {};
  /**
   * Vingt-neuf suppléments distincts, deux mille trois cent cinquante
   * occurrences : les mêmes fromages et les mêmes viandes reviennent sur chaque
   * sandwich. Déclarés une fois et référencés par clé, ils pèsent deux kilo-
   * octets au lieu de quatre-vingt-onze.
   */
  const supplementById = {};
  const removableById = {};
  const prodId = new Map();
  const catId = new Map();
  const products = [];
  const categories = [];

  const takeProduct = (p, categoryKey) => {
    const id = `p${products.length + 1}`;
    prodId.set(p._id, id);
    const gkeys = (p.optionGroups ?? []).map((g) => {
      const sig = json(g);
      let key = groups.get(sig);
      if (!key) {
        key = `g${groups.size + 1}`;
        groups.set(sig, key);
        groupById[key] = g;
      }
      return key;
    });
    for (const s of p.supplements ?? []) supplementById[s.key] = s;
    for (const r of p.removables ?? []) removableById[r.key] = r.label;

    products.push({
      id,
      categoryId: categoryKey,
      name: scrub(p.name),
      description: scrub(p.description ?? ''),
      price: typeof p.price === 'number' ? p.price : 0,
      variants: p.variants ?? [],
      groupSet: gkeys.length ? intern(groupSets, 'G', gkeys) : null,
      supplementSet: (p.supplements ?? []).length
        ? intern(supSets, 'S', (p.supplements ?? []).map((s) => s.key))
        : null,
      removableSet: (p.removables ?? []).length
        ? intern(remSets, 'R', (p.removables ?? []).map((r) => r.key))
        : null,
      tags: p.tags ?? [],
      isNew: p.isNew === true,
      outOfStock: p.outOfStock === true,
      outOfStockSource: p.outOfStockSource ?? null,
      photoUrl: p.photoUrl ?? null,
      order: typeof p.order === 'number' ? p.order : 0,
      active: p.active !== false,
    });
    return id;
  };

  /**
   * Les brouillons de recette laissés dans la base de staging (« test »,
   * « produit test », « aaa »…) n'ont rien à faire dans une vitrine : un
   * restaurateur qui tombe sur une ligne « test » à 8,00 € comprend en une
   * seconde qu'on lui montre un bac à sable, et tout le reste perd son crédit.
   */
  const isDraft = (name) => /^\s*(test|aaa+|essai|toto|xxx)\b/i.test(name ?? '');

  for (const [ci, cat] of menu.categories.entries()) {
    if (isDraft(cat.name)) continue;
    const id = `c${ci + 1}`;
    catId.set(cat._id, id);
    categories.push({
      id,
      name: scrub(cat.name),
      order: typeof cat.order === 'number' ? cat.order : ci,
      active: cat.active !== false,
    });
    for (const p of cat.products ?? []) if (!isDraft(p.name)) takeProduct(p, id);
  }
  for (const p of menu.uncategorized ?? []) if (!isDraft(p.name)) takeProduct(p, null);

  // ── Recettes (BOM) : lignes compactes, chiffres recalculés à l'exécution ──
  const boms = {};
  for (const [realId, id] of prodId.entries()) {
    let bom;
    try {
      bom = await GET(`/supply/products/${realId}/bom`);
    } catch {
      continue;
    }
    const base = (bom.recipes ?? []).find((r) => r.variantKey === null || r.variantKey === 'base');
    const lines = (base?.lines ?? [])
      .filter((l) => ingId.has(l.ingredientId))
      .map((l) => [ingId.get(l.ingredientId), l.qty, l.unit]);
    const options = (bom.options ?? [])
      .filter((o) => ingId.has(o.ingredientId))
      .map((o) => [o.groupKey, o.choiceKey, ingId.get(o.ingredientId), o.qty, o.unit]);
    if (lines.length === 0 && options.length === 0) continue;
    boms[id] = { lines, options };
  }

  // ── Commandes du service : identités effacées, ancienneté conservée ──
  //
  // Une commande ne porte JAMAIS sa date : elle porte son âge, et cet âge est
  // recalé sur le service en cours au moment de la visite. Les statuts encore
  // ouverts (nouveau, en préparation, prêt) sont récents par construction ;
  // les commandes servies remontent la journée.
  const AGE_PLAN = {
    new: [2, 4, 7, 11, 16],
    preparing: [9, 14, 19, 24],
    ready: [21, 28, 34],
    delivered: [46, 58, 71, 85, 98, 114, 131, 149, 168, 190, 215, 242],
    cancelled: [77, 163],
  };

  let seat = 0;
  const orders = [];
  for (const [status, ages] of Object.entries(AGE_PLAN)) {
    const usable = (orderPages[status] ?? [])
      .filter((o) => !/test/i.test(o.note ?? ''))
      .filter((o) => !/test/i.test(o.pickup?.customerName ?? ''))
      .filter((o) => (o.lines ?? []).every((l) => prodId.has(l.productId)))
      .filter((o) => (o.lines ?? []).length > 0)
      // Les commandes les plus fournies d'abord : elles montrent mieux ce que
      // l'écran sait faire d'une ligne à options qu'une canette seule.
      .sort((a, b) => b.lines.length - a.lines.length)
      .slice(0, ages.length);

    for (const [i, o] of usable.entries()) {
      const name = CUSTOMERS[seat % CUSTOMERS.length];
      orders.push({
        ageMin: ages[i],
        number: 0, // renuméroté après tri
        channel: o.channel,
        type: o.type,
        status,
        payment: {
          method: o.payment?.method ?? 'counter',
          tender: o.payment?.tender ?? null,
          status: o.payment?.status ?? 'pending',
          cashReceived: o.payment?.cashReceived ?? null,
          changeGiven: o.payment?.changeGiven ?? null,
        },
        pickup: o.pickup
          ? {
              slotAgeMin: ages[i] - 15,
              customerName: name,
              customerPhone: `06 39 98 ${String(10 + seat * 7).padStart(2, '0')} ${String(20 + (seat * 13) % 80).padStart(2, '0')}`,
            }
          : null,
        note: o.note ? scrub(o.note) : null,
        lines: (o.lines ?? []).map((l) => ({
          productId: prodId.get(l.productId),
          name: scrub(l.name),
          variantKey: l.variantKey ?? null,
          variantName: l.variantName ?? null,
          options: (l.options ?? []).map((op) => ({
            groupKey: op.groupKey,
            choiceKey: op.choiceKey,
            name: op.name,
            priceDelta: op.priceDelta,
          })),
          removed: l.removed ?? [],
          note: l.note ?? null,
          qty: l.qty,
          unitPrice: l.unitPrice,
          lineTotal: l.lineTotal,
        })),
        totals: {
          subtotal: o.totals?.subtotal ?? 0,
          discount: o.totals?.discount ?? null,
          total: o.totals?.total ?? 0,
        },
      });
      seat++;
    }
  }
  // Les plus anciennes portent les plus petits numéros : un service se lit ainsi.
  orders.sort((a, b) => b.ageMin - a.ageMin);
  orders.forEach((o, i) => {
    o.number = i + 1;
  });

  // ── Avis : note et ancienneté conservées, texte neuf ──
  const used = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  const reviewRows = reviews.map((r, i) => {
    const rating = Math.min(5, Math.max(1, Math.round(r.rating)));
    const pool = REVIEW_TEXTS[rating];
    const text = pool[used[rating]++ % pool.length];
    return {
      id: `av${i + 1}`,
      author: `${CUSTOMERS[i % CUSTOMERS.length]} ${'BCDLMPRT'[i % 8]}.`,
      rating,
      text,
      createdAtAgeMin: ageMin(r.createdAt),
      reply: r.reply
        ? {
            text: (rating >= 4 ? REVIEW_REPLIES.good : REVIEW_REPLIES.bad)[i % 3],
            atAgeMin: ageMin(r.reply.at),
            by: 'gerant',
          }
        : null,
    };
  });

  // ── Postes (caisses / écrans cuisine) ──
  const deviceRows = devices.map((d, i) => ({
    id: `d${i + 1}`,
    name: d.name,
    kind: d.kind,
    paired: d.paired === true,
    lastSeenAtAgeMin: d.lastSeenAt ? ageMin(d.lastSeenAt) : null,
    active: d.active !== false,
  }));

  // ── Abonnement : réponse réelle, dates remplacées par des âges ──
  //
  // La charge utile de `/billing/me` est profonde (abonnement, échéance,
  // encours, factures, mentions légales manquantes) et l'écran en consomme
  // presque tous les champs. On la garde donc ENTIÈRE plutôt que d'en
  // recomposer une approximation : seuls le nom de l'établissement et les
  // horodatages changent. `state.ts` en déroule ensuite douze mois de
  // factures — la base de staging n'en compte que trois, ce qui donnerait un
  // historique d'abonnement plus court que le tunnel d'inscription.
  const billingOut = stampAges({
    ...billing,
    tenant: { id: 't1', name: TENANT_NAME, slug: TENANT_SLUG },
    invoices: (billing.invoices ?? []).map((inv) => ({ ...inv, tenantId: 't1' })),
  });

  // ── Statistiques : agrégats réels, courbes recalées sur l'horloge ──
  //
  // On garde les MAGNITUDES mesurées (chiffre d'affaires, panier moyen, mix des
  // canaux, temps de préparation) et la forme de la journée (carte de chaleur
  // jour × heure). Les libellés de la série temporelle, eux, sont reconstruits
  // à l'exécution : un axe qui dirait « Ven, Sam, Dim » un mardi trahirait la
  // fixture au premier coup d'œil.
  const statsOut = {};
  for (const p of PERIODS) {
    const s = stats[p];
    statsOut[p] = {
      caCents: s.overview.caCents,
      orders: s.overview.orders,
      avgBasketCents: s.overview.avgBasketCents,
      deltas: s.overview.deltas,
      channels: s.channels.map((c) => ({ channel: c.channel, orders: c.orders, caCents: c.caCents })),
      topProducts: s.topProducts.map((t) => ({ name: scrub(t.name), qty: t.qty, caCents: t.caCents })),
      prepTimes: { avgMinutes: s.prepTimes.avgMinutes, p90Minutes: s.prepTimes.p90Minutes, orders: s.prepTimes.orders },
      bucketCount: (s.timeseries.buckets ?? []).length,
      /** Poids relatif de chaque créneau, normalisé — les libellés sont refaits. */
      bucketWeights: (s.timeseries.buckets ?? []).map((b) => b.caCents),
    };
  }

  // ─────────────────────────────────────────────────────────────
  // Émission
  // ─────────────────────────────────────────────────────────────

  const day = new Date(NOW).toISOString().slice(0, 10);
  const out = `/**
 * INSTANTANÉ DU BACK-OFFICE DE DÉMONSTRATION — FICHIER GÉNÉRÉ, NE PAS ÉDITER.
 *
 * D'où il vient : les réponses réelles de l'API Snack Manager pour le compte
 * gérant, photographiées EN LECTURE SEULE le ${day} sur la base de STAGING,
 * puis anonymisées (établissement « ${TENANT_NAME} », prénoms inventés,
 * numéros de la plage fictive ARCEP, avis réécrits, identifiants renumérotés).
 *
 * Comment le régénérer :
 *
 *   SM_EMAIL=… SM_PASSWORD=… node apps/web/src/lib/demo/capture.mjs
 *
 * (voir l'en-tête de \`capture.mjs\` — les identifiants sont dans le .env RACINE
 * et n'ont à être recopiés nulle part.)
 *
 * AUCUNE DATE ABSOLUE ICI : tout horodatage est un ÂGE EN MINUTES au moment de
 * la photo, que \`state.ts\` reconvertit en date réelle au démarrage. C'est ce
 * qui empêche la démonstration de se périmer toute seule.
 *
 * Forme COMPACTE assumée : groupes d'options, suppléments et retraits sont
 * déclarés une fois et référencés par clé ; les recettes ne portent que
 * l'ingrédient, la quantité et l'unité — coûts, allergènes et ruptures sont
 * recalculés à l'exécution depuis l'état vivant des ingrédients, ce qui fait
 * réagir la marge quand le visiteur touche un stock.
 *
 * ${products.length} produits · ${categories.length} catégories · ${orders.length} commandes · ${ings.length} ingrédients ·
 * ${sups.length} fournisseurs · ${reviewRows.length} avis · ${Object.keys(boms).length} recettes.
 *
 * Vides dans la base au moment de la photo, donc composés à la main dans
 * \`seed.ts\` (types \`@sm/contracts\`, vérifiés par le compilateur) :
 * ${empties.length ? empties.join(', ') : 'aucun'}.
 */

export const SNAP_TENANT = {
  slug: ${json(TENANT_SLUG)},
  name: ${json(TENANT_NAME)},
  brandColor: ${json(tenant.brandColor ?? '#c9a15a')},
  logoUrl: null as string | null,
  address: ${json(TENANT_ADDRESS)},
  phones: ${json(TENANT_PHONES)},
  plan: ${json(tenant.plan ?? 'complet')},
  hours: ${json(tenant.hours ?? [])},
  closures: ${json(tenant.closures ?? [])},
  settings: ${json({ ...tenant.settings, pauseMessage: scrub(tenant.settings?.pauseMessage ?? '') })},
};

/** Groupes d'options distincts de la carte. */
export const SNAP_GROUPS: Record<string, unknown> = ${record(Object.entries(groupById))};

/** Jeux de groupes partagés par plusieurs produits. */
export const SNAP_GROUP_SETS: Record<string, string[]> = ${record(
    [...groupSets.entries()].map(([sig, key]) => [key, JSON.parse(sig)]),
  )};

/** Suppléments payants distincts : clé → libellé, prix, famille. */
export const SNAP_SUPPLEMENTS: Record<string, unknown> = ${record(
    Object.entries(supplementById),
  )};

/** Retraits proposés distincts : clé → libellé. */
export const SNAP_REMOVABLES: Record<string, string> = ${record(
    Object.entries(removableById),
  )};

/** Jeux de suppléments partagés par plusieurs produits (clés). */
export const SNAP_SUPPLEMENT_SETS: Record<string, string[]> = ${record(
    [...supSets.entries()].map(([sig, key]) => [key, JSON.parse(sig)]),
  )};

/** Jeux de retraits partagés par plusieurs produits (clés). */
export const SNAP_REMOVABLE_SETS: Record<string, string[]> = ${record(
    [...remSets.entries()].map(([sig, key]) => [key, JSON.parse(sig)]),
  )};

export const SNAP_CATEGORIES = ${list(categories)};

export const SNAP_PRODUCTS = ${list(products)};

/** Recettes compactes : \`[ingrédient, quantité, unité]\`. */
export const SNAP_BOMS: Record<string, { lines: [string, number, string][]; options: [string, string, string, number, string][] }> = ${record(
    Object.entries(boms),
  )};

export const SNAP_INGREDIENTS = ${list(ings)};

export const SNAP_SUPPLIERS = ${list(sups)};

export const SNAP_PRICE_INCREASES = ${list(priceIncreases)};

export const SNAP_ORDERS = ${list(orders)};

export const SNAP_REVIEWS = ${list(reviewRows)};

export const SNAP_DEVICES = ${list(deviceRows)};

/** Équipe inventée — les équipiers réels ne sortent pas de la base. */
export const SNAP_CREW = ${json(CREW)};

/**
 * Réponse complète de \`GET /billing/me\`, horodatages remplacés par des jetons
 * \`@<âge en minutes>\` que \`state.ts\` recale sur l'horloge du visiteur.
 */
export const SNAP_BILLING = ${JSON.stringify(billingOut, null, 2)};

/** Carte de chaleur jour × heure, mesurée. */
export const SNAP_HEATMAP = ${list(
    heatmap.map((c) => ({ day: c.day, hour: c.hour, orders: c.orders })),
  )};

/** Agrégats mesurés par période. */
export const SNAP_STATS = ${record(Object.entries(statsOut))};

/** Distribution d'étoiles mesurée. */
export const SNAP_REVIEW_COUNTS = ${json(reviewSummary.counts)};
`;

  const here = dirname(fileURLToPath(import.meta.url));
  writeFileSync(join(here, 'snapshot.ts'), out, 'utf8');
  console.log(
    `snapshot.ts écrit — ${products.length} produits, ${orders.length} commandes, ${ings.length} ingrédients, ${(Buffer.byteLength(out) / 1024).toFixed(0)} ko`,
  );
  if (empties.length) {
    console.log(`Vides dans la base (composés à la main dans seed.ts) : ${empties.join(', ')}`);
  }
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
