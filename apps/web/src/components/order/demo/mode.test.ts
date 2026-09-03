import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CreatePublicOrderSchema } from "@sm/contracts";
import { DEMO_SLUG, isDemoRequested } from "./mode";
import { demoTransport } from "./transport";
import { orderingApi, type CreateOrderPayload } from "../api";

/**
 * LE TEST QUI COMPTE.
 *
 * Cette page est la vitrine de vrais restaurants, souvent servie sur LEUR
 * domaine (`maboite.fr`, réécrit vers `/r/<slug>` par `src/proxy.ts`). Si une
 * carte fictive pouvait y apparaître, un lien comme `maboite.fr/?demo=1`
 * suffirait à montrer aux clients d'un restaurateur des plats qu'il ne fait
 * pas, à des prix qui ne sont pas les siens, sur son adresse à lui. C'est la
 * panne la plus grave que ce chantier puisse produire.
 *
 * D'où la règle, épinglée ici sous toutes ses coutures : la démonstration
 * s'active sur `?demo=1` ET sur le slug réservé `demo`, et sur rien d'autre.
 */

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

/** Quelques slugs de vrais clients, dont ceux qui ressemblent à la démo. */
const REAL_SLUGS = [
  "classfood",
  "le-comptoir",
  "chez-mounir",
  "demo-food",
  "la-demo",
  "demos",
  "DEMO",
  "Demo",
  "démo",
];

describe("bascule du mode démonstration", () => {
  it("s'active sur le slug réservé ET ?demo=1", () => {
    expect(isDemoRequested("demo", { demo: "1" })).toBe(true);
    expect(isDemoRequested("demo", new URLSearchParams("demo=1"))).toBe(true);
    expect(isDemoRequested("demo", "?ref=vitrine&demo=1")).toBe(true);
    expect(isDemoRequested("demo", "https://snackmanager.fr/r/demo?demo=1")).toBe(true);
  });

  it("N'ACTIVE JAMAIS la carte fictive sur le slug d'un vrai restaurant", () => {
    // Le cœur de l'affaire : aucune combinaison de paramètres, sur aucun slug
    // de client, ne doit ouvrir la démonstration. Le paramètre seul ne suffit
    // pas, et il ne suffira jamais.
    for (const slug of REAL_SLUGS) {
      for (const params of [
        { demo: "1" },
        { demo: "1", ref: "vitrine" },
        { demo: "true" },
        { demo: ["1"] },
        { DEMO: "1" },
      ]) {
        expect(isDemoRequested(slug, params), `${slug} + ${JSON.stringify(params)}`).toBe(
          false,
        );
      }
      expect(isDemoRequested(slug, "?demo=1"), slug).toBe(false);
      expect(isDemoRequested(slug, "https://maboite.fr/?demo=1"), slug).toBe(false);
    }
  });

  it("reste inactif sur le slug réservé sans le paramètre exact", () => {
    // Chacune de ces adresses a existé dans la vraie vie d'un projet : un « 0 »
    // laissé après un test, un « true » écrit d'instinct, un paramètre vide
    // produit par un formulaire. Aucune n'ouvre un restaurant fictif.
    for (const params of [
      {},
      { demo: "" },
      { demo: "0" },
      { demo: "true" },
      { demo: "oui" },
      { demo: "2" },
      { demo: "11" },
      { demo: "1x" },
      { demo: " 1" },
      { nodemo: "1" },
      { demo_mode: "1" },
      { mode: "demo" },
    ]) {
      expect(isDemoRequested(DEMO_SLUG, params), JSON.stringify(params)).toBe(false);
    }
    for (const href of [
      "https://x/r/demo",
      "https://x/r/demo?demo",
      "https://x/r/demo?demo=",
      "https://x/r/demo?demo=0",
      "https://x/r/demo?nodemo=1",
      "https://x/r/demo?url=https%3A%2F%2Fy%2F%3Fdemo%3D1",
    ]) {
      expect(isDemoRequested(DEMO_SLUG, href), href).toBe(false);
    }
  });

  it("refuse un paramètre répété — on ne devine pas laquelle des valeurs comptait", () => {
    expect(isDemoRequested(DEMO_SLUG, { demo: ["1", "0"] })).toBe(false);
    expect(isDemoRequested(DEMO_SLUG, "?demo=1&demo=0")).toBe(false);
    expect(isDemoRequested(DEMO_SLUG, new URLSearchParams("demo=1&demo=1"))).toBe(false);
  });

  it("ignore ce qui est écrit après le dièse — un fragment n'est pas une requête", () => {
    expect(isDemoRequested(DEMO_SLUG, "https://x/r/demo#/carte?demo=1")).toBe(false);
    expect(isDemoRequested(DEMO_SLUG, "https://x/r/demo?demo=1#/carte")).toBe(true);
  });

  it("ne s'active par AUCUNE variable d'environnement", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("SM_DEMO", "1");
    vi.stubEnv("NEXT_PUBLIC_DEMO", "1");
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    expect(isDemoRequested(DEMO_SLUG, {})).toBe(false);
    expect(isDemoRequested("classfood", {})).toBe(false);
  });
});

