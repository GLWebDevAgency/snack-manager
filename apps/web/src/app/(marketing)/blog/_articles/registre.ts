import { isValidElement, type ReactElement, type ReactNode } from "react";
import type { Shot } from "@/components/marketing/content";
import { corps as corpsClickCollect } from "./ouvrir-le-click-and-collect-sans-se-tromper";
import { corps as corpsFicheGoogle } from "./lien-de-commande-sur-votre-fiche-google";
import { corps as corpsPrixApplis } from "./pourquoi-les-prix-sont-plus-chers-sur-les-applis";
import { corps as corpsMenus } from "./refaire-menu-restaurant-papier-tv";
import { corps as corpsVisibilite } from "./visibilite-restaurant-google-site-internet";

export type ArticleSource = {
  readonly titre: string;
  readonly url: string;
  readonly consulteLe: string;
};

export type Article = {
  readonly slug: string;
  readonly titre: string;
  readonly chapo: string;
  readonly categorie: string;
  readonly reponseCourte: string;
  readonly publieLe: string;
  /** Une date change seulement après une révision effective du contenu. */
  readonly modifieLe?: string;
  readonly motsCles: readonly string[];
  readonly sections: readonly { readonly id: string; readonly titre: string }[];
  readonly sources: readonly ArticleSource[];
  readonly lies: readonly string[];
  /** Illustrations décoratives. Photos libres : public/photos/libre/PROVENANCE.md. */
  readonly photo: Shot;
  readonly corps: () => ReactElement;
};

export type ArticlePublie = Article & { readonly mots: number; readonly minutes: number };

const DATE_REVISION = "2026-09-24";
const source = (titre: string, url: string): ArticleSource => ({ titre, url, consulteLe: DATE_REVISION });

