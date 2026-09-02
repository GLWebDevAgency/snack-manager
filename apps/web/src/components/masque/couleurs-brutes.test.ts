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

/*
 * IL N'Y A PLUS DE LISTE D'ATTENTE — le garde est total.
 *
 * Elle a existé le temps de la migration : chaque tâche en retirait ses
 * fichiers, et la Task 12 l'a vidée. La supprimer plutôt que la laisser vide
 * n'est pas de la coquetterie — une liste vide est une porte entrouverte, et
 * la première urgence y aurait glissé un fichier « pour l'instant ».
 *
 * Les deux seules exceptions du produit vivent en CSS, déclarées et
 * commentées dans `globals.css` : le cadre clair du QR de fidélité (une
 * caméra le lit, pas un œil) et le voile du viseur du scanner.
 */

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
        const lignes = readFileSync(f, "utf8").split("\n");
        lignes.forEach((l, i) => {
          if (l.trimStart().startsWith("//") || l.trimStart().startsWith("*")) return;
          for (const re of BRUT) if (re.test(l)) fautes.push(`${rel}:${i + 1} — ${l.trim().slice(0, 100)}`);
        });
      }
      expect(fautes, fautes.join("\n")).toEqual([]);
    });
  }
});
