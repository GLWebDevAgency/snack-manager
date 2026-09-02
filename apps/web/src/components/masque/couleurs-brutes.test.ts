import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * LA DISCIPLINE QUI REND LE MASQUE TOTAL — un contrôle, pas une consigne.
 *
 * Une couleur brute dans une surface client est un trou dans le masque : sur
 * une Brasserie crème, un `text-white` disparaît et un `border-white/6` n'est
 * plus un filet. Ce test parcourt les répertoires client et échoue sur la
 * première occurrence, avec fichier et ligne.
 */
const SRC = join(__dirname, "..", "..");
const REPERTOIRES = ["app/r", "app/embed", "app/t", "components/order", "components/ui", "components/loyalty"];

/** Fichiers pas encore repassés — cette liste DOIT être vide à la fin de la Task 12. */
const EN_ATTENTE = new Set<string>([
  "components/order/Checkout.tsx",
  "components/order/Tracking.tsx",
  "components/order/ProductSheet.tsx",
  "components/order/StripeCard.tsx",
  "components/order/TurnstileCheck.tsx",
  "app/r/[slug]/fidelite/not-found.tsx",
  "components/loyalty/LoyaltyCardApp.tsx",
  "components/loyalty/DemoLoyaltyCard.tsx",
  "components/loyalty/LoyaltyScanner.tsx",
]);

const BRUT = [
  /\b(?:bg|text|border(?:-[trblxy])?|divide|ring|outline|shadow|from|to|via|fill|stroke)-(?:white|black)(?:\/\d+)?\b/,
  /\b(?:bg|text|border|divide)-(?:neutral|zinc|gray|slate|stone)-\d+\b/,
  /\b(?:bg|text|border|from|to|via)-\[#[0-9a-fA-F]{3,8}\]/,
  /\[linear-gradient\([^\]]*#[0-9a-fA-F]{3,8}/,
  // Pas de `\b` en tête : le séparateur `_` de Tailwind (`shadow-[0_1px_…]`)
  // est un caractère de mot — la frontière n'existe jamais avant `rgba`.
  /rgba?\(\s*(?:255|0)\s*,\s*(?:255|0)\s*,\s*(?:255|0)/,
];

function* fichiers(dir: string): Generator<string> {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* fichiers(p);
    else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) yield p;
  }
}

describe("aucune couleur brute dans les surfaces client", () => {
  for (const rep of REPERTOIRES) {
    it(`${rep} ne porte que des jetons`, () => {
      const fautes: string[] = [];
      for (const f of fichiers(join(SRC, rep))) {
        const rel = relative(SRC, f);
        if (EN_ATTENTE.has(rel)) continue;
        const lignes = readFileSync(f, "utf8").split("\n");
        lignes.forEach((l, i) => {
          if (l.trimStart().startsWith("//") || l.trimStart().startsWith("*")) return;
          for (const re of BRUT) if (re.test(l)) fautes.push(`${rel}:${i + 1} — ${l.trim().slice(0, 100)}`);
        });
      }
      expect(fautes, fautes.join("\n")).toEqual([]);
    });
  }

  it("la liste d’attente ne contient que des fichiers qui existent encore", () => {
    for (const rel of EN_ATTENTE) expect(() => readFileSync(join(SRC, rel))).not.toThrow();
  });
});
