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
import {
  LoyaltyConsentMutationResultSchema,
  LoyaltyDashboardSchema,
  LoyaltyEarnResultSchema,
  LoyaltyEnrollmentAcknowledgementResultSchema,
  LoyaltyEnrollmentPrepareResultSchema,
  LoyaltyEnrollmentRecoveryResultSchema,
  LoyaltyMemberCreateResultSchema,
  LoyaltyMemberDetailSchema,
  LoyaltyMemberLifecycleResultSchema,
  LoyaltyMemberListSchema,
  LoyaltyMemberQrReplaceResultSchema,
  LoyaltyMemberSummarySchema,
  LoyaltyMutationResultSchema,
} from "@sm/contracts";
import { beforeEach, describe, expect, it } from "vitest";
import { demoWorld, resetDemoWorld, routeDemo } from "./router";

beforeEach(() => resetDemoWorld());

type DemoSession = { sessionRef?: string };

function prepareEnrollment(operationId: string, session: DemoSession = {}) {
  return LoyaltyEnrollmentPrepareResultSchema.parse(
    routeDemo(
      "POST",
      "/loyalty/members/enrollments/prepare",
      { operationId },
      session,
    ).body,
  );
}

function createEnrollment(body: Record<string, unknown> & { operationId: string }, session: DemoSession = {}) {
  return LoyaltyMemberCreateResultSchema.parse(
    routeDemo("POST", "/loyalty/members", body, session).body,
  );
}

function acknowledgeEnrollment(operationId: string, session: DemoSession = {}) {
  return LoyaltyEnrollmentAcknowledgementResultSchema.parse(
    routeDemo(
      "POST",
      "/loyalty/members/enrollments/acknowledge",
      { operationId },
      session,
    ).body,
  );
}

function enrollAndAcknowledge(
  body: Record<string, unknown> & { operationId: string },
  session: DemoSession = {},
) {
  prepareEnrollment(body.operationId, session);
  const created = createEnrollment(body, session);
  acknowledgeEnrollment(body.operationId, session);
  return created;
}

/** Appels de LECTURE, écran par écran. */
const READS: [string, string][] = [
  // Médiathèque
  ["GET", "/medias"],
  // Encaissement en ligne
  ["GET", "/encaissement/me"],
  ["POST", "/encaissement/me/synchroniser"],
  // Shell
  ["GET", "/auth/me"],
  ["GET", "/tenants/me"],
  ["GET", "/orders?status=new"],
  ["GET", "/orders/count?status=new"],
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
  // Fidélité autonome
  ["GET", "/loyalty/program"],
  ["GET", "/loyalty/rewards"],
  ["GET", "/loyalty/dashboard"],
  ["GET", "/loyalty/members?limit=5"],
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
      ["/loyalty/rewards", (b) => (b as unknown[]).length],
      ["/loyalty/members?limit=5", (b) => (b as { items: unknown[] }).items.length],
      ["/loyalty/dashboard", (b) => (b as { recentActivity: unknown[] }).recentActivity.length],
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

  it("compte les commandes avec les mêmes filtres sans servir leurs lignes", () => {
    const list = routeDemo("GET", "/orders?status=new").body as { total: number };
    const count = routeDemo("GET", "/orders/count?status=new");

    expect(count.body).toEqual({ total: list.total });
  });
});

