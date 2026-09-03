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
  it("l’écran d’accueil montre TOUJOURS notre dessin, logo posé ou non", () => {
    /*
     * C'est le fait qui surprend, et l'aperçu ne doit pas le cacher : le
     * lanceur lit le rôle masquable, que le logo déposé n'occupe jamais.
     */
    expect(sourceDe(nu(), "lanceur")).toBe("genere");
    for (const ou of ["mark.light", "mark.dark", "lockup.light", "lockup.dark"] as const) {
      expect(sourceDe(avecLogo(ou), "lanceur")).toBe("genere");
    }
  });

  it("l’onglet et l’ouverture montrent le logo dès qu’une SEULE déclinaison est posée", () => {
    expect(sourceDe(nu(), "onglet")).toBe("genere");
    expect(sourceDe(nu(), "chargement")).toBe("genere");
    for (const ou of ["mark.light", "mark.dark", "lockup.light", "lockup.dark"] as const) {
      expect(sourceDe(avecLogo(ou), "onglet")).toBe("logo");
      expect(sourceDe(avecLogo(ou), "chargement")).toBe("logo");
      expect(logoPose(avecLogo(ou))).toBe(true);
    }
  });

  it("la phrase du lanceur change avec l’état, et ne promet rien de faux", () => {
    expect(phraseDuLanceur(nu())).toContain("Aucun logo posé");
    const dit = phraseDuLanceur(avecLogo("mark.light"));
    expect(dit).toContain("onglet");
    expect(dit).toContain("notre dessin");
    /*
     * Ce qui compte n'est pas l'absence d'un mot, c'est que la phrase qui
     * parle de l'écran d'accueil dise NOTRE dessin. Une expression trop
     * gourmande échouait sur une phrase pourtant honnête — elle enjambait
     * la ponctuation entre les deux propositions.
     */
    const apresAccueil = dit.slice(dit.indexOf("écran d’accueil"));
    expect(apresAccueil).toContain("notre dessin");
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
