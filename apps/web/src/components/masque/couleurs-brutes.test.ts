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
 * `globals.css` n'est PAS parcouru, et ce n'est pas un oubli : ce fichier
 * DÉCLARE la peau de la marque grise, donc des valeurs littérales par
 * définition, et c'est là que vivent — commentées — les deux seules
 * exceptions du produit (le cadre clair du QR de fidélité, qu'une caméra lit,
 * et le voile du viseur du scanner). Le garde juge les SURFACES, pas la
 * déclaration des jetons.
 */

const BRUT = [
  /\b(?:bg|text|border(?:-[trblxy])?|divide|ring|outline|shadow|from|to|via|fill|stroke)-(?:white|black)(?:\/\d+)?\b/,
  /*
   * TOUTE LA PALETTE TAILWIND, ET PAS UNE LISTE À TENIR.
   *
   * Le garde ne bloquait que neutral/zinc/gray/slate/stone : `bg-red-500`,
   * `text-emerald-400` et `border-amber-300` passaient tranquillement, alors
   * qu'ils sont exactement ce que le masque interdit — une couleur qui ne
   * vient ni du restaurant ni des sémantiques du produit. Le motif décrit
   * donc la FORME d'un jeton de palette (`<utilitaire>-<teinte>-<cran>`) :
   * aucune couleur nouvelle de Tailwind ne pourra plus glisser entre les
   * mailles faute d'avoir été ajoutée à une liste.
   */
  /\b(?:bg|text|border(?:-[trblxyse])?|divide|ring|outline|shadow|from|to|via|fill|stroke|accent|caret|decoration|placeholder)-[a-z]+-(?:50|[1-9]00|950)\b/,
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
   *
   * La SECONDE forme ferme la porte de service : `text-[color:var(--cf-accent)]`
   * disait la même chose sans être vu. L'unique emploi légitime — la coche du
   * tunnel, posée sur un disque `on-accent`, donc le couple INVERSE — porte
   * désormais un nom qui l'annonce : `text-accentonaccent` (globals.css).
   */
  /\btext-accent\b/,
  /text-\[color:var\(--cf-accent\)\]/,
  /*
   * NI LAVIS D'ACCENT IMPROVISÉ — il y en a UN, et il est au contrat.
   *
   * `bg-accent/10`, `/12` et `/15` cohabitaient sur sept surfaces pendant que
   * `--cf-accent-wash` (spec §4.1, l'unique opacité 12 %) n'était lu nulle
   * part. C'est sur CE lavis que `contraste()` prouve l'AA de `accentink` et
   * de `mut` : une opacité inventée à l'usage se juge sur une valeur que
   * personne ne peint. `bg-accentwash` est le seul lavis d'accent des
   * surfaces client.
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
   * NI ENCRE ATTÉNUÉE — `mut` et `accentink` SONT le plancher AA.
   *
   * Ces deux nuances sortent de `resoudreMarque` déjà ramenées au ratio
   * minimal sur leur fond : les poser à `/70` ou `/80` les fait repasser
   * dessous, sur SIX directions à la fois. Les placeholders en
   * `placeholder:text-mut/70` descendaient à 3,2:1 — un champ de formulaire
   * dont on ne lit plus l'intitulé. Une opacité sur une COULEUR D'APLAT
   * (`border-ink/8`, `bg-ink/5`) reste libre : rien n'y est du texte.
   */
  /\btext-(?:mut|accentink)\/\d+\b/,
  /*
   * NI ANIMATION COMPOSÉE À LA MAIN — la porte de service de `duration-*`.
   *
   * Le motif précédent (`duration-\d+`) ne voit rien dans
   * `animate-[cf-fade_.22s_var(--sm-ease)_both]` : la durée y est un morceau
   * de valeur arbitraire, pas un utilitaire. Modal et Drawer ont porté cette
   * forme tout du long, `.22s` et `.28s` figés, pendant que le fichier
   * promettait que « le mouvement appartient au masque ».
   *
   * Ce motif ne refuse QUE la durée littérale : il exige un chiffre suivi de
   * `s`/`ms` à l'intérieur des crochets. Une composition qui lit les jetons
   * (`animate-[cf-pop_var(--sm-t-fast)_…]`) reste possible — mais les quatre
   * formes du produit sont nommées dans `globals.css` (`animate-pop`,
   * `animate-rise`, `animate-fade`, `animate-slidein`) et n'ont plus à être
   * recomposées à l'emploi.
   */
  /\banimate-\[[^\]]*[\d.]+m?s[_\]]/,
  /*
   * NI SÉMANTIQUE NUE POSÉE EN TEXTE — c'est la variante `-t` qui est lisible.
   *
   * `--cf-green/red/amber` sont des APLATS : leur texte est `on-*`. Posés en
   * couleur de texte sur une carte ou sur leur propre lavis à 10 %, ils
   * tombent sous AA (le rouge à 2,97:1 sur Nuit, mesuré). Le résolveur émet
   * pour cela `--cf-green-t/red-t/amber-t`, les mêmes teintes ramenées au
   * plancher sur les trois fonds — `text-okt`, `text-alertt`, `text-prept`.
   * Même règle et même raison que `text-accent` → `text-accentink`.
   *
   * `bg-ok`, `border-alert`, `text-onprep` restent libres : ce sont l'aplat et
   * son encre, dont `contraste()` vérifie le couple.
   */
  /\btext-(?:ok|alert|prep)\b/,
];

