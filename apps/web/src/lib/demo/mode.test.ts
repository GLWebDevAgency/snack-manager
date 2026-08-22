/**
 * LE MODE DÉMONSTRATION NE DOIT PAS POUVOIR S'ALLUMER TOUT SEUL.
 *
 * Ce fichier épingle la promesse faite en tête de `mode.ts` : `?demo=1` et rien
 * d'autre. Il ne teste pas des cas limites d'analyse d'URL pour le plaisir —
 * chaque cas ci-dessous est un chemin par lequel un vrai gérant, en service,
 * pourrait basculer son back-office sur une fixture sans s'en apercevoir.
 *
 * Exécution (aucun lanceur n'est déclaré dans `apps/web` — voir le rapport) :
 *
 *   pnpm --filter @sm/client-core exec vitest run \
 *     --root ../../apps/web src/lib/demo/mode.test.ts
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isDemoActive,
  isDemoRequested,
  resetDemoModeForTests,
  withDemoParam,
} from "./mode";

/** Installe une URL de document, comme si le visiteur venait d'y arriver. */
function visit(href: string | null) {
  resetDemoModeForTests();
  if (href === null) {
    Reflect.deleteProperty(globalThis, "location");
    return;
  }
  Object.defineProperty(globalThis, "location", {
    value: { href },
    configurable: true,
    writable: true,
  });
}

afterEach(() => {
  resetDemoModeForTests();
  Reflect.deleteProperty(globalThis, "location");
  Reflect.deleteProperty(globalThis, "history");
});

describe("reconnaissance du paramètre", () => {
  it("reconnaît la valeur exacte", () => {
    expect(isDemoRequested("https://x.fr/admin/dashboard?demo=1")).toBe(true);
    expect(isDemoRequested("https://x.fr/admin?a=b&demo=1&c=d")).toBe(true);
  });

  it("refuse toute autre valeur", () => {
    // Un « à peu près » ne suffit pas : ces formes-là sont exactement celles
    // qu'un outil de suivi ou un copier-coller approximatif produirait.
    for (const href of [
      "https://x.fr/admin?demo=0",
      "https://x.fr/admin?demo=true",
      "https://x.fr/admin?demo=11",
      "https://x.fr/admin?demo=",
      "https://x.fr/admin?demo",
      "https://x.fr/admin?demonstration=1",
      "https://x.fr/admin?xdemo=1",
      "https://x.fr/admin",
      "",
    ]) {
      expect(isDemoRequested(href), href).toBe(false);
    }
  });

  it("ignore ce qui suit le dièse", () => {
    // `#` n'est pas envoyé au serveur et n'est pas la requête de la page :
    // un lien de navigation interne ne doit pas armer la démonstration.
    expect(isDemoRequested("https://x.fr/admin#/ecran?demo=1")).toBe(false);
  });

  it("ne se laisse pas piéger par une séquence d'échappement invalide", () => {
    expect(isDemoRequested("https://x.fr/admin?%E0%A4%A=1&demo=1")).toBe(true);
  });
});

