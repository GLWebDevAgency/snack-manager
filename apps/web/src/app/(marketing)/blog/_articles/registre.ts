import { isValidElement, type ReactElement, type ReactNode } from "react";
import { corps as corpsClickCollect } from "./ouvrir-le-click-and-collect-sans-se-tromper";
import { corps as corpsFicheGoogle } from "./lien-de-commande-sur-votre-fiche-google";
import { corps as corpsPrixApplis } from "./pourquoi-les-prix-sont-plus-chers-sur-les-applis";

/**
 * ═══ LE BLOG NE COÛTE PAS UNE DÉPENDANCE, ET C'EST LE PREMIER CHOIX ═══
 *
 * Un article est un MODULE TSX : il exporte `corps()`, une fonction qui rend son
 * texte, et ce fichier lui accole ses métadonnées. Pas de MDX, pas de parseur
 * markdown, pas de plugin de build, pas une ligne ajoutée à `package.json`.
 *
 * Le dépôt est un monorepo pnpm en `node-linker=hoisted` servi par Turbopack :
 * chaque dépendance de build y a déjà coûté du temps, et un parseur de contenu
 * en coûterait deux fois — une fois à l'installer, une fois le jour où il ne
 * suivra pas une version de Next. Ce que MDX apporterait ici, c'est d'écrire
 * `## Titre` au lieu de `<h2 className="bl-h2">` ; ce qu'il ferait perdre, c'est
 * le typage du contenu, la vérification des liens internes par `Renvoi`, et la
 * capacité d'un article à LIRE une constante du produit — l'article sur les
 * commissions affiche `COMMISSIONS` (content.ts) au lieu de recopier des taux
 * qui divergeraient de la vitrine à la première révision.
 *
 * La contrepartie est assumée : écrire un article demande de savoir taper du
 * JSX. Nous sommes deux, et le blog sert le référencement, pas une rédaction.
 *
 * ═══ CE FICHIER EST LE SEUL SOMMAIRE ═══
 *
 * `/blog` et `/blog/[slug]` lisent tous les deux `ARTICLES`. Un article publié
 * sans être inscrit ici n'existe nulle part — et surtout, il ne peut pas
 * exister à moitié : la page de liste et la génération statique des routes
 * viennent de la même table.
 */

export type Article = {
  /** Segment d'URL — sans accent ni apostrophe, il vit dans une adresse. */
  readonly slug: string;
  /** Le `h1` de l'article ET le `<title>` de l'onglet. Écrit ici, nulle part ailleurs. */
  readonly titre: string;
  /** Le chapô : première chose lue sur la liste, et la meta description. Une à trois phrases. */
  readonly chapo: string;
  /** Date de publication, en ISO 8601 — c'est aussi ce que reçoit `datePublished`. */
  readonly publieLe: string;
  /** Mots-clés de la page. Ils décrivent l'article, ils ne répètent pas ceux de la vitrine. */
  readonly motsCles: readonly string[];
  /** Le corps, en composant serveur. Appelé une fois par rendu. */
  readonly corps: () => ReactElement;
};

/**
 * Un article, plus ce qu'on en calcule.
 *
 * `mots` n'est pas un détail d'implémentation exposé par paresse : les données
 * structurées publient un `wordCount`, et le déduire des minutes (× 200) le
 * ferait mentir de tout l'arrondi. On publie le comptage, l'affichage publie
 * les minutes.
 */
export type ArticlePublie = Article & { readonly mots: number; readonly minutes: number };

/**
 * LES TROIS ARTICLES, DANS L'ORDRE OÙ ILS ONT ÉTÉ ÉCRITS.
 *
 * Ils portent la même date de publication, et ce n'est pas un oubli : ils sont
 * sortis ensemble. Antidater le deuxième et le troisième pour obtenir un joli
 * dégradé de dates serait fabriquer une histoire — la même faute, en plus petit,
 * que le compteur « 3 places prises » que la vitrine a fini par retirer.
 *
 * Le tri ci-dessous est donc STABLE : à date égale, c'est cet ordre-ci qui
 * décide, et il place en tête celui qui répond à la recherche la plus concrète.
 */