/*
 * ── LE VOLET CSS ─────────────────────────────────────────────────────────
 *
 * Le garde ne parcourait que les `.tsx` : `order.css` était hors champ, et il
 * y gardait un `drop-shadow(… rgba(0,0,0,.6))` — une ombre noire sous chacun
 * des 46 plats de la carte, y compris sur Brasserie et Soleil. Un commentaire
 * affirmait pourtant que « les deux seules exceptions vivent en CSS ».
 *
 * Le CSS se lit par DÉCLARATION et non par ligne : une valeur y court sur dix
 * lignes, et un `#000` isolé au milieu d'un `mask-image` serait jugé hors du
 * contexte qui l'excuse.
 */
const BRUT_CSS = [
  /#[0-9a-fA-F]{3,8}\b/,
  /\b(?:rgba?|hsla?)\(/,
  /\b(?:white|black)\b/,
];

/**
 * Les propriétés dont la couleur n'est PAS une couleur.
 *
 * Un masque ne lit que le canal alpha de ce qu'on lui donne : le `#000` de
 * `.sm-fade-x` n'est pas du noir, c'est « opaque ». L'exemption est nominative
 * et porte sur la propriété — pas sur un fichier, qui deviendrait une porte.
 */
const PROPRIETES_SANS_COULEUR = new Set(["mask-image", "-webkit-mask-image"]);

type Declaration = { ligne: number; propriete: string; valeur: string };

function declarationsCss(source: string): Declaration[] {
  // Les commentaires sont BLANCHIS, pas retirés : les numéros de ligne
  // rapportés restent ceux du fichier ouvert par le lecteur.
  const net = source.replace(/\/\*[\s\S]*?\*\//g, (bloc) => bloc.replace(/[^\n]/g, " "));
  // Une déclaration finit par `;` et ne contient ni `{` ni `}` : un sélecteur
  // (`.sm-rail::-webkit-scrollbar {`) ne peut donc pas être pris pour une.
  return [...net.matchAll(/([-a-z]+)\s*:\s*([^;{}]+);/gi)].map((m) => ({
    ligne: net.slice(0, m.index).split("\n").length,
    propriete: (m[1] ?? "").toLowerCase(),
    valeur: m[2] ?? "",
  }));
}

function* fichiers(dir: string): Generator<string> {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* fichiers(p);
    else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) yield p;
    else if (/\.css$/.test(e.name)) yield p;
  }
}

describe("aucun jeton contourné dans les surfaces client", () => {
  for (const rep of REPERTOIRES) {
    it(`${rep} ne porte que des jetons`, () => {
      const fautes: string[] = [];
      for (const f of fichiers(join(SRC, rep))) {
        const rel = relative(SRC, f);
        const source = readFileSync(f, "utf8");
        if (f.endsWith(".css")) {
          for (const d of declarationsCss(source)) {
            if (PROPRIETES_SANS_COULEUR.has(d.propriete)) continue;
            const plat = d.valeur.replace(/\s+/g, " ").trim();
            for (const re of BRUT_CSS) {
              if (re.test(d.valeur)) fautes.push(`${rel}:${d.ligne} — ${d.propriete}: ${plat.slice(0, 100)}`);
            }
          }
          continue;
        }
        /*
         * LE GARDE JUGE DU CODE, PAS DE LA PROSE.
         *
         * Il ne sautait que les lignes ouvertes par `//` ou par `*` — soit les
         * commentaires JSDoc, mais PAS un bloc `{/* … *\/}` de JSX, qui est
         * précisément là où l'on explique pourquoi telle forme est interdite.
         * Citer le motif dans son explication faisait échouer le test : le
         * garde punissait sa propre documentation. Les blocs sont donc
         * blanchis d'abord (en gardant les retours à la ligne, pour que le
         * numéro rapporté reste celui du fichier).
         */
        const code = source.replace(/\/\*[\s\S]*?\*\//g, (bloc) => bloc.replace(/[^\n]/g, " "));
        code.split("\n").forEach((l, i) => {
          if (l.trimStart().startsWith("//")) return;
          for (const re of BRUT) if (re.test(l)) fautes.push(`${rel}:${i + 1} — ${l.trim().slice(0, 100)}`);
        });
      }
      expect(fautes, fautes.join("\n")).toEqual([]);
    });
  }
});