describe("armement", () => {
  it("reste éteint sans URL (rendu serveur, application native)", () => {
    visit(null);
    expect(isDemoActive()).toBe(false);
  });

  it("reste éteint sur une URL ordinaire", () => {
    visit("https://x.fr/admin/dashboard");
    expect(isDemoActive()).toBe(false);
  });

  it("s'allume sur le paramètre exact", () => {
    visit("https://x.fr/admin/dashboard?demo=1");
    expect(isDemoActive()).toBe(true);
  });

  it("ne bascule pas en cours de route", () => {
    // La moitié des écrans sur la fixture et l'autre sur le réseau serait le
    // pire des états : la réponse est figée au premier appel.
    visit("https://x.fr/admin/dashboard");
    expect(isDemoActive()).toBe(false);
    Object.defineProperty(globalThis, "location", {
      value: { href: "https://x.fr/admin/orders?demo=1" },
      configurable: true,
      writable: true,
    });
    expect(isDemoActive()).toBe(false);
  });

  it("reste éteint hors du back-office du gérant", () => {
    // `lib/api.ts` sert aussi `/sm`, le back-office de l'ÉQUIPE Snack Manager.
    // Un `?demo=1` collé là-bas détournerait ses appels vers un routeur qui ne
    // connaît aucune de ses routes.
    for (const href of [
      "https://x.fr/sm/clients?demo=1",
      "https://x.fr/?demo=1",
      "https://x.fr/r/le-comptoir?demo=1",
      "https://x.fr/administration?demo=1",
    ]) {
      visit(href);
      expect(isDemoActive(), href).toBe(false);
    }
  });

  it("s'allume sur toute la profondeur du back-office du gérant", () => {
    for (const href of [
      "https://x.fr/admin?demo=1",
      "https://x.fr/admin/dashboard?demo=1",
      "https://x.fr/admin/ingredients?demo=1&onglet=fournisseurs",
    ]) {
      visit(href);
      expect(isDemoActive(), href).toBe(true);
    }
  });

  it("n'écrit RIEN qui survivrait au rechargement", () => {
    const store = { setItem: vi.fn(), getItem: vi.fn(), removeItem: vi.fn() };
    Object.defineProperty(globalThis, "localStorage", {
      value: store,
      configurable: true,
    });
    Object.defineProperty(globalThis, "sessionStorage", {
      value: store,
      configurable: true,
    });
    visit("https://x.fr/admin/dashboard?demo=1");
    expect(isDemoActive()).toBe(true);
    expect(store.setItem).not.toHaveBeenCalled();
    Reflect.deleteProperty(globalThis, "localStorage");
    Reflect.deleteProperty(globalThis, "sessionStorage");
  });
});

describe("survie du paramètre à la navigation interne", () => {
  it("ajoute le paramètre là où il manque, sans jamais le doubler", () => {
    expect(withDemoParam("/admin/orders")).toBe("/admin/orders?demo=1");
    expect(withDemoParam("/admin/orders?f=new")).toBe("/admin/orders?f=new&demo=1");
    expect(withDemoParam("/admin/orders?demo=1")).toBe("/admin/orders?demo=1");
    expect(withDemoParam("/admin/orders#bas")).toBe("/admin/orders?demo=1#bas");
  });

  it("recolle le paramètre sur les URL poussées par le routeur", () => {
    // C'est LE piège de cette surface : le routeur Next pousse le chemin
    // canonique, sans requête. Sans ce recollage, l'adresse perd `?demo=1` au
    // premier clic et un rechargement éjecterait le visiteur vers la connexion.
    const pushed: unknown[] = [];
    Object.defineProperty(globalThis, "history", {
      value: {
        pushState: (_d: unknown, _u: string, url?: string) => pushed.push(url),
        replaceState: () => {},
      },
      configurable: true,
      writable: true,
    });
    visit("https://x.fr/admin/dashboard?demo=1");
    expect(isDemoActive()).toBe(true);

    (globalThis as unknown as { history: History }).history.pushState({}, "", "/admin/orders");
    expect(pushed).toEqual(["/admin/orders?demo=1"]);
  });

  it("laisse passer une poussée d'état sans URL", () => {
    // Le routeur pousse parfois un état sans changer l'adresse ; y forcer une
    // URL casserait ce cas parfaitement normal.
    const pushed: unknown[] = [];
    Object.defineProperty(globalThis, "history", {
      value: {
        pushState: (_d: unknown, _u: string, url?: string | null) => pushed.push(url),
        replaceState: () => {},
      },
      configurable: true,
      writable: true,
    });
    visit("https://x.fr/admin/dashboard?demo=1");
    expect(isDemoActive()).toBe(true);

    (globalThis as unknown as { history: History }).history.pushState({}, "");
    expect(pushed).toEqual([undefined]);
  });
});
