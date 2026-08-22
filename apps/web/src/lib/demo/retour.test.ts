/**
 * LE BANDEAU DE RETOUR N'EXISTE QU'EN DÉMONSTRATION, ET SA DESTINATION NE
 * VIENT JAMAIS DE L'URL.
 *
 * Deux surfaces web sont couvertes ici, et chacune a son propre danger :
 *
 *   · LE BACK-OFFICE pilote un vrai restaurant. Un lien vers notre site
 *     commercial posé au-dessus de l'écran de travail d'un gérant est une
 *     porte de sortie qu'il n'a pas demandée, à portée de clic pendant qu'il
 *     encaisse ou change un prix.
 *
 *   · LA COMMANDE EN LIGNE est servie sur le DOMAINE DU RESTAURATEUR
 *     (`maboite.fr`, réécrit vers `/r/<slug>` par `src/proxy.ts`). Un bandeau
 *     « Découvrir Snack Manager » qui apparaîtrait là afficherait, aux clients
 *     d'un commerçant, une publicité pour son prestataire sur son propre site.
 *
 * Et sur les deux, un `?retour=…` accepté ferait une redirection ouverte : un
 * lien portant NOTRE domaine, notre certificat et notre réputation, qui dépose
 * la victime chez un pirate.
 *
 * Exécution (aucun lanceur n'est déclaré dans `apps/web` — même convention que
 * `lib/demo/mode.test.ts` et `components/order/demo/mode.test.ts`) :
 *
 *   pnpm --filter @sm/client-core exec vitest run \
 *     --root ../../apps/web src/lib/demo/retour.test.ts
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { isDemoStorefront } from "../../components/order/demo/mode";
import { isDemoActive, resetDemoModeForTests } from "./mode";
import {
  LIBELLE_DECOUVERTE,
  LIBELLE_RETOUR,
  SITE_PAR_DEFAUT,
  contexteNavigateur,
  destinationSure,
  resetContexteForTests,
  retourDemo,
  vientDuSite,
} from "./retour";

/** Installe une URL de document, comme si le visiteur venait d'y arriver. */
function visite(href: string) {
  resetDemoModeForTests();
  resetContexteForTests();
  const origine = /^https?:\/\/[^/?#]+/i.exec(href)?.[0] ?? "";
  Object.defineProperty(globalThis, "location", {
    value: { href, origin: origine },
    configurable: true,
    writable: true,
  });
}

/** Le contexte réel du navigateur, comme le composant le lit. */
function bandeauPour(actif: boolean) {
  return retourDemo({ demo: actif, ...contexteNavigateur() });
}

afterEach(() => {
  resetDemoModeForTests();
  resetContexteForTests();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  Reflect.deleteProperty(globalThis, "location");
  Reflect.deleteProperty(globalThis, "document");
  Reflect.deleteProperty(globalThis, "window");
});

describe("back-office : aucun bandeau hors démonstration", () => {
  it("reste absent sur le back-office d’un vrai gérant", () => {
    for (const href of [
      "https://snackmanager.fr/admin/dashboard",
      "https://snackmanager.fr/admin/menu",
      "https://snackmanager.fr/admin/orders?statut=new",
      "https://snackmanager.fr/admin/dashboard?demo=0",
      "https://snackmanager.fr/admin/dashboard?demo=true",
      "https://snackmanager.fr/admin/dashboard?demonstration=1",
      "https://snackmanager.fr/admin/dashboard#/x?demo=1",
    ]) {
      visite(href);
      expect(bandeauPour(isDemoActive()), href).toBeNull();
    }
  });

  it("reste absent sur le back-office d’ÉQUIPE, même avec le paramètre", () => {
    // `/sm` n'est pas une surface de démonstration : la borne de chemin de
    // `mode.ts` l'exclut, et le bandeau la suit sans avoir à la connaître.
    visite("https://snackmanager.fr/sm/clients?demo=1");
    expect(bandeauPour(isDemoActive())).toBeNull();
  });

  it("apparaît sur toute la profondeur de la démonstration", () => {
    for (const href of [
      "https://snackmanager.fr/admin?demo=1",
      "https://snackmanager.fr/admin/dashboard?demo=1",
      "https://snackmanager.fr/admin/ingredients?demo=1&onglet=fournisseurs",
    ]) {
      visite(href);
      expect(bandeauPour(isDemoActive()), href).not.toBeNull();
    }
  });
});

describe("commande en ligne : aucun bandeau sur la page d’un vrai restaurant", () => {
  it("refuse tout slug qui n’est pas le slug réservé", () => {
    // Ces adresses sont celles de vrais clients, y compris celles qui
    // ressemblent à la démonstration. Aucune ne doit porter notre bandeau.
    for (const href of [
      "https://maboite.fr/r/classfood?demo=1",
      "https://maboite.fr/r/le-comptoir?demo=1",
      "https://maboite.fr/r/demo-food?demo=1",
      "https://maboite.fr/r/la-demo?demo=1",
      "https://maboite.fr/r/demos?demo=1",
      "https://maboite.fr/r/DEMO?demo=1",
      "https://maboite.fr/?demo=1",
      "https://maboite.fr/r/demo/suivi?demo=1",
    ]) {
      visite(href);
      expect(bandeauPour(isDemoStorefront(href)), href).toBeNull();
    }
  });

  it("refuse la page de démonstration sans le paramètre exact", () => {
    for (const href of [
      "https://snackmanager.fr/r/demo",
      "https://snackmanager.fr/r/demo?demo=0",
      "https://snackmanager.fr/r/demo?demo=true",
      "https://snackmanager.fr/r/demo?demo=1&demo=0",
      "https://snackmanager.fr/r/demo#?demo=1",
    ]) {
      visite(href);
      expect(bandeauPour(isDemoStorefront(href)), href).toBeNull();
    }
  });

  it("apparaît sur /r/demo?demo=1, et lui seul", () => {
    for (const href of [
      "https://snackmanager.fr/r/demo?demo=1",
      "https://snackmanager.fr/r/demo/?demo=1",
      "http://localhost:3000/r/demo?demo=1",
      "/r/demo?demo=1",
    ]) {
      visite(href);
      expect(bandeauPour(isDemoStorefront(href)), href).not.toBeNull();
    }
  });
});

describe("la destination ne vient jamais de l’URL", () => {
  it("ignore tout paramètre de retour posé sur l’adresse", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://snackmanager.fr");
    for (const suffixe of [
      "&retour=https://pirate.example",
      "&returnTo=https://pirate.example",
      "&next=//pirate.example",
      "&redirect_uri=https://pirate.example",
      "&site=https://pirate.example",
      "&url=javascript:alert(1)",
    ]) {
      visite(`https://snackmanager.fr/admin/dashboard?demo=1${suffixe}`);
      expect(bandeauPour(isDemoActive())?.href, suffixe).toBe(
        "https://snackmanager.fr",
      );
    }
  });

  it("refuse une configuration qui n’est pas une destination", () => {
    for (const mauvaise of [
      "javascript:alert(1)",
      "data:text/html,<script>x</script>",
      "blob:https://pirate.example/x",
      "//pirate.example",
      "/\\pirate.example",
      "https://",
      "   ",
      "",
      null,
      undefined,
    ]) {
      expect(destinationSure(mauvaise), String(mauvaise)).toBe(SITE_PAR_DEFAUT);
    }
  });

  it("retombe sur la racine de l’origine courante par défaut", () => {
    // Le back-office et la commande en ligne sont servis PAR la vitrine : `/`
    // est la bonne réponse, et elle ne peut par construction emmener nulle
    // part ailleurs.
    visite("https://snackmanager.fr/admin/dashboard?demo=1");
    expect(bandeauPour(isDemoActive())?.href).toBe("/");
  });

  it("accepte une URL absolue http(s) ou un chemin de même origine", () => {
    expect(destinationSure("https://snackmanager.fr")).toBe("https://snackmanager.fr");
    expect(destinationSure("http://localhost:3000")).toBe("http://localhost:3000");
    expect(destinationSure("/tarifs")).toBe("/tarifs");
    expect(destinationSure("  https://snackmanager.fr  ")).toBe("https://snackmanager.fr");
  });

  it("ne se laisse pas empoisonner par un repli douteux", () => {
    expect(destinationSure(null, "javascript:alert(1)")).toBe(SITE_PAR_DEFAUT);
  });
});