const SOURCES: readonly Article[] = [
  {
    slug: "lien-de-commande-sur-votre-fiche-google",
    titre: "Mettre votre lien de commande sur votre fiche Google, et le marquer comme préféré",
    chapo:
      "Sur votre fiche Google, le bouton de commande existe déjà — et il ne mène pas forcément chez vous. Vous pouvez y ajouter votre propre lien et le désigner comme préféré. Voici où cliquer, exactement.",
    publieLe: "2026-08-21",
    motsCles: [
      "fiche Google restaurant",
      "lien de commande Google",
      "Google Business Profile commande de repas",
      "commande en ligne restaurant",
      "click and collect Google",
    ],
    corps: corpsFicheGoogle,
  },
  {
    slug: "pourquoi-les-prix-sont-plus-chers-sur-les-applis",
    titre: "Pourquoi le même kebab coûte plus cher sur l'appli",
    chapo:
      "Ce n'est ni une arnaque ni une erreur de saisie : c'est une addition. Deux factures se superposent sur la même commande, et une troisième différence vient du restaurateur lui-même. Le détail, sans faire le procès de personne.",
    publieLe: "2026-08-21",
    motsCles: [
      "commission plateforme livraison",
      "prix Uber Eats plus cher",
      "frais de service livraison",
      "commande en direct restaurant",
      "marge restaurant livraison",
    ],
    corps: corpsPrixApplis,
  },
  {
    slug: "ouvrir-le-click-and-collect-sans-se-tromper",
    titre: "Ouvrir le click and collect sans se tromper",
    chapo:
      "Le click and collect casse rarement à cause du logiciel. Il casse sur trois réglages : la durée des créneaux, le temps de préparation annoncé, et ce qu'on met — ou pas — à la carte en ligne.",
    publieLe: "2026-08-21",
    motsCles: [
      "click and collect restaurant",
      "créneaux de retrait",
      "temps de préparation commande",
      "ouvrir la commande en ligne",
      "snack à emporter",
    ],
    corps: corpsClickCollect,
  },
];

/* ── Temps de lecture ────────────────────────────────────────── */

/**
 * ═══ LE TEMPS DE LECTURE SE CALCULE, IL NE SE SAISIT PAS ═══
 *
 * Un « 6 min » tapé à la main dans les métadonnées est vrai le jour où on
 * l'écrit et faux à la première relecture qui ajoute deux paragraphes — sans que
 * rien ne le signale, exactement comme les prix recopiés que `content.ts` a fini
 * par centraliser. On compte donc les mots du corps réel.
 *
 * Le corps est un ARBRE d'éléments React, pas une chaîne : on le parcourt, on
 * additionne les mots des nœuds textuels. Deux limites, connues et acceptées :
 * le texte passé en `props` (les titres d'étapes, les libellés de `Note`) n'est
 * pas compté, et le contenu rendu à l'intérieur d'un composant ne l'est pas non
 * plus — seuls comptent ses `children`, c'est-à-dire ce que l'article a
 * réellement écrit. C'est une ESTIMATION affichée en minutes rondes ; la
 * précision au mot près n'aurait aucun sens de toute façon.
 */
const MOTS_PAR_MINUTE = 200;

function motsDe(node: ReactNode): number {
  if (typeof node === "string") {
    const propre = node.trim();
    return propre === "" ? 0 : propre.split(/\s+/).length;
  }
  if (typeof node === "number") return 1;
  if (Array.isArray(node)) return node.reduce<number>((total, enfant) => total + motsDe(enfant as ReactNode), 0);
  if (isValidElement(node)) {
    const props = node.props as { children?: ReactNode };
    return motsDe(props.children);
  }
  // `null`, `undefined`, `boolean` : React ne les rend pas, on ne les compte pas.
  return 0;
}

