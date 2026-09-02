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
  /*
   * L'ACCENT N'EST JAMAIS DU TEXTE — c'est `accentInk` qui porte l'AA.
   *
   * `--cf-accent` est dessiné pour être un APLAT : sur Soleil, le safran sur
   * le sable tombe à 2,68:1. Un titre de section, un prix, le numéro de
   * retrait posés en `text-accent` étaient donc illisibles sur trois des six
   * directions. `text-accentink` est la même couleur ramenée jusqu'à AA sur
   * le fond — elle existe exactement pour ça (spec §4.1).
   *
   * `bg-accent`, `border-accent`, `ring-accent` et `text-onaccent` restent
   * libres : ce sont des aplats et leur texte, dont `contraste()` vérifie le
   * couple. `\b` en fin de motif suffit à épargner `text-accentink` et
   * `text-onaccent`.
   */
  /\btext-accent\b/,
  /*
   * NI LAVIS D'ACCENT IMPROVISÉ — il y en a UN, et il est au contrat.
   *
   * `bg-accent/10`, `/12` et `/15` cohabitaient sur sept surfaces pendant que
   * `--cf-accent-wash` (spec §4.1, l'unique opacité 12 %) n'était lu nulle
   * part. C'est sur CE lavis que `contraste()` prouve l'AA de `accentink` :
   * une opacité inventée à l'usage se juge sur une valeur que personne ne
   * peint. `bg-accentwash` est le seul lavis d'accent des surfaces client.
   */
  /\bbg-accent\/\d+\b/,
  /*
   * NI DURÉE ÉCRITE EN DUR — le mouvement appartient au masque.
   *
   * `motion: 'pose' | 'vif'` décide 240/320/900 ms ou 140/200/600 : un
   * `duration-200` recopié dans une transition ignorait ce choix, et le
   * masque « vif » d'un fast-food s'animait comme la brasserie d'à côté.
   * `duration-fast/med/slow` lisent `--sm-t-*`. L'ADMIN garde ses littérales :
   * il ne porte pas de masque, et ce garde ne parcourt que le client.
   */
  /\bduration-\d+\b/,
  /*
   * NI ENCRE ATTÉNUÉE — `mut`, `ink2` et `accentink` SONT le plancher AA.
   *
   * Ces trois nuances sortent de `resoudreMarque` déjà ramenées au ratio
   * minimal sur leur fond : les poser à `/70` ou `/80` les fait repasser
   * dessous, sur SIX directions à la fois. Les placeholders en
   * `placeholder:text-mut/70` descendaient à 3,2:1 — un champ de formulaire
   * dont on ne lit plus l'intitulé. Une opacité sur une COULEUR D'APLAT
   * (`border-ink/8`, `bg-ink/5`) reste libre : rien n'y est du texte.
   */
  /\btext-(?:mut|ink2|accentink)\/\d+\b/,
];

function* fichiers(dir: string): Generator<string> {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* fichiers(p);
    else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) yield p;
  }
}

describe("aucun jeton contourné dans les surfaces client", () => {
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
