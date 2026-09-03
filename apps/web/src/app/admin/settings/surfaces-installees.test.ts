import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DIRECTIONS, marqueDeRepli, type Brand } from "@sm/contracts";
import {
  NOM_COURT_MAX,
  logoPose,
  nomCourt,
  nomTronque,
  phraseDuLanceur,
  sourceDe,
} from "./surfaces-installees";
import { emplacementsDePhoto, emplacementsDuLogo } from "./marque";

const nu = (): Brand => marqueDeRepli(null, null);

const avecLogo = (ou: "mark.light" | "mark.dark" | "lockup.light" | "lockup.dark"): Brand => {
  const b = nu();
  const [famille, teinte] = ou.split(".") as ["mark" | "lockup", "light" | "dark"];
  return {
    ...b,
    logo: { ...b.logo, [famille]: { ...b.logo[famille], [teinte]: "https://exemple.fr/l.png" } },
  };
};

describe("le nom sous l’icône", () => {
  it("coupe à la MÊME longueur que le manifeste, lue dans la vraie route", () => {
    /*
     * Ce test est le garde-fou du duplicata : `NOM_COURT_MAX` recopie le
     * `slice(0, 30)` de la route du manifeste. Le jour où la route change, ce
     * test tombe — sinon l'aperçu annoncerait une troncature qui n'a plus lieu.
     */
    const route = readFileSync(
      join(process.cwd(), "src/app/r/[slug]/fidelite/manifest.webmanifest/route.ts"),
      "utf8",
    );
    const m = /short_name:\s*catalog\.restaurant\.name\.slice\(0,\s*(\d+)\)/.exec(route);
    expect(m, "la route ne tronque plus short_name comme attendu").not.toBeNull();
    expect(Number(m![1])).toBe(NOM_COURT_MAX);
  });

  it("ne touche pas un nom court, et signale une coupe", () => {
    expect(nomCourt("CLASS'FOOD")).toBe("CLASS'FOOD");
    expect(nomTronque("CLASS'FOOD")).toBe(false);
    const long = "Le Comptoir des Saveurs Réunies du Vieux Port";
    expect(nomCourt(long)).toHaveLength(NOM_COURT_MAX);
    expect(nomTronque(long)).toBe(true);
  });
});

describe("quelle icône chaque surface montre", () => {
  const SURFACES = ["lanceur", "onglet", "chargement"] as const;
  const DECLINAISONS = ["mark.light", "mark.dark", "lockup.light", "lockup.dark"] as const;

  it("l’écran d’accueil montre le LOGO dès qu’il y en a un — la route le compose", () => {
    /*
     * C'était LA règle qui surprenait, et elle a cessé d'être vraie : le
     * lanceur lit le rôle masquable, que `icon.svg` compose désormais autour du
     * logo (fond du masque sur tout le canevas, logo ajusté dans la zone sûre).
     * Si cette attente redevenait « genere », l'aperçu recommencerait à
     * annoncer une absence que le téléphone dément.
     */
    expect(sourceDe(nu(), "lanceur")).toBe("genere");
    for (const ou of DECLINAISONS) {
      expect(sourceDe(avecLogo(ou), "lanceur")).toBe("logo");
    }
  });

  it("les trois surfaces disent la même chose, dans les deux états", () => {
    for (const surface of SURFACES) {
      expect(sourceDe(nu(), surface)).toBe("genere");
      for (const ou of DECLINAISONS) {
        expect(sourceDe(avecLogo(ou), surface), `${surface} · ${ou}`).toBe("logo");
        expect(logoPose(avecLogo(ou))).toBe(true);
      }
    }
  });

  it("la phrase du lanceur promet l’écran d’accueil, et garde sa réserve", () => {
    expect(phraseDuLanceur(nu())).toContain("Aucun logo posé");
    const dit = phraseDuLanceur(avecLogo("mark.light"));
    expect(dit).toContain("onglet");
    /*
     * Elle doit dire les trois surfaces, dire que le logo n'est pas recadré —
     * c'est la promesse que `preserveAspectRatio=\"meet\"` tient — et NE PAS
     * promettre sans condition : la composition peut retomber sur notre dessin
     * quand le fichier est trop lourd ou illisible.
     */
    expect(dit).toContain("écran d’accueil");
    expect(dit).toContain("jamais recadré");
    expect(dit).toContain("notre dessin");
    const apresAccueil = dit.slice(dit.indexOf("écran d’accueil"));
    expect(apresAccueil).toMatch(/trop lourd|illisible/);
  });
});

describe("l’ordre des emplacements de logo", () => {
  it("met en tête la déclinaison RÉELLEMENT en usage, et suit le mode", () => {
    for (const cle of Object.keys(DIRECTIONS) as Array<keyof typeof DIRECTIONS>) {
      const b = DIRECTIONS[cle] as Brand;
      const premier = emplacementsDuLogo(b)[0]!;
      expect(premier.cle).toBe(b.mode === "dark" ? "mark.dark" : "mark.light");
    }
  });

  it("place les deux marques avant les deux versions avec le nom", () => {
    const ordre = emplacementsDuLogo(nu()).map((e) => e.cle);
    expect(ordre.slice(0, 2).every((c) => c.startsWith("mark."))).toBe(true);
    expect(ordre.slice(2).every((c) => c.startsWith("lockup."))).toBe(true);
  });

  it("sépare la photo d’accueil du logo — deux questions, deux panneaux", () => {
    expect(emplacementsDuLogo(nu())).toHaveLength(4);
    expect(emplacementsDePhoto().map((e) => e.cle)).toEqual(["hero"]);
  });
});

describe("les mots employés", () => {
  it("chaque emplacement de logo dit « logo », jamais « marque » seule", () => {
    /*
     * La faute qu'on répare : l'écran parlait la langue du graphiste. Un
     * libellé qui repasserait à « Marque, version… » fait tomber ce test.
     */
    for (const e of emplacementsDuLogo(nu())) {
      expect(e.nom.toLowerCase()).toContain("logo");
    }
  });

  it("la photo d’accueil ne s’appelle pas « image », qui ne dit rien", () => {
    expect(emplacementsDePhoto()[0]!.nom).toBe("Photo d’accueil");
  });
});
