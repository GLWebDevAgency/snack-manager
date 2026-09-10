import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DIRECTIONS, resoudreMarque } from "@sm/contracts";
import { styleDuMasque } from "./styleDuMasque";

describe("styleDuMasque", () => {
  it("rend toutes les variables du résolveur plus colorScheme", () => {
    const s = styleDuMasque(DIRECTIONS.brasserie) as Record<string, string>;
    expect(s["--cf-bg"]).toBe("#f5efe3");
    expect(s["--cf-font-display"]).toContain("var(--police-fraunces)");
    expect(s.colorScheme).toBe("light");
  });
});

/**
 * LE JEU DE CLÉS DES DEUX PORTÉES, ÉPINGLÉ L'UN SUR L'AUTRE.
 *
 * `globals.css` déclare la peau de l'admin ; `resoudreMarque()` émet celle du
 * restaurant. Les deux doivent porter EXACTEMENT les mêmes noms : une
 * variable émise mais jamais déclarée n'a pas de repli hors masque, une
 * variable déclarée mais jamais émise garde la valeur de l'admin sous un
 * masque clair — un noir oublié au milieu d'une page crème.
 *
 * C'est par ce trou que `--cf-white-50` (émis, jamais mappé) et `--cf-focus`
 * (mappé, jamais lu) ont dérivé pendant toute une vague. Le test lit le CSS
 * en texte : c'est la seule façon de comparer un fichier de style à du code.
 */
const CSS = readFileSync(join(__dirname, "..", "..", "app", "globals.css"), "utf8");

/** Les `:root` du fichier — il y en a deux : les jetons, puis le logo. */
const ROOTS = [...CSS.matchAll(/:root\s*\{([\s\S]*?)\n\}/g)].map((m) => m[1] ?? "").join("\n");
const DECLAREES = [...ROOTS.matchAll(/^\s*(--(?:cf|sm)-[a-z0-9-]+)\s*:/gm)].map((m) => m[1]!);

/**
 * Les jetons de la MARQUE GRISE — déclarés, jamais dérivés d'un tenant, et
 * c'est le sujet : les repeindre à la couleur d'un restaurant serait le bug.
 */
const FIXES = new Set([
  // Navigation système et textes sur photographie : constantes partagées,
  // séparées des surfaces/accent/typo propres à chaque établissement.
  "--cf-nav-surface-dark", "--cf-nav-surface-light", "--cf-nav-line-dark", "--cf-nav-line-light",
  "--cf-nav-shadow-dark", "--cf-nav-shadow-light", "--cf-nav-highlight-dark", "--cf-nav-highlight-light",
  "--cf-nav-highlight-line-dark", "--cf-nav-highlight-line-light",
  "--cf-photo-text", "--cf-photo-scrim", "--cf-photo-pill", "--cf-photo-line",

  // Le laiton Snack Manager et son encre : notre marque, sur nos surfaces.
  "--cf-gold",
  "--cf-on-gold",
  // Lu par le seul back-office (ProgrammeForm), qui ne porte pas de masque.
  "--cf-shadow-accent",
  // L'accent du LOGO, câblé sur le laiton — jamais sur `--cf-accent`.
  "--sm-logo-accent",
]);

describe("le jeu de clés du masque", () => {
  it("globals.css déclare exactement ce que resoudreMarque émet, aux fixes près", () => {
    const emises = Object.keys(resoudreMarque(DIRECTIONS.nuit).vars).sort();
    const attendues = DECLAREES.filter((k) => !FIXES.has(k)).sort();
    expect(attendues).toEqual(emises);
  });

  it("les jetons fixes existent bel et bien — la liste d’exemption ne ment pas", () => {
    for (const cle of FIXES) expect(DECLAREES, cle).toContain(cle);
  });

  it("chaque jeton de `@theme inline` pointe vers une variable déclarée", () => {
    /*
     * Un `--color-x: var(--cf-y)` dont `--cf-y` n'existe pas produit un
     * utilitaire `bg-x` SILENCIEUX : la propriété est écrite avec une valeur
     * vide, l'élément reste transparent, et rien n'échoue.
     */
    const theme = /@theme inline\s*\{([\s\S]*?)\n\}/.exec(CSS)?.[1] ?? "";
    expect(theme, "bloc @theme inline introuvable").not.toBe("");
    const declarees = new Set(DECLAREES);
    const orphelins = [...theme.matchAll(/^\s*(--[a-z0-9-]+)\s*:\s*var\((--(?:cf|sm)-[a-z0-9-]+)\)/gm)]
      .filter((m) => !declarees.has(m[2]!))
      .map((m) => `${m[1]} → ${m[2]}`);
    expect(orphelins, orphelins.join("\n")).toEqual([]);
  });
});
