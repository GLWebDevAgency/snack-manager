import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * LA RÈGLE D'OR, TENUE PAR UN CONTRÔLE ET NON PAR UNE CONSIGNE.
 *
 * Le produit ne connaît JAMAIS le nom d'une formule. Il ne demande pas « la
 * formule vaut-elle Boost ? », il demande « ce restaurant a-t-il la capacité
 * `online` ? » — `aLaCapacite`, `@Capacites(...)`, et le catalogue qui les
 * nourrit vit dans `packages/contracts/src/capacites.ts`, lui seul.
 *
 * ─── CE QUE ÇA COÛTE DE NE PAS LE TENIR ───
 *
 * Le conditionnement commercial bouge : une promotion, un renommage, un geste
 * pour un client historique, une formule scindée en deux. Chaque
 * `=== 'boost'` disséminé dans un service transforme cette décision de tarif
 * en chantier de développement — et, pire, en chantier qu'on croit terminé
 * alors qu'il reste une comparaison oubliée dans une route qu'on appelle
 * rarement. C'est exactement ce qui est arrivé à la facturation, qui retombait
 * sur `plan` seul et facturait 159 € au lieu de 238 €.
 *
 * Le jumeau de ce contrôle vit côté web (`apps/web/src/app/admin/
 * formules-invisibles.test.ts`) et porte les mêmes motifs. Deux fichiers
 * plutôt qu'un : un test qui lirait l'arborescence de l'autre paquet tomberait
 * dès qu'on construit l'un sans l'autre, et c'est précisément ce que fait une
 * image de conteneur.
 *
 * ─── CE QU'IL NE PARCOURT PAS, ET POURQUOI ───
 *
 * · `modules/crm` — le back-office de l'ÉQUIPE Snack Manager. Il vend les
 *   formules, chiffre les devis et calcule le MRR : lui interdire de les
 *   nommer serait lui interdire son métier ;
 * · `modules/billing` — la facture vue par le gérant. Une facture DIT ce qui a
 *   été vendu ; c'est même tout ce qu'on lui demande ;
 * · les fichiers de test, qui doivent pouvoir épingler la matrice ligne à
 *   ligne — un test ne livre aucun comportement ;
 * · les commentaires, blanchis avant l'examen. Ce fichier-ci en est la preuve :
 *   il cite les trois formules pour expliquer la règle.
 */

const SRC = join(__dirname, '..');

/** Les répertoires qui vendent l'offre, et qui ont donc le droit de la nommer. */
const VENDEURS = new Set(['crm', 'billing']);

/**
 * Les trois formules, écrites en toutes lettres — dans le seul fichier de
 * l'API qui a le droit de les nommer, parce que c'est celui qui les interdit.
 */
const FORMULES = ['essentiel', 'complet', 'boost'];

const INTERDITS: readonly { motif: RegExp; pourquoi: string }[] = [
  {
    /*
     * Un nom de formule en LITTÉRAL COMPLET — `'boost'`, `"complet"`. Les
     * quotes encadrantes sont exigées des deux côtés : sans elles, le mot
     * français « complet » d'un message d'erreur ferait rougir le contrôle
     * pour rien, et un contrôle qui crie à tort finit désactivé.
     */
    motif: new RegExp(`(['"\`])(?:${FORMULES.join('|')})\\1`, 'i'),
    pourquoi: 'nom de formule en dur — demandez une capacité, pas une formule',
  },
  {
    /*
     * Les TABLES de l'offre. Les lire hors du contrat reviendrait à
     * recalculer le conditionnement à côté du catalogue : une seconde source,
     * qui divergerait de la première au prochain changement d'offre.
     */
    motif:
      /\b(?:PLAN_MRR_CENTS|PLAN_LABELS|PLAN_NONE_LABEL|PLAN_NONE_SHORT_LABEL|planChoiceLabel|PlanChoice|PlanSchema|ADMIN_PLANS|CAPACITES_PAR_FORMULE|CAPACITES_SANS_FORMULE|FORMULES)\b/,
    pourquoi: 'le catalogue se lit dans le contrat, jamais depuis un service',
  },
];

function* fichiers(dir: string): Generator<string> {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory() && VENDEURS.has(e.name) && dir.endsWith('modules')) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* fichiers(p);
    else if (/\.ts$/.test(e.name) && !/\.test\.ts$/.test(e.name)) yield p;
  }
}

describe('aucune formule nommée hors du catalogue', () => {
  it('ne compare jamais une formule — il demande une capacité', () => {
    const fautes: string[] = [];
    for (const f of fichiers(SRC)) {
      const rel = relative(SRC, f);
      // Les blocs de commentaire sont BLANCHIS en gardant les retours à la
      // ligne : le numéro rapporté reste celui du fichier ouvert par le lecteur.
      const code = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, (bloc) =>
        bloc.replace(/[^\n]/g, ' '),
      );
      code.split('\n').forEach((ligne, i) => {
        if (ligne.trimStart().startsWith('//')) return;
        for (const { motif, pourquoi } of INTERDITS) {
          if (motif.test(ligne)) {
            fautes.push(`${rel}:${i + 1} — ${pourquoi}\n    ${ligne.trim().slice(0, 110)}`);
          }
        }
      });
    }
    expect(fautes, fautes.join('\n')).toEqual([]);
  });

  it('écarte bien les deux répertoires qui VENDENT l’offre', () => {
    // Une exemption qui ne porterait sur rien serait pire qu'absente : elle
    // ferait croire à une protection. On vérifie donc qu'elle sert vraiment.
    const parcourus = [...fichiers(SRC)].map((f) => relative(SRC, f));
    expect(parcourus.some((f) => f.startsWith(join('modules', 'crm')))).toBe(false);
    expect(parcourus.some((f) => f.startsWith(join('modules', 'billing')))).toBe(false);
    // …et que tout le reste l'est bien, à commencer par la garde elle-même.
    expect(parcourus).toContain('common/capacites.ts');
    expect(parcourus).toContain(join('modules', 'tenants', 'tenants.service.ts'));
  });

  it('se surveille lui-même — les motifs attrapent bien ce qu’ils décrivent', () => {
    // Un garde qu'on n'a jamais vu échouer est un garde dont on ignore s'il
    // fonctionne. Ces trois lignes sont exactement celles qu'on veut refuser.
    for (const ligne of [
      "if (tenant.plan === 'boost') return true;",
      'const mrr = PLAN_MRR_CENTS[plan];',
      'const inclus = CAPACITES_PAR_FORMULE[plan];',
    ]) {
      expect(
        INTERDITS.some(({ motif }) => motif.test(ligne)),
        ligne,
      ).toBe(true);
    }
    // Et celles-ci doivent passer : le mot français, et la question qu'on veut
    // voir posée à la place.
    for (const ligne of [
      "throw new BadRequestException('Le formulaire est incomplet');",
      "if (aLaCapacite(tenant, 'online')) ouvrir();",
    ]) {
      expect(
        INTERDITS.some(({ motif }) => motif.test(ligne)),
        ligne,
      ).toBe(false);
    }
  });
});
