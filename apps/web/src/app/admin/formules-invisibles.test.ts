import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * LA RÈGLE D'OR, TENUE PAR UN CONTRÔLE ET NON PAR UNE CONSIGNE.
 *
 * Le back-office du restaurateur ne connaît JAMAIS le nom d'une formule. Il ne
 * demande pas « la formule vaut-elle Boost ? », il demande « ce restaurant
 * a-t-il la capacité `online` ? ». La liste des capacités effectives lui est
 * donnée par le serveur (`GET /tenants/me` → `capacites`) ; le catalogue qui
 * la produit vit dans `packages/contracts/src/capacites.ts`, et lui seul.
 *
 * ─── CE QUE ÇA COÛTE DE NE PAS LE TENIR ───
 *
 * Le conditionnement commercial bouge : une promotion, un renommage, un geste
 * pour un client historique, une formule scindée en deux. Chaque `=== "boost"`
 * disséminé dans un écran transforme cette décision de tarif en chantier de
 * développement — et, pire, en chantier qu'on croit terminé alors qu'il reste
 * une comparaison oubliée dans un écran qu'on ouvre rarement.
 *
 * Le jumeau de ce contrôle vit côté API (`apps/api/src/common/
 * formules-invisibles.test.ts`) et garde les mêmes noms. Deux fichiers plutôt
 * qu'un : un test qui lirait l'arborescence de l'autre paquet tomberait dès
 * qu'on construit l'un sans l'autre, et c'est précisément ce que fait une
 * image de conteneur.
 *
 * ─── CE QU'IL NE PARCOURT PAS ───
 *
 * · les fichiers de test, qui doivent pouvoir épingler la matrice ligne à
 *   ligne — c'est même leur rôle, et un test ne livre aucun comportement ;
 * · les commentaires, blanchis avant l'examen. Ce fichier-ci en est la preuve :
 *   il cite les trois formules pour expliquer la règle, et se punirait
 *   lui-même sans cette précaution ;
 * · la vitrine (`app/(marketing)`) et le back-office de l'équipe (`app/sm`),
 *   qui VENDENT les formules et doivent évidemment les nommer.
 */

const ADMIN = join(__dirname);

/**
 * Les trois formules, écrites ici en toutes lettres — dans le seul fichier du
 * back-office qui a le droit de les nommer, parce que c'est celui qui les
 * interdit.
 */
const FORMULES = ["essentiel", "complet", "boost"];

const INTERDITS: readonly { motif: RegExp; pourquoi: string }[] = [
  {
    /*
     * Un nom de formule en LITTÉRAL COMPLET — `"boost"`, `'complet'`,
     * `` `essentiel` ``. Les quotes encadrantes sont exigées des deux côtés :
     * sans elles, le mot français « complet » d'une phrase d'interface et
     * l'attribut `autoComplete` d'un champ de formulaire feraient rougir le
     * contrôle pour rien, et un contrôle qui crie à tort finit désactivé.
     */
    motif: new RegExp(`(['"\`])(?:${FORMULES.join("|")})\\1`, "i"),
    pourquoi: "nom de formule en dur — demandez une capacité, pas une formule",
  },
  {
    /*
     * Les TABLES de l'offre. Les lire ici reviendrait à recalculer le
     * conditionnement dans le navigateur : une seconde copie du catalogue, qui
     * divergerait de l'API au premier changement d'offre — la moitié des
     * écrans verrouillés d'un côté, ouverts de l'autre.
     */
    motif:
      /\b(?:PLAN_MRR_CENTS|PLAN_LABELS|PLAN_NONE_LABEL|PLAN_NONE_SHORT_LABEL|planChoiceLabel|PlanChoice|PlanSchema|ADMIN_PLANS|CAPACITES_PAR_FORMULE|CAPACITES_SANS_FORMULE|FORMULES)\b/,
    pourquoi: "le catalogue se lit dans le contrat, jamais depuis un écran",
  },
];

function* fichiers(dir: string): Generator<string> {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* fichiers(p);
    else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) yield p;
  }
}

describe("aucune formule nommée dans le back-office du restaurateur", () => {
  it("ne compare jamais une formule — il demande une capacité", () => {
    const fautes: string[] = [];
    for (const f of fichiers(ADMIN)) {
      const rel = relative(ADMIN, f);
      // Les blocs de commentaire sont BLANCHIS en gardant les retours à la
      // ligne : le numéro rapporté reste celui du fichier ouvert par le lecteur.
      const code = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, (bloc) =>
        bloc.replace(/[^\n]/g, " "),
      );
      code.split("\n").forEach((ligne, i) => {
        if (ligne.trimStart().startsWith("//")) return;
        for (const { motif, pourquoi } of INTERDITS) {
          if (motif.test(ligne)) {
            fautes.push(`${rel}:${i + 1} — ${pourquoi}\n    ${ligne.trim().slice(0, 110)}`);
          }
        }
      });
    }
    expect(fautes, fautes.join("\n")).toEqual([]);
  });

  it("se surveille lui-même — les motifs attrapent bien ce qu’ils décrivent", () => {
    // Un garde qu'on n'a jamais vu échouer est un garde dont on ignore s'il
    // fonctionne. Ces trois lignes sont exactement celles qu'on veut refuser.
    const echantillons = [
      'if (tenant.plan === "boost") return true;',
      "const prix = PLAN_MRR_CENTS[plan];",
      "const ouvert = plan === 'complet';",
    ];
    for (const ligne of echantillons) {
      expect(INTERDITS.some(({ motif }) => motif.test(ligne)), ligne).toBe(true);
    }
    // Et celles-ci doivent passer : le mot français, l'attribut de formulaire,
    // et la question qu'on veut voir posée à la place.
    const innocentes = [
      'hint="Si votre hébergeur réclame le nom complet, saisissez-le."',
      'autoComplete="off"',
      'if (capacites.includes("online")) ouvrir();',
    ];
    for (const ligne of innocentes) {
      expect(INTERDITS.some(({ motif }) => motif.test(ligne)), ligne).toBe(false);
    }
  });
});