describe("dans le cadre de la vitrine, aucun bandeau", () => {
  it("rend null quand la surface est encadrée", () => {
    // Le visiteur EST déjà sur le site ; et le bac à sable de l'iframe
    // n'autorise pas la navigation de la fenêtre parente — le lien serait
    // inerte en plus d'être absurde. Le châssis d'appareil de la page
    // d'accueil reste donc exactement tel qu'il est aujourd'hui.
    visite("https://snackmanager.fr/admin/dashboard?demo=1");
    vi.stubGlobal("self", {});
    vi.stubGlobal("top", {});
    resetContexteForTests();
    expect(bandeauPour(true)).toBeNull();
  });
});

describe("libellé : retour ou découverte", () => {
  it("parle de retour quand le référent est notre site", () => {
    visite("https://snackmanager.fr/admin/dashboard?demo=1");
    vi.stubGlobal("document", { referrer: "https://snackmanager.fr/" });
    resetContexteForTests();
    const vu = bandeauPour(isDemoActive());
    expect(vu?.retour).toBe(true);
    expect(vu?.libelle).toBe(LIBELLE_RETOUR);
  });

  it("parle de retour quand aucun référent n’est disponible", () => {
    // `rel="noreferrer"` sur « Ouvrir en plein écran » efface le référent : le
    // visiteur venu de la vitrine arrive nu. On tranche pour le cas dominant.
    visite("https://snackmanager.fr/admin/dashboard?demo=1");
    expect(bandeauPour(isDemoActive())?.libelle).toBe(LIBELLE_RETOUR);
  });

  it("invite à découvrir quand le lien vient d’ailleurs", () => {
    for (const ailleurs of [
      "https://www.google.com/",
      "https://t.co/abcdef",
      "android-app://com.whatsapp/",
    ]) {
      visite("https://snackmanager.fr/r/demo?demo=1");
      vi.stubGlobal("document", { referrer: ailleurs });
      resetContexteForTests();
      const vu = bandeauPour(isDemoStorefront("https://snackmanager.fr/r/demo?demo=1"));
      expect(vu?.retour, ailleurs).toBe(false);
      expect(vu?.libelle, ailleurs).toBe(LIBELLE_DECOUVERTE);
    }
  });

  it("compare des origines, pas des chaînes", () => {
    expect(vientDuSite("HTTPS://SnackManager.FR/tarifs", "https://snackmanager.fr")).toBe(true);
    expect(
      vientDuSite("https://snackmanager.fr.pirate.example/", "https://snackmanager.fr"),
    ).toBe(false);
    expect(vientDuSite("https://x.fr/tarifs", "/", "https://x.fr")).toBe(true);
    expect(vientDuSite("https://y.fr/tarifs", "/", "https://x.fr")).toBe(false);
  });
});

describe("le vocabulaire est commun aux quatre démonstrations", () => {
  it("porte la marque et dit ce que le visiteur regarde", () => {
    visite("https://snackmanager.fr/admin/dashboard?demo=1");
    const vu = bandeauPour(isDemoActive());
    expect(vu?.marque).toBe("Snack Manager");
    expect(vu?.mention).toContain("données fictives");
    expect(vu?.mention).toContain("rien n’est enregistré");
    expect(vu?.mentionCourte).toBe("Données fictives");
  });
});