/** Registre unique : index, pages statiques, sitemap et données structurées. Pas de CMS ni de requête client. */
const SOURCES: readonly Article[] = [
  {
    slug: "refaire-menu-restaurant-papier-tv",
    titre: "Refaire votre menu de restaurant : du papier aux écrans TV",
    chapo: "Brief, mise en page, données de vente, impression et diffusion : préparez une carte lisible et un devis clair pour chaque support.",
    categorie: "Menus papier & TV",
    reponseCourte: "Partez d'une carte de référence, puis adaptez la lecture à chaque support. Validez le papier à taille réelle et la TV depuis la place du client. Séparez conception, impression, matériel et diffusion dans le devis.",
    publieLe: DATE_REVISION,
    motsCles: ["refonte menu restaurant", "menu trois volets", "menu TV restaurant", "création carte restaurant"],
    sections: [
      { id: "brief", titre: "Préparer un brief qui évite les allers-retours" },
      { id: "papier", titre: "Concevoir le papier à taille réelle" },
      { id: "tv", titre: "Construire une lecture stable sur TV" },
      { id: "ventes", titre: "Choisir les mises en avant à partir de vos données" },
      { id: "devis", titre: "Séparer conception, fabrication et diffusion dans le devis" },
      { id: "validation", titre: "Valider, publier et tenir les versions à jour" },
    ],
    sources: [source("Service Public Entreprendre — réglementation des bars et restaurants", "https://entreprendre.service-public.gouv.fr/vosdroits/F22387")],
    lies: ["visibilite-restaurant-google-site-internet", "pourquoi-les-prix-sont-plus-chers-sur-les-applis", "ouvrir-le-click-and-collect-sans-se-tromper"],
    photo: { src: "/illustrations/food/bowl.svg", alt: "" },
    corps: corpsMenus,
  },
  {
    slug: "visibilite-restaurant-google-site-internet",
    titre: "Visibilité du restaurant : relier votre fiche Google et votre site",
    chapo: "Fiche Google, site, avis, réseaux et moteurs IA : une méthode concrète pour être trouvé, donner confiance et faciliter la visite ou la commande.",
    categorie: "Visibilité locale",
    reponseCourte: "Commencez par des informations cohérentes : carte, horaires, adresse et lien d'action. Reliez votre fiche Google, votre site et vos réseaux, puis suivez les demandes réelles. Aucune optimisation ne garantit une position ou une citation par une IA.",
    publieLe: DATE_REVISION,
    motsCles: ["référencement restaurant", "visibilité restaurant Google", "site internet restaurant", "fiche Google restaurant"],
    sections: [
      { id: "diagnostic", titre: "Faire le tour de votre présence actuelle" },
      { id: "fiche-google", titre: "Compléter la fiche Google sans la surcharger" },
      { id: "site", titre: "Construire un site qui répond avant de convaincre" },
      { id: "avis-reseaux", titre: "Relier avis, réseaux sociaux et visite réelle" },
      { id: "moteurs-ia", titre: "Préparer une information compréhensible par les moteurs IA" },
      { id: "mesurer", titre: "Mesurer les actions utiles au restaurant" },
      { id: "accompagnement", titre: "Choisir un accompagnement avec des livrables clairs" },
    ],
    sources: [
      source("Google — représenter fidèlement votre établissement", "https://support.google.com/business/answer/3038177?hl=fr"),
      source("Google — facteurs du classement local", "https://support.google.com/business/answer/7091?hl=fr"),
      source("Google — recueillir les avis de vos clients", "https://support.google.com/business/answer/3474122?hl=fr"),
      source("Google Search Central — fonctionnalités IA et référencement", "https://developers.google.com/search/docs/appearance/ai-features"),
      source("Google Search Central — guide des fonctions de recherche générative", "https://developers.google.com/search/docs/fundamentals/ai-optimization-guide"),
      source("OpenAI — FAQ pour les éditeurs et développeurs", "https://help.openai.com/en/articles/12627856-publishers-and-developers-faq"),
    ],
    lies: ["lien-de-commande-sur-votre-fiche-google", "refaire-menu-restaurant-papier-tv", "ouvrir-le-click-and-collect-sans-se-tromper"],
    photo: { src: "/illustrations/food/thai-noodles.svg", alt: "" },
    corps: corpsVisibilite,
  },
  {
    slug: "lien-de-commande-sur-votre-fiche-google",
    titre: "Ajouter votre lien de commande à votre fiche Google",
    chapo: "Préparez votre page de commande, ajoutez le lien à votre fiche et vérifiez le parcours public. La méthode et les points à contrôler si le lien est refusé.",
    categorie: "Visibilité locale",
    reponseCourte: "Depuis une fiche validée, ouvrez les options de commande, ajoutez votre lien et choisissez votre préférence de retrait ou livraison si disponible. Vérifiez ensuite le parcours public sur téléphone : l'affichage dépend des options de votre fiche et de Google.",
    publieLe: "2026-08-21",
    modifieLe: DATE_REVISION,
    motsCles: ["fiche Google restaurant", "lien de commande Google", "click and collect Google"],
    sections: [
      { id: "preparer", titre: "Préparer la fiche et la page de commande" },
      { id: "ajouter", titre: "Ajouter le lien et choisir votre préférence" },
      { id: "verifier", titre: "Tester ce que voit réellement votre client" },
      { id: "lien-absent", titre: "Si le lien est absent ou refusé" },
      { id: "entretenir", titre: "Entretenir le lien dans la durée" },
    ],
    sources: [
      source("Google — options de commande en ligne", "https://support.google.com/business/answer/10842217?hl=fr"),
      source("Google — liens des établissements locaux", "https://support.google.com/business/answer/6218037?hl=fr"),
      source("Google — règles des liens d'établissement", "https://support.google.com/business/answer/13769188?hl=fr"),
    ],
    lies: ["ouvrir-le-click-and-collect-sans-se-tromper", "visibilite-restaurant-google-site-internet", "pourquoi-les-prix-sont-plus-chers-sur-les-applis"],
    photo: { src: "/photos/libre/blog-telephone-main-nuit.webp", alt: "" },
    corps: corpsFicheGoogle,
  },
  {
    slug: "pourquoi-les-prix-sont-plus-chers-sur-les-applis",
    titre: "Pourquoi un même repas peut coûter plus cher sur une appli",
    chapo: "Prix des plats, frais client et coûts du restaurant : comparez les canaux de commande avec vos relevés, sans appliquer un taux de commission universel.",
    categorie: "Commande directe",
    reponseCourte: "Le total dépend des prix des plats, des promotions et des frais facturés au client. Pour le restaurant, comparez la contribution après les coûts de chaque canal, à service équivalent. Une commande directe conserve aussi des frais.",
    publieLe: "2026-08-21",
    modifieLe: DATE_REVISION,
    motsCles: ["commission plateforme livraison", "prix repas application", "coût commande directe restaurant"],
    sections: [
      { id: "decomposer", titre: "Décomposer le prix et les frais" },
      { id: "comparer", titre: "Comparer des commandes équivalentes" },
      { id: "exemple", titre: "Un exemple de comparaison, sans taux présenté comme universel" },
      { id: "direct", titre: "Ce que coûte aussi la commande directe" },
      { id: "decider", titre: "Choisir le rôle de chaque canal" },
      { id: "mesurer", titre: "Le relevé à préparer chaque mois" },
    ],
    sources: [source("Uber Eats France — tarification des menus et frais commerçant", "https://merchants.ubereats.com/fr/fr/resources/articles/menu-pricing/")],
    lies: ["ouvrir-le-click-and-collect-sans-se-tromper", "lien-de-commande-sur-votre-fiche-google", "refaire-menu-restaurant-papier-tv"],
    photo: { src: "/photos/libre/blog-burger-frites-fond-noir.webp", alt: "" },
    corps: corpsPrixApplis,
  },
  {
    slug: "ouvrir-le-click-and-collect-sans-se-tromper",
    titre: "Ouvrir le click & collect : préparer la carte, la cuisine et le retrait",
    chapo: "Capacité, produits, paiement, réception et retrait : préparez un premier service maîtrisable, puis élargissez à partir de ce que vous observez.",
    categorie: "Organisation du service",
    reponseCourte: "Ouvrez d'abord un service et une carte que votre équipe maîtrise. Vérifiez la capacité, la réception des commandes, le paiement et la remise au comptoir. Testez aussi les incidents, puis augmentez progressivement le périmètre.",
    publieLe: "2026-08-21",
    modifieLe: DATE_REVISION,
    motsCles: ["click and collect restaurant", "organisation retrait commande", "commande en ligne cuisine"],
    sections: [
      { id: "perimetre", titre: "Choisir un premier service maîtrisable" },
      { id: "capacite", titre: "Définir la capacité avec la cuisine" },
      { id: "carte", titre: "Préparer les informations avant la commande" },
      { id: "parcours-equipe", titre: "Organiser le trajet de la commande au comptoir" },
      { id: "paiement", titre: "Tester le règlement et les exceptions" },
      { id: "lancement", titre: "Lancer, observer, puis élargir" },
    ],
    sources: [source("DGCCRF — informations sur les denrées alimentaires", "https://www.economie.gouv.fr/dgccrf/les-fiches-pratiques/etiquetage-des-denrees-alimentaires-les-regles-connaitre")],
    lies: ["lien-de-commande-sur-votre-fiche-google", "pourquoi-les-prix-sont-plus-chers-sur-les-applis", "refaire-menu-restaurant-papier-tv"],
    photo: { src: "/photos/libre/blog-fenetre-service-nuit.webp", alt: "" },
    corps: corpsClickCollect,
  },
];