describe("la page d'un vrai restaurant ne peut pas servir la fixture", () => {
  const src = (...parts: string[]) =>
    readFileSync(join(__dirname, "..", "..", "..", ...parts), "utf8");

  it("la route /r/[slug] n'importe rien de la démonstration", () => {
    // Preuve structurelle, et c'est la plus solide : la démonstration n'est pas
    // écartée par une condition qu'un remaniement pourrait retourner, elle est
    // ABSENTE du graphe de modules de la page des clients.
    const page = src("app", "r", "[slug]", "page.tsx");
    expect(page).not.toMatch(/demo/i);
  });

  it("la vitrine et le tunnel non plus — la fixture leur est passée, jamais importée", () => {
    for (const file of ["Storefront.tsx", "Checkout.tsx", "api.ts", "cart.ts"]) {
      const source = src("components", "order", file);
      expect(source, file).not.toMatch(/from\s+["']\.\/demo\//);
      expect(source, file).not.toMatch(/from\s+["']\.\.\/demo\//);
    }
  });
});

describe("le client par défaut parle au réseau, pas à une fixture", () => {
  it("n'utilise le transport de démonstration que si on le lui donne", async () => {
    const fetchMock = vi.fn(
      async (url: string) =>
        new Response(JSON.stringify({ url, tenant: {}, menu: { categories: [] } }), {
          status: 200,
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    // Une adresse de démonstration dans la barre du navigateur ne change RIEN
    // au client : la bascule est un choix explicite d'une route, pas une
    // contagion par l'URL.
    vi.stubGlobal("location", { href: "https://snackmanager.fr/r/demo?demo=1" });

    await orderingApi().loadSlots("classfood");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      "/public/tenants/classfood/slots",
    );
  });

  it("envoie exactement le contrat public strict, sans faits réservés au serveur", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const sent = JSON.parse(String(init?.body)) as unknown;
      expect(CreatePublicOrderSchema.safeParse(sent).success).toBe(true);
      expect(sent).not.toHaveProperty("channel");
      expect(sent).not.toHaveProperty("type");
      expect(sent).not.toHaveProperty("status");
      return new Response(
        JSON.stringify({
          _id: "commande",
          number: 42,
          status: "new",
          totals: { subtotal: 1600, discount: null, total: 1600 },
          pickup: { slot: new Date().toISOString(), customerName: "Camille" },
          trackingToken: "secret-de-suivi",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    await orderingApi().createOrder(
      "classfood",
      kebab("11111111-1111-4111-8111-111111111111"),
    );

    expect(fetchMock).toHaveBeenCalledOnce();
  });
});

describe("le paiement ne sort jamais de la démonstration", () => {
  it("l'intention de paiement répond « indisponible » sans appeler Stripe", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const api = orderingApi(demoTransport({ latency: false }));

    const created = await api.createOrder(DEMO_SLUG, kebab("test-1"));
    if ("paused" in created) throw new Error("commande refusée");

    const intent = await api.createPaymentIntent(created._id, created.trackingToken);

    expect(intent.unavailable).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

/** Un kebab correctement composé — « Pain » est un groupe obligatoire. */
const kebab = (clientId: string): CreateOrderPayload => ({
  clientId,
  lines: [
    {
      productId: "p2",
      options: [{ groupKey: "pain", choiceKey: "galette" }],
      removed: [],
      qty: 2,
    },
  ],
  payment: { method: "counter" },
  turnstileToken: "demo",
  pickup: {
    slot: new Date().toISOString(),
    customerName: "Camille",
    customerPhone: "0612345678",
  },
});

describe("la démonstration chiffre comme le serveur", () => {
  it("recalcule le total depuis la carte, sans rien recevoir du navigateur", async () => {
    const api = orderingApi(demoTransport({ latency: false }));
    const created = await api.createOrder(DEMO_SLUG, kebab("test-prix"));
    if ("paused" in created) throw new Error("commande refusée");

    // Kebab 7,50 € + galette 0,50 €, deux fois : 16,00 €. Aucun de ces
    // montants n'a été envoyé — ils sortent de la carte.
    expect(created.totals.total).toBe(1600);
  });

  it("refuse une ligne à laquelle il manque un choix obligatoire", async () => {
    const api = orderingApi(demoTransport({ latency: false }));
    await expect(
      api.createOrder(DEMO_SLUG, {
        ...kebab("test-refus"),
        lines: [{ productId: "p2", options: [], removed: [], qty: 1 }],
      }),
    ).rejects.toThrow(/Pain/);
  });

  it("rejoue une même tentative sans créer de doublon", async () => {
    const api = orderingApi(demoTransport({ latency: false }));
    const first = await api.createOrder(DEMO_SLUG, kebab("test-idem"));
    const again = await api.createOrder(DEMO_SLUG, kebab("test-idem"));
    if ("paused" in first || "paused" in again) throw new Error("commande refusée");

    expect(again._id).toBe(first._id);
    expect(again.number).toBe(first.number);
  });
});

describe("les créneaux sont relatifs à l'instant présent", () => {
  it("ne propose jamais un créneau passé, même six mois après l'écriture du code", async () => {
    const api = orderingApi(demoTransport({ latency: false }));
    const slots = await api.loadSlots(DEMO_SLUG);

    /*
     * CE TEST TOMBAIT TOUS LES SOIRS, ET LE DÉFAUT ÉTAIT DANS LE TEST.
     *
     * Il exigeait `length > 0` sans condition. Or la démonstration reproduit
     * fidèlement l'API : passé l'heure de fermeture, il n'y a plus de créneau
     * aujourd'hui, `closedToday` passe à vrai et `nextOpenDate` porte la
     * réouverture. Zéro créneau à 21 h n'est pas un défaut, c'est la bonne
     * réponse — et l'intégration continue refusait donc toute fusion en soirée,
     * pour une raison sans rapport avec ce qu'on lui demandait de vérifier.
     *
     * L'invariant que l'intitulé promet est « jamais un créneau PASSÉ ». Il est
     * vrai à toute heure et se vérifie sur la liste, vide ou non. Le reste du
     * contrat est vérifié explicitement plutôt que supposé : ou bien il y a des
     * créneaux, ou bien la journée est déclarée fermée avec sa réouverture.
     */
    for (const slot of slots.slots) {
      expect(Date.parse(slot.iso)).toBeGreaterThan(Date.now());
    }
    if (slots.slots.length === 0) {
      expect(slots.closedToday, "une journée sans créneau doit se déclarer fermée").toBe(true);
      expect(slots.nextOpenDate, "une journée fermée doit dire quand elle rouvre").not.toBeNull();
    } else {
      expect(slots.closedToday).toBe(false);
    }
  });

  it("laisse toujours le restaurant ouvert, à n'importe quelle heure du jour", async () => {
    // Une démonstration qui affiche « Fermé » ne démontre rien. On vérifie les
    // 24 heures d'une journée, dont les creux entre deux services.
    for (let hour = 0; hour < 24; hour++) {
      const at = new Date();
      at.setHours(hour, 15, 0, 0);
      const api = orderingApi(demoTransport({ latency: false, now: () => at.getTime() }));
      const site = await api.loadSite(DEMO_SLUG);
      expect(site?.openNow, `${hour}h`).toBe(true);
    }
  });
});