/** Minutes rondes, au moins une — « 0 min de lecture » ne veut rien dire. */
function minutesDe(mots: number): number {
  return Math.max(1, Math.round(mots / MOTS_PAR_MINUTE));
}

/* ── La table publiée ────────────────────────────────────────── */

/**
 * Du plus récent au plus ancien. `Array.prototype.sort` est stable depuis
 * ES2019 : à date égale, l'ordre de `SOURCES` est conservé, ce qui est
 * précisément le comportement voulu (voir le commentaire de `SOURCES`).
 */
export const ARTICLES: readonly ArticlePublie[] = [...SOURCES]
  .sort((a, b) => b.publieLe.localeCompare(a.publieLe))
  .map((article) => {
    const mots = motsDe(article.corps());
    return { ...article, mots, minutes: minutesDe(mots) };
  });

/** L'article d'un slug, ou `undefined` — la page appelle alors `notFound()`. */
export function articleParSlug(slug: string): ArticlePublie | undefined {
  return ARTICLES.find((a) => a.slug === slug);
}

/** Les autres articles, pour le pied d'article. Jamais celui qu'on est en train de lire. */
export function autresArticles(slug: string): readonly ArticlePublie[] {
  return ARTICLES.filter((a) => a.slug !== slug);
}

/* ── Adresses ────────────────────────────────────────────────── */

/**
 * Le chemin du blog est le NOM DU DOSSIER, `app/(marketing)/blog` — le groupe
 * `(marketing)` ne paraît pas dans l'adresse publique. On l'écrit ici une fois
 * pour que rien d'autre n'ait à le savoir.
 */
export const BLOG_PATH = "/blog";

export const cheminArticle = (slug: string): string => `${BLOG_PATH}/${slug}`;

/*
 * L'ORIGINE PUBLIQUE N'EST PLUS ICI. Ce fichier redéclarait
 * `process.env.NEXT_PUBLIC_SITE_URL ?? "https://snackmanager.fr"`, déjà écrit
 * dans le layout du groupe et dans la page Offres : trois copies du même repli,
 * dont deux suivraient un changement de domaine et une non. Elle vit désormais
 * dans `@/lib/site` (`SITE_URL`, `urlAbsolue`), que le plan de site et le
 * fichier robots lisent aussi — eux ne pouvaient de toute façon pas importer
 * quoi que ce soit d'ici, ils vivent à la racine de `app/`.
 */

/* ── Dates ───────────────────────────────────────────────────── */

const MOIS = [
  "janvier",
  "février",
  "mars",
  "avril",
  "mai",
  "juin",
  "juillet",
  "août",
  "septembre",
  "octobre",
  "novembre",
  "décembre",
] as const;

/**
 * « 2026-08-21 » → « 21 août 2026 ».
 *
 * ET SÛREMENT PAS `toLocaleDateString`. Même raison que `euros()` dans
 * `content.ts` : le formatage ICU du français a changé d'une version de Node à
 * l'autre, et un caractère d'écart entre le rendu serveur et le rendu navigateur
 * casse l'hydratation de la page entière. Une table de douze mois ne change
 * jamais d'avis.
 *
 * La fonction LÈVE sur une date mal formée plutôt que d'afficher « NaN
 * undefined » : une date de publication fausse dans les données structurées est
 * exactement le genre d'erreur qu'on ne voit qu'en lisant le code source de sa
 * propre page.
 */
export function dateEnClair(iso: string): string {
  const [annee, mois, jour] = iso.split("-").map(Number);
  const nomDuMois = MOIS[mois - 1];
  if (!annee || !nomDuMois || !jour) throw new Error(`Date d'article illisible : ${iso}`);
  return `${jour === 1 ? "1er" : jour} ${nomDuMois} ${annee}`;
}