/** Estimation issue du texte JSX et des titres des briques éditoriales, sans appeler de composant client. */
function motsDe(node: ReactNode): number {
  if (typeof node === "string") return node.trim() === "" ? 0 : node.trim().split(/\s+/).length;
  if (typeof node === "number") return 1;
  if (Array.isArray(node)) return node.reduce<number>((total, enfant) => total + motsDe(enfant as ReactNode), 0);
  if (isValidElement(node)) {
    const props = node.props as { children?: ReactNode; titre?: string };
    return motsDe(props.children) + motsDe(props.titre);
  }
  return 0;
}

export const ARTICLES: readonly ArticlePublie[] = [...SOURCES]
  .sort((a, b) => b.publieLe.localeCompare(a.publieLe))
  .map((article) => {
    const mots = motsDe(article.corps());
    return { ...article, mots, minutes: Math.max(1, Math.round(mots / 200)) };
  });

export function articleParSlug(slug: string): ArticlePublie | undefined {
  return ARTICLES.find((article) => article.slug === slug);
}

/** Le maillage éditorial est choisi par sujet ; les autres guides complètent si nécessaire. */
export function autresArticles(slug: string): readonly ArticlePublie[] {
  const lies = articleParSlug(slug)?.lies ?? [];
  const prioritaires = lies.flatMap((lie) => {
    const article = articleParSlug(lie);
    return article && article.slug !== slug ? [article] : [];
  });
  return [...prioritaires, ...ARTICLES.filter((article) => article.slug !== slug && !lies.includes(article.slug))];
}

export const BLOG_PATH = "/blog";
export const cheminArticle = (slug: string): string => `${BLOG_PATH}/${slug}`;

const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"] as const;

/** Format stable entre Node et le navigateur, sans différences de ponctuation ICU. */
export function dateEnClair(iso: string): string {
  const [annee, mois, jour] = iso.split("-").map(Number);
  const nomDuMois = MOIS[mois - 1];
  if (!annee || !nomDuMois || !jour) throw new Error(`Date d'article illisible : ${iso}`);
  return `${jour === 1 ? "1er" : jour} ${nomDuMois} ${annee}`;
}
