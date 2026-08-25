/**
 * AUCUN ÉCRAN NE DOIT TOMBER SUR UNE ROUTE ABSENTE.
 *
 * La démonstration du back-office existe pour montrer l'ÉTENDUE de la
 * couverture : un restaurateur doit pouvoir se promener partout et constater
 * que tout y est. Un seul « Route absente de la démonstration » et le message
 * s'inverse — il retient qu'il manque quelque chose.
 *
 * La liste ci-dessous est celle des appels RÉELLEMENT émis par les quatorze
 * écrans (relevés dans `app/admin/**`). Elle est le contrat de cette
 * démonstration : si un écran gagne un appel, ce test tombe avant l'écran.
 *
 * Exécution (aucun lanceur n'est déclaré dans `apps/web` — voir le rapport) :
 *
 *   pnpm --filter @sm/client-core exec vitest run \
 *     --root ../../apps/web src/lib/demo/router.test.ts
 */
import { beforeEach, describe, expect, it } from "vitest";
import { demoWorld, resetDemoWorld, routeDemo } from "./router";

beforeEach(() => resetDemoWorld());

/** Appels de LECTURE, écran par écran. */
const READS: [string, string][] = [
  // Encaissement en ligne
  ["GET", "/encaissement/me"],
  ["POST", "/encaissement/me/synchroniser"],
  // Shell
  ["GET", "/tenants/me"],
  ["GET", "/orders?status=new"],
  // Tableau de bord
  ["GET", "/stats/overview?period=1d"],
  ["GET", "/stats/overview?period=7d"],
  ["GET", "/stats/overview?period=30d"],
  ["GET", "/stats/timeseries?period=1d"],
  ["GET", "/stats/timeseries?period=7d"],
  ["GET", "/stats/timeseries?period=30d"],
  ["GET", "/stats/prep-times?period=1d"],
  ["GET", "/stats/summary-live"],
  ["GET", "/stats/heatmap"],
  ["GET", "/stats/top-products?period=7d&limit=5"],
  ["GET", "/orders"],
  // Commandes
  ["GET", "/orders?since=2020-01-01T00:00:00.000Z"],
  // Menu & prix
  ["GET", "/menu"],
  ["GET", "/supply/costs?refs=p1,p2,p3"],
  ["GET", "/supply/ingredients"],
  ["GET", "/supply/products/p1/bom"],
  // Ingrédients & stocks
  ["GET", "/supply/alerts"],
  ["GET", "/supply/suppliers"],
  ["GET", "/supply/movements?limit=50"],
  ["GET", "/supply/items/f1it1/price-history"],
  // Promos
  ["GET", "/promotions"],
  // Écrans TV · Caisses & cuisine
  ["GET", "/screens"],
  ["GET", "/devices"],
  // Statistiques
  ["GET", "/stats/channels?period=7d"],
  // Équipe & pointage
  ["GET", "/staff"],
  ["GET", "/staff/shifts?from=2026-01-01T00:00:00.000Z&to=2026-01-08T00:00:00.000Z"],
  // Avis clients
  ["GET", "/reviews"],
  ["GET", "/reviews?filter=pending"],
  ["GET", "/reviews/summary"],
  // Votre site web
  ["GET", "/site/domains"],
  // Planning
  ["GET", "/planning/week"],
  ["GET", "/planning/week?week=2026-03-02"],
  ["GET", "/planning/week/coverage"],
  ["GET", "/planning/week/comparison"],
  ["GET", "/planning/staff-costs"],
  // Abonnement
  ["GET", "/billing/me?limit=200"],
];