describe("écritures", () => {
  it("enregistre un coût horaire, et la lecture suivante le voit", () => {
    // La route de saisie manquait au routeur : la démonstration montrait un
    // écran qui accepte puis oublie, ce qui est pire qu'un écran absent.
    const membre = demoWorld().staff.find((m) => m.active)!;
    const res = routeDemo("PUT", `/planning/staff-costs/${membre._id}`, {
      hourlyCostCents: 1_777,
    });
    expect(res.status).toBe(200);
    const apres = routeDemo("GET", "/planning/staff-costs");
    const lu = (apres.body as { members: { id: string; hourlyCostCents: number | null }[] })
      .members.find((m) => m.id === membre._id);
    expect(lu?.hourlyCostCents).toBe(1_777);
  });

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

describe("fidélité autonome", () => {
  it("rend des vues conformes aux contrats et des indicateurs calculés sur le registre", () => {
    const world = demoWorld();
    const dashboard = LoyaltyDashboardSchema.parse(
      routeDemo("GET", "/loyalty/dashboard").body,
    );
    const visible = world.loyalty.members.filter((member) => member.status !== "anonymized");

    expect(dashboard.totalMembers).toBe(visible.length);
    expect(dashboard.outstandingUnits).toBe(
      visible.reduce((sum, member) => sum + member.balanceUnits, 0),
    );
    expect(dashboard.recentActivity.length).toBeGreaterThan(0);
    expect(dashboard.recentActivity[0]!.entry.recordedAt).toBe(
      world.loyalty.members
        .flatMap((member) => member.ledger)
        .sort((left, right) => Date.parse(right.recordedAt) - Date.parse(left.recordedAt))[0]!
        .recordedAt,
    );

    const list = LoyaltyMemberListSchema.parse(
      routeDemo("GET", "/loyalty/members?limit=5").body,
    );
    expect(list.items).toHaveLength(5);
    list.items.forEach((member) => LoyaltyMemberSummarySchema.parse(member));
  });

  it("pagine sans donnée personnelle dans le curseur et refuse le téléphone dans l'URL", () => {
    const first = LoyaltyMemberListSchema.parse(
      routeDemo("GET", "/loyalty/members?limit=3").body,
    );
    expect(first.nextCursor).not.toBeNull();
    for (const member of demoWorld().loyalty.members) {
      if (member.phone) expect(first.nextCursor).not.toContain(member.phone);
    }

    const second = LoyaltyMemberListSchema.parse(
      routeDemo(
        "GET",
        `/loyalty/members?limit=3&cursor=${encodeURIComponent(first.nextCursor!)}`,
      ).body,
    );
    expect(second.items).toHaveLength(3);
    expect(second.items.map((member) => member.id)).not.toEqual(
      expect.arrayContaining(first.items.map((member) => member.id)),
    );
    expect(routeDemo("GET", "/loyalty/members?phone=0199000101").status).toBe(400);

    const memberRef = first.items[0]!.id;
    const exact = LoyaltyMemberListSchema.parse(
      routeDemo("GET", `/loyalty/members?memberRef=${memberRef}`).body,
    );
    expect(exact.items.map((member) => member.id)).toEqual([memberRef]);
  });

  it("versionne le programme uniquement lorsqu'une règle publiée change", () => {
    const before = routeDemo("GET", "/loyalty/program").body as {
      name: string;
      status: "draft" | "active" | "paused";
      earn: unknown;
      unitLabelSingular: string;
      unitLabelPlural: string;
      termsSummary: string;
      rulesVersion: number;
      updatedAt: string;
    };
    const body = {
      name: before.name,
      status: before.status,
      earn: before.earn,
      unitLabelSingular: before.unitLabelSingular,
      unitLabelPlural: before.unitLabelPlural,
      termsSummary: before.termsSummary,
    };
    const unchanged = routeDemo("PUT", "/loyalty/program", body).body as typeof before;
    expect(unchanged.rulesVersion).toBe(before.rulesVersion);
    expect(unchanged.updatedAt).toBe(before.updatedAt);

    const changed = routeDemo("PUT", "/loyalty/program", {
      ...body,
      termsSummary: `${before.termsSummary} Conditions mises à jour.`,
    }).body as typeof before;
    expect(changed.rulesVersion).toBe(before.rulesVersion + 1);
  });

  it("crée puis modifie une récompense complète", () => {
    const created = routeDemo("POST", "/loyalty/rewards", {
      name: "Boisson offerte",
      description: "Une canette au choix.",
      costUnits: 55,
      kind: "product",
      valueCents: null,
      productRef: "p101",
      active: true,
    });
    expect(created.status).toBe(200);
    const reward = created.body as { id: string; costUnits: number; active: boolean };
    expect(reward.id).toMatch(/^[0-9a-f-]{36}$/i);

    const updated = routeDemo("PATCH", `/loyalty/rewards/${reward.id}`, {
      costUnits: 60,
      active: false,
    }).body as typeof reward;
    expect(updated).toMatchObject({ costUnits: 60, active: false });
    expect(
      (routeDemo("GET", "/loyalty/rewards").body as { id: string }[]).some(
        (candidate) => candidate.id === reward.id,
      ),
    ).toBe(true);
  });

  it("lie PREPARE, CREATE, RECOVER et ACK à la session sans exposer la carte trop tôt", () => {
    const operationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
    const session = { sessionRef: "manager-a" };
    const before = demoWorld().loyalty.members.length;
    const initialList = LoyaltyMemberListSchema.parse(
      routeDemo("GET", "/loyalty/members?limit=100").body,
    );
    const createBody = {
      operationId,
      firstName: "Maya",
      phone: "01 99 00 09 99",
      termsAccepted: true,
      termsNoticeVersion: "loyalty-v1",
    };

    expect(routeDemo("POST", "/loyalty/members", createBody, session).status).toBe(409);
    const prepared = prepareEnrollment(operationId, session);
    expect(prepared).toMatchObject({ operationId, status: "prepared" });
    const pending = LoyaltyEnrollmentRecoveryResultSchema.parse(
      routeDemo(
        "POST",
        "/loyalty/members/enrollments/recover",
        { operationId },
        session,
      ).body,
    );
    expect(pending).toMatchObject({ status: "pending", operationId, retryAfterMs: 750 });
    expect(
      routeDemo(
        "POST",
        "/loyalty/members/enrollments/recover",
        { operationId },
        { sessionRef: "manager-b" },
      ).status,
    ).toBe(403);

    const first = createEnrollment(createBody, session);
    const replay = createEnrollment(
      { ...createBody, phone: "+33 (0)1 99 00 09 99" },
      session,
    );
    expect(first.replayed).toBe(false);
    expect(first.handoffExpiresAt).toBe(prepared.expiresAt);
    expect(replay).toMatchObject({ replayed: true, qrToken: first.qrToken });
    expect(replay.member.id).toBe(first.member.id);
    expect(demoWorld().loyalty.members).toHaveLength(before + 1);
    expect(
      LoyaltyMemberListSchema.parse(
        routeDemo("GET", "/loyalty/members?limit=100").body,
      ).items,
    ).toHaveLength(initialList.items.length);
    expect(
      routeDemo("GET", `/loyalty/members/${first.member.id}`).status,
    ).toBe(404);
    expect(
      routeDemo("POST", "/loyalty/members/resolve", {
        by: "phone",
        phone: "0199000999",
      }).status,
    ).toBe(404);
    expect(
      routeDemo("POST", "/loyalty/members/resolve", {
        by: "qr_token",
        qrToken: first.qrToken,
      }).status,
    ).toBe(404);
    expect(
      routeDemo("POST", `/loyalty/members/${first.member.id}/earn`, {
        operationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3",
        purchaseCents: 1_000,
        externalRef: "ticket-before-handoff",
      }).status,
    ).toBe(404);
    expect(
      routeDemo(
        "POST",
        "/loyalty/members",
        { ...createBody, firstName: "Autre prénom" },
        session,
      ).status,
    ).toBe(409);

    const recovered = LoyaltyEnrollmentRecoveryResultSchema.parse(
      routeDemo(
        "POST",
        "/loyalty/members/enrollments/recover",
        { operationId },
        session,
      ).body,
    );
    expect(recovered).toMatchObject({
      status: "ready",
      enrollment: { operationId, replayed: true, qrToken: first.qrToken },
    });
    const serializedOperation = JSON.stringify(demoWorld().loyalty.operations[operationId]);
    expect(serializedOperation).not.toContain("Maya");
    expect(serializedOperation).not.toContain("+33199000999");
    expect(serializedOperation).not.toContain(first.qrToken);
    expect(serializedOperation).not.toContain("manager-a");
    expect(demoWorld().loyalty.operations[operationId]?.result).toBeNull();
    expect(
      routeDemo(
        "POST",
        "/loyalty/members/enrollments/acknowledge",
        { operationId },
        { sessionRef: "manager-b" },
      ).status,
    ).toBe(403);

    expect(acknowledgeEnrollment(operationId, session)).toEqual({
      operationId,
      acknowledged: true,
      replayed: false,
    });
    expect(acknowledgeEnrollment(operationId, session).replayed).toBe(true);

    const resolved = LoyaltyMemberSummarySchema.parse(
      routeDemo("POST", "/loyalty/members/resolve", {
        by: "phone",
        phone: "0199000999",
      }).body,
    );
    expect(resolved.id).toBe(first.member.id);
    expect(
      LoyaltyMemberListSchema.parse(
        routeDemo("GET", "/loyalty/members?limit=100").body,
      ).items.some((member) => member.id === first.member.id),
    ).toBe(true);
    expect(
      routeDemo("POST", "/loyalty/members", createBody, session).status,
    ).toBe(410);
    expect(
      routeDemo(
        "POST",
        "/loyalty/members/enrollments/recover",
        { operationId },
        session,
      ).status,
    ).toBe(410);
  });

  it("crée une carte QR-only et la retrouve sans exposer le secret dans une URL", () => {
    const created = enrollAndAcknowledge({
        operationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
        firstName: "Noa",
        phone: null,
        termsAccepted: true,
        termsNoticeVersion: "loyalty-v1",
      });
    expect(created.qrToken).toHaveLength(43);
    expect(created.member.maskedPhone).toBeNull();
    const resolved = LoyaltyMemberSummarySchema.parse(
      routeDemo("POST", "/loyalty/members/resolve", {
        by: "qr_token",
        qrToken: created.qrToken,
      }).body,
    );
    expect(resolved.id).toBe(created.member.id);
  });

  it("crédite selon la règle active et rejoue l'opération une seule fois", () => {
    const member = demoWorld().loyalty.members.find(
      (candidate) => candidate.status === "active" && candidate.phone,
    )!;
    const before = member.balanceUnits;
    const operationId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
    const first = LoyaltyEarnResultSchema.parse(
      routeDemo("POST", `/loyalty/members/${member.id}/earn`, {
        operationId,
        purchaseCents: 1_299,
        externalRef: "ticket-demo-1",
      }).body,
    );
    expect(first).toMatchObject({
      replayed: false,
      outcome: "earned",
      awardedUnits: 12,
      entry: { deltaUnits: 12 },
    });
    expect(member.balanceUnits).toBe(before + 12);

    const replay = LoyaltyEarnResultSchema.parse(
      routeDemo("POST", `/loyalty/members/${member.id}/earn`, {
        externalRef: "ticket-demo-1",
        purchaseCents: 1_299,
        operationId,
      }).body,
    );
    expect(replay.replayed).toBe(true);
    expect(member.balanceUnits).toBe(before + 12);
    expect(
      routeDemo("POST", `/loyalty/members/${member.id}/earn`, {
        operationId,
        purchaseCents: 2_000,
        externalRef: "ticket-demo-1",
      }).status,
    ).toBe(409);
  });

  it("réserve un ticket même lorsque le panier est sous le minimum", () => {
    const member = demoWorld().loyalty.members.find(
      (candidate) => candidate.status === "active",
    )!;
    const before = member.balanceUnits;
    const first = LoyaltyEarnResultSchema.parse(
      routeDemo("POST", `/loyalty/members/${member.id}/earn`, {
        operationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2",
        purchaseCents: 200,
        externalRef: "ticket-demo-sous-minimum",
      }).body,
    );
    expect(first).toMatchObject({
      outcome: "below_minimum",
      awardedUnits: 0,
      entry: null,
    });
    expect(member.balanceUnits).toBe(before);
    expect(
      routeDemo("POST", `/loyalty/members/${member.id}/earn`, {
        operationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3",
        purchaseCents: 1_000,
        externalRef: "ticket-demo-sous-minimum",
      }).status,
    ).toBe(409);
    expect(member.balanceUnits).toBe(before);
  });

  it("suspend toute consommation hors ticket sans toucher au solde", () => {
    const reward = demoWorld().loyalty.rewards.find(
      (candidate) => candidate.active && candidate.costUnits === 40,
    )!;
    const member = demoWorld().loyalty.members.find(
      (candidate) => candidate.status === "active" && candidate.balanceUnits >= reward.costUnits,
    )!;
    const before = member.balanceUnits;
    expect(
      routeDemo("POST", `/loyalty/members/${member.id}/redemptions`, {
        operationId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc1",
        rewardId: reward.id,
        expectedCostUnits: reward.costUnits,
        externalRef: "pos-redemption:cccccccc-cccc-4ccc-8ccc-ccccccccccc1",
      }).status,
    ).toBe(410);
    expect(member.balanceUnits).toBe(before);
  });

  it("corrige le solde avec motif sans altérer les compteurs organiques", () => {
    const member = demoWorld().loyalty.members.find((candidate) => candidate.status === "active")!;
    const before = {
      balance: member.balanceUnits,
      earned: member.lifetimeEarnedUnits,
      redeemed: member.lifetimeRedeemedUnits,
    };
    const operationId = "dddddddd-dddd-4ddd-8ddd-ddddddddddd1";
    const first = LoyaltyMutationResultSchema.parse(
      routeDemo("POST", `/loyalty/members/${member.id}/adjustments`, {
        operationId,
        units: 7,
        reason: "Régularisation validée avec le client",
      }).body,
    );
    expect(first.entry?.kind).toBe("adjust_credit");
    expect(member).toMatchObject({
      balanceUnits: before.balance + 7,
      lifetimeEarnedUnits: before.earned,
      lifetimeRedeemedUnits: before.redeemed,
    });
    const replay = LoyaltyMutationResultSchema.parse(
      routeDemo("POST", `/loyalty/members/${member.id}/adjustments`, {
        operationId,
        units: 7,
        reason: "Régularisation validée avec le client",
      }).body,
    );
    expect(replay.replayed).toBe(true);
    expect(member.balanceUnits).toBe(before.balance + 7);

    expect(
      routeDemo("POST", `/loyalty/members/${member.id}/adjustments`, {
        operationId: "dddddddd-dddd-4ddd-8ddd-ddddddddddd2",
        units: -(member.balanceUnits + 1),
        reason: "Correction impossible",
      }).status,
    ).toBe(400);
  });

  it("sépare l'adhésion du consentement marketing et mémorise les retraits", () => {
    const noPhone = demoWorld().loyalty.members.find(
      (candidate) => candidate.status === "active" && candidate.phone === null,
    )!;
    expect(
      routeDemo("POST", `/loyalty/members/${noPhone.id}/consents`, {
        operationId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1",
        purpose: "marketing_sms",
        decision: "granted",
        noticeVersion: "marketing-v1",
      }).status,
    ).toBe(409);

    const withPhone = demoWorld().loyalty.members.find(
      (candidate) =>
        candidate.status === "active" &&
        candidate.phone &&
        candidate.consents.some((consent) => consent.decision === "granted"),
    )!;
    expect(
      routeDemo("POST", `/loyalty/members/${withPhone.id}/consents`, {
        operationId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2",
        purpose: "marketing_sms",
        decision: "granted",
        noticeVersion: "marketing-v1",
      }).status,
    ).toBe(409);
    const operationId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee3";
    const withdrawn = LoyaltyConsentMutationResultSchema.parse(
      routeDemo("POST", `/loyalty/members/${withPhone.id}/consents`, {
        operationId,
        purpose: "marketing_sms",
        decision: "withdrawn",
        noticeVersion: "marketing-v2",
      }).body,
    );
    expect(withdrawn.consent).toMatchObject({
      purpose: "marketing_sms",
      decision: "withdrawn",
      noticeVersion: "marketing-v2",
    });
    const replay = LoyaltyConsentMutationResultSchema.parse(
      routeDemo("POST", `/loyalty/members/${withPhone.id}/consents`, {
        operationId,
        purpose: "marketing_sms",
        decision: "withdrawn",
        noticeVersion: "marketing-v2",
      }).body,
    );
    expect(replay.replayed).toBe(true);
  });

  it("gère blocage, remplacement du QR et anonymisation terminale", () => {
    const member = demoWorld().loyalty.members.find(
      (candidate) => candidate.status === "active" && candidate.phone && candidate.qrTokens[0],
    )!;
    const oldPhone = member.phone!;
    const oldQr = member.qrTokens[0]!;
    const blockOperation = "abababab-abab-4bab-8bab-abababababa1";
    const blocked = LoyaltyMemberLifecycleResultSchema.parse(
      routeDemo("POST", `/loyalty/members/${member.id}/lifecycle`, {
        operationId: blockOperation,
        action: "block",
        reasonCode: "suspected_sharing",
      }).body,
    );
    expect(blocked).toMatchObject({ status: "blocked", replayed: false });
    expect(
      routeDemo("POST", `/loyalty/members/${member.id}/earn`, {
        operationId: "abababab-abab-4bab-8bab-abababababa2",
        purchaseCents: 1_000,
        externalRef: "ticket-carte-bloquee",
      }).status,
    ).toBe(409);
    expect(
      LoyaltyMemberLifecycleResultSchema.parse(
        routeDemo("POST", `/loyalty/members/${member.id}/lifecycle`, {
          operationId: blockOperation,
          action: "block",
          reasonCode: "suspected_sharing",
        }).body,
      ).replayed,
    ).toBe(true);

    LoyaltyMemberLifecycleResultSchema.parse(
      routeDemo("POST", `/loyalty/members/${member.id}/lifecycle`, {
        operationId: "abababab-abab-4bab-8bab-abababababa3",
        action: "unblock",
        reasonCode: "identity_verified",
      }).body,
    );
    const replaceOperation = "abababab-abab-4bab-8bab-abababababa4";
    const expectedGeneration = member.qrGeneration;
    const replacement = LoyaltyMemberQrReplaceResultSchema.parse(
      routeDemo("POST", `/loyalty/members/${member.id}/qr/replace`, {
        operationId: replaceOperation,
        reasonCode: "lost_or_compromised",
        expectedGeneration,
      }).body,
    );
    expect(replacement).toMatchObject({
      replayed: false,
      revokedTokens: 1,
      previousGeneration: expectedGeneration,
      qrGeneration: expectedGeneration + 1,
    });
    expect(replacement.qrToken).not.toBe(oldQr);
    expect(
      routeDemo("POST", "/loyalty/members/resolve", {
        by: "qr_token",
        qrToken: oldQr,
      }).status,
    ).toBe(404);
    expect(
      LoyaltyMemberQrReplaceResultSchema.parse(
        routeDemo("POST", `/loyalty/members/${member.id}/qr/replace`, {
          operationId: replaceOperation,
          reasonCode: "lost_or_compromised",
          expectedGeneration,
        }).body,
      ),
    ).toMatchObject({ replayed: true, qrToken: replacement.qrToken });

    const grantedBefore = member.consents.filter(
      (consent) => consent.decision === "granted",
    ).length;
    const anonymizeOperation = "abababab-abab-4bab-8bab-abababababa5";
    const anonymized = LoyaltyMemberLifecycleResultSchema.parse(
      routeDemo("POST", `/loyalty/members/${member.id}/lifecycle`, {
        operationId: anonymizeOperation,
        action: "anonymize",
        reasonCode: "customer_request",
        confirmation: "ANONYMISER",
      }).body,
    );
    expect(anonymized).toMatchObject({
      replayed: false,
      status: "anonymized",
      revokedTokens: 1,
      withdrawnConsents: grantedBefore,
    });
    expect(member).toMatchObject({
      firstName: null,
      phone: null,
      qrTokens: [],
      status: "anonymized",
    });
    expect(member.consents.every((consent) => consent.decision === "withdrawn")).toBe(true);
    expect(
      routeDemo("POST", "/loyalty/members/resolve", {
        by: "phone",
        phone: oldPhone,
      }).status,
    ).toBe(404);
    expect(
      routeDemo("POST", "/loyalty/members/resolve", {
        by: "qr_token",
        qrToken: replacement.qrToken,
      }).status,
    ).toBe(404);
    expect(
      LoyaltyMemberLifecycleResultSchema.parse(
        routeDemo("POST", `/loyalty/members/${member.id}/lifecycle`, {
          operationId: anonymizeOperation,
          action: "anonymize",
          reasonCode: "customer_request",
          confirmation: "ANONYMISER",
        }).body,
      ).replayed,
    ).toBe(true);
    expect(
      routeDemo("POST", `/loyalty/members/${member.id}/qr/replace`, {
        operationId: replaceOperation,
        reasonCode: "lost_or_compromised",
        expectedGeneration,
      }).status,
    ).toBe(409);
  });

  it("ne ressuscite ni PII ni QR quand une création est rejouée après anonymisation", () => {
    const createOperation = "cacacaca-caca-4aca-8aca-cacacacacac1";
    const createBody = {
      operationId: createOperation,
      firstName: "Iris Secret",
      phone: "06 99 88 77 66",
      termsAccepted: true,
      termsNoticeVersion: "loyalty-v1",
    };
    const created = enrollAndAcknowledge(createBody);
    const earnBody = {
      operationId: "cacacaca-caca-4aca-8aca-cacacacacac3",
      purchaseCents: 1_200,
      externalRef: "ticket-privacy-test",
    };
    expect(
      routeDemo("POST", `/loyalty/members/${created.member.id}/earn`, earnBody).status,
    ).toBe(200);

    expect(
      routeDemo("POST", `/loyalty/members/${created.member.id}/lifecycle`, {
        operationId: "cacacaca-caca-4aca-8aca-cacacacacac2",
        action: "anonymize",
        reasonCode: "customer_request",
        confirmation: "ANONYMISER",
      }).status,
    ).toBe(200);

    const replay = routeDemo("POST", "/loyalty/members", createBody);
    expect(replay.status).toBe(410);
    const replayBody = JSON.stringify(replay.body);
    expect(replayBody).not.toContain("Iris Secret");
    expect(replayBody).not.toContain("+33699887766");
    expect(replayBody).not.toContain(created.qrToken);
    expect(replayBody).not.toContain('"status":"active"');
    const earnReplay = routeDemo(
      "POST",
      `/loyalty/members/${created.member.id}/earn`,
      earnBody,
    );
    expect(earnReplay.status).toBe(409);
    expect(JSON.stringify(earnReplay.body)).not.toContain("Iris Secret");
    expect(JSON.stringify(earnReplay.body)).not.toContain('"status":"active"');
    const storedOperations = JSON.stringify(demoWorld().loyalty.operations);
    expect(storedOperations).not.toContain("Iris Secret");
    expect(storedOperations).not.toContain("+33699887766");
    expect(storedOperations).not.toContain(created.qrToken);
    expect(
      demoWorld().loyalty.members.find((member) => member.id === created.member.id),
    ).toMatchObject({ firstName: null, phone: null, qrTokens: [], status: "anonymized" });
  });

  it("refuse une rotation obsolète et le rejeu d'une génération QR révoquée", () => {
    const member = demoWorld().loyalty.members.find(
      (candidate) => candidate.status === "active" && candidate.qrTokens[0],
    )!;
    const initialGeneration = member.qrGeneration;
    const operationA = "bcbcbcbc-bcbc-4bcb-8bcb-bcbcbcbcbcb1";
    const rotationA = LoyaltyMemberQrReplaceResultSchema.parse(
      routeDemo("POST", `/loyalty/members/${member.id}/qr/replace`, {
        operationId: operationA,
        reasonCode: "lost_or_compromised",
        expectedGeneration: initialGeneration,
      }).body,
    );

    expect(
      routeDemo("POST", `/loyalty/members/${member.id}/qr/replace`, {
        operationId: "bcbcbcbc-bcbc-4bcb-8bcb-bcbcbcbcbcb2",
        reasonCode: "manager_correction",
        expectedGeneration: initialGeneration,
      }).status,
    ).toBe(409);

    const rotationB = LoyaltyMemberQrReplaceResultSchema.parse(
      routeDemo("POST", `/loyalty/members/${member.id}/qr/replace`, {
        operationId: "bcbcbcbc-bcbc-4bcb-8bcb-bcbcbcbcbcb3",
        reasonCode: "customer_request",
        expectedGeneration: rotationA.qrGeneration,
      }).body,
    );
    expect(rotationB.qrGeneration).toBe(rotationA.qrGeneration + 1);
    const revokedReplay = routeDemo("POST", `/loyalty/members/${member.id}/qr/replace`, {
        operationId: operationA,
        reasonCode: "lost_or_compromised",
        expectedGeneration: initialGeneration,
      });
    expect(revokedReplay.status).toBe(409);
    expect(JSON.stringify(revokedReplay.body)).not.toContain(rotationA.qrToken);
    expect(
      routeDemo("POST", "/loyalty/members/resolve", {
        by: "qr_token",
        qrToken: rotationA.qrToken,
      }).status,
    ).toBe(404);
    expect(
      routeDemo("POST", "/loyalty/members/resolve", {
        by: "qr_token",
        qrToken: rotationB.qrToken,
      }).status,
    ).toBe(200);
  });

  it("rend le détail et remet toute la fidélité à zéro au rechargement", () => {
    const member = demoWorld().loyalty.members.find((candidate) => candidate.ledger.length > 0)!;
    const detail = LoyaltyMemberDetailSchema.parse(
      routeDemo("GET", `/loyalty/members/${member.id}`).body,
    );
    expect(detail.member.balanceUnits).toBe(member.balanceUnits);
    expect(detail.ledger).toHaveLength(member.ledger.length);

    const initialCount = demoWorld().loyalty.members.length;
    enrollAndAcknowledge({
      operationId: "ffffffff-ffff-4fff-8fff-fffffffffff1",
      firstName: "Temporaire",
      phone: null,
      termsAccepted: true,
      termsNoticeVersion: "loyalty-v1",
    });
    expect(demoWorld().loyalty.members).toHaveLength(initialCount + 1);
    resetDemoWorld();
    expect(demoWorld().loyalty.members).toHaveLength(initialCount);
    expect(Object.keys(demoWorld().loyalty.operations)).toHaveLength(0);
    expect(Object.keys(demoWorld().loyalty.earnReceipts)).toHaveLength(0);
    expect(Object.keys(demoWorld().loyalty.redeemReceipts)).toHaveLength(0);
  });
});

describe("routes inconnues", () => {
  it("rendent un 404 qui dit quoi faire", () => {
    const res = routeDemo("GET", "/route/qui/nexiste/pas");
    expect(res.status).toBe(404);
    expect(String((res.body as { message: string }).message)).toContain("router.ts");
  });
});