describe("lectures", () => {
  it.each(READS)("%s %s répond 200", (method, path) => {
    const res = routeDemo(method, path);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).not.toBeNull();
  });

  it("ne rend jamais une liste vide sur les écrans de liste", () => {
    // Un tableau vide est le seul « bug » que cette démonstration ne peut pas
    // se permettre : l'écran s'affiche, ne dit rien, et le visiteur conclut
    // que la fonction n'existe pas.
    const nonEmpty: [string, (b: unknown) => number][] = [
      ["/menu", (b) => (b as { categories: unknown[] }).categories.length],
      ["/supply/ingredients", (b) => (b as unknown[]).length],
      ["/supply/suppliers", (b) => (b as unknown[]).length],
      ["/supply/movements?limit=50", (b) => (b as unknown[]).length],
      ["/promotions", (b) => (b as unknown[]).length],
      ["/screens", (b) => (b as unknown[]).length],
      ["/devices", (b) => (b as unknown[]).length],
      ["/staff", (b) => (b as unknown[]).length],
      ["/reviews", (b) => (b as unknown[]).length],
      ["/orders", (b) => (b as { rows: unknown[] }).rows.length],
      ["/site/domains", (b) => (b as { domains: unknown[] }).domains.length],
      ["/billing/me?limit=200", (b) => (b as { invoices: unknown[] }).invoices.length],
      ["/stats/top-products?period=7d&limit=5", (b) => (b as unknown[]).length],
    ];
    for (const [path, count] of nonEmpty) {
      const res = routeDemo("GET", path);
      expect(count(res.body), path).toBeGreaterThan(0);
    }
  });

  it("rend des commandes du jour, à n'importe quelle heure de la visite", () => {
    // L'écran Commandes demande `?since=<minuit local>`. Une fixture calée sur
    // des anciennetés fixes vidait la liste pour un visiteur du milieu de la
    // nuit ; les anciennetés sont donc comprimées dans la journée en cours.
    const midnight = new Date();
    midnight.setHours(0, 0, 0, 0);
    const res = routeDemo("GET", `/orders?since=${midnight.toISOString()}`);
    expect((res.body as { rows: unknown[] }).rows.length).toBeGreaterThan(0);
  });
});

describe("écritures", () => {
  it("accepte une commande et le statut change", () => {
    const id = demoWorld().orders.find((o) => o.status === "new")!._id;
    const res = routeDemo("PATCH", `/orders/${id}/status`, { status: "preparing" });
    expect(res.status).toBe(200);
    expect(demoWorld().orders.find((o) => o._id === id)?.status).toBe("preparing");
  });

  it("change un prix et la marge du produit suit", () => {
    const before = routeDemo("GET", "/supply/costs?refs=p1").body as Record<
      string,
      { marginPct: number | null }
    >;
    routeDemo("PATCH", "/products/p1", { price: 2000 });
    const after = routeDemo("GET", "/supply/costs?refs=p1").body as Record<
      string,
      { marginPct: number | null }
    >;
    expect(after.p1!.marginPct).toBeGreaterThan(before.p1!.marginPct!);
  });

  it("déclare une rupture d'ingrédient et coupe les produits qui en dépendent", () => {
    // C'est la démonstration la plus parlante de tout l'écran Ingrédients :
    // un clic, et la carte se ferme d'elle-même.
    const world = demoWorld();
    const used = Object.values(world.boms)[0]!.lines[0]![0];
    const res = routeDemo("POST", `/supply/ingredients/${used}/out`, { isOut: true });
    expect(res.status).toBe(200);
    expect((res.body as { productsUpdated: number }).productsUpdated).toBeGreaterThan(0);
    expect((routeDemo("GET", "/supply/alerts").body as { ruptures: unknown[] }).ruptures.length)
      .toBeGreaterThan(0);
  });

  it("répond à un avis et le compteur « sans réponse » baisse", () => {
    const pending = (routeDemo("GET", "/reviews?filter=pending").body as { _id: string }[]);
    const before = pending.length;
    routeDemo("POST", `/reviews/${pending[0]!._id}/reply`, { text: "Merci !" });
    const after = (routeDemo("GET", "/reviews?filter=pending").body as unknown[]).length;
    expect(after).toBe(before - 1);
  });

  it("renomme un fournisseur sans perdre ses références", () => {
    // L'API rend le fournisseur SANS ses `items` ; les écraser par un tableau
    // absent viderait sa carte à l'écran suivant.
    const before = (routeDemo("GET", "/supply/suppliers").body as { id: string; items: unknown[] }[])[0]!;
    const res = routeDemo("PATCH", `/supply/suppliers/${before.id}`, {
      name: "Halles du Vexin (Rouen)",
    });
    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty("items");
    const after = (routeDemo("GET", "/supply/suppliers").body as { name: string; items: unknown[] }[])[0]!;
    expect(after.name).toBe("Halles du Vexin (Rouen)");
    expect(after.items.length).toBe(before.items.length);
  });

  it("enregistre un mouvement de stock et le stock suit", () => {
    const ing = demoWorld().ingredients[0]!;
    const before = ing.currentStock;
    const journal = (routeDemo("GET", "/supply/movements?limit=50").body as unknown[]).length;
    const res = routeDemo("POST", "/supply/movements", {
      ingredientId: ing.id,
      type: "purchase",
      qty: 5,
    });
    expect((res.body as { currentStock: number }).currentStock).toBeCloseTo(before + 5, 2);
    expect(routeDemo("GET", "/supply/movements?limit=50").body).toHaveLength(journal + 1);
  });

  it("bascule une promotion", () => {
    const promo = (routeDemo("GET", "/promotions").body as { _id: string; active: boolean }[])[0]!;
    const res = routeDemo("POST", `/promotions/${promo._id}/toggle`);
    expect((res.body as { active: boolean }).active).toBe(!promo.active);
  });

  it("refuse de supprimer une catégorie encore peuplée, sauf en force", () => {
    // Même règle que l'API : sans ce 409, la démonstration laisserait croire
    // qu'on peut effacer une catégorie et perdre ses produits en silence.
    const cat = demoWorld().categories[0]!;
    expect(routeDemo("DELETE", `/categories/${cat._id}`).status).toBe(409);
    expect(routeDemo("DELETE", `/categories/${cat._id}?force=true`).status).toBe(200);
  });

  it("publie la semaine de planning et les brouillons disparaissent", () => {
    const week = routeDemo("GET", "/planning/week").body as {
      week: string;
      counts: { brouillon: number; publie: number };
    };
    expect(week.counts.brouillon).toBeGreaterThan(0);
    const res = routeDemo("POST", "/planning/week/publish", { week: week.week });
    expect((res.body as { published: number }).published).toBe(week.counts.brouillon);
    const after = routeDemo("GET", "/planning/week").body as {
      counts: { brouillon: number };
    };
    expect(after.counts.brouillon).toBe(0);
  });

  it("pose un service, le déplace, puis le retire", () => {
    const week = routeDemo("GET", "/planning/week").body as { week: string };
    const staffId = demoWorld().staff[0]!._id;
    const created = routeDemo("POST", "/planning/shifts", {
      staffId,
      date: week.week,
      start: "11:00",
      end: "15:00",
      position: "caisse",
      note: "Renfort",
    }).body as { id: string; hours: number; service: string };
    expect(created.hours).toBe(4);
    expect(created.service).toBe("midi");

    const moved = routeDemo("PATCH", `/planning/shifts/${created.id}`, {
      start: "18:00",
      end: "23:00",
    }).body as { hours: number; service: string };
    // Le service se REDÉDUIT de l'heure de début : déplacer un service du midi
    // au soir doit le faire changer de colonne, pas rester midi avec des
    // horaires du soir.
    expect(moved.service).toBe("soir");
    expect(moved.hours).toBe(5);

    expect(routeDemo("DELETE", `/planning/shifts/${created.id}`).status).toBe(200);
    expect(routeDemo("DELETE", `/planning/shifts/${created.id}`).status).toBe(404);
  });

  it("duplique une semaine vers la suivante, en brouillon", () => {
    const week = routeDemo("GET", "/planning/week").body as { week: string };
    const next = new Date(`${week.week}T12:00:00`);
    next.setDate(next.getDate() + 7);
    const to = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-${String(next.getDate()).padStart(2, "0")}`;
    const res = routeDemo("POST", "/planning/week/duplicate", {
      from: week.week,
      to,
      replace: true,
    });
    expect((res.body as { copied: number }).copied).toBeGreaterThan(0);
    const copied = routeDemo("GET", `/planning/week?week=${to}`).body as {
      counts: { brouillon: number; publie: number };
    };
    // Une semaine copiée n'engage personne tant qu'elle n'est pas publiée.
    expect(copied.counts.publie).toBe(0);
    expect(copied.counts.brouillon).toBeGreaterThan(0);
  });

  it("signale le créneau sous-doté plutôt que de tout valider", () => {
    // Une couverture qui répond « équilibré » partout ne sert à rien : la
    // fixture laisse volontairement un vendredi soir à découvert.
    const coverage = routeDemo("GET", "/planning/week/coverage").body as {
      blocks: { verdict: string }[];
    };
    expect(coverage.blocks.some((b) => b.verdict === "sous-effectif")).toBe(true);
    expect(coverage.blocks.some((b) => b.verdict === "equilibre")).toBe(true);
  });

  it("rien ne fuit d'un chargement à l'autre", () => {
    // Un rechargement remet la démonstration à zéro : c'est ce qui garantit
    // qu'elle ne dérive pas au fil des visiteurs d'un même poste.
    const id = demoWorld().orders.find((o) => o.status === "new")!._id;
    routeDemo("PATCH", `/orders/${id}/status`, { status: "delivered" });
    resetDemoWorld();
    expect(demoWorld().orders.find((o) => o._id === id)?.status).not.toBe("delivered");
  });
});

describe("routes inconnues", () => {
  it("rendent un 404 qui dit quoi faire", () => {
    const res = routeDemo("GET", "/route/qui/nexiste/pas");
    expect(res.status).toBe(404);
    expect(String((res.body as { message: string }).message)).toContain("router.ts");
  });
});
