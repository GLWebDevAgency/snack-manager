import type { MetadataRoute } from "next";
import { ARTICLES, BLOG_PATH, cheminArticle } from "@/app/(marketing)/blog/_articles/registre";
import { urlAbsolue } from "@/lib/site";

/**
 * LE PLAN DU SITE — `/sitemap.xml`.
 *
 * ═══ POURQUOI IL ARRIVE MAINTENANT, ET PAS AVANT ═══
 *
 * Tant que la vitrine tenait sur une seule URL, un plan de site n'apprenait
 * rien à personne : `/` se découvre sans aide. La refonte a sorti `/offres` et
 * `/blog` de la landing pour rendre les ~1 200 mots de surface de référencement
 * que le passage de dix-sept à onze sections avait coûtés — et un blog écrit
 * POUR le référencement dont les articles ne se découvrent qu'au hasard des
 * liens internes, c'est le travail fait et l'effet jeté.
 *
 * ═══ IL SE GÉNÈRE, IL NE SE TIENT PAS À JOUR ═══
 *
 * Rien n'est listé à la main ici. `ARTICLES` (le registre du blog) est déjà la
 * table qui décide de ce qui existe : la page de liste, la génération statique
 * des routes et ce fichier en descendent tous les trois. Un article ajouté au
 * registre entre dans le plan de site le jour même ; un article retiré en sort.
 * Une liste recopiée, elle, aurait annoncé à Google des adresses en 404 — la
 * variante référencement de la faute que `PRICE_RANGE` a corrigée sur les prix.
 *
 * ═══ CE QUI N'Y EST PAS, ET C'EST VOULU ═══
 *
 * Le plan ne porte QUE la vitrine publique. `/admin`, `/sm`, `/board`, `/t/[id]`
 * et `/embed/[slug]` sont des surfaces d'exploitation ou de suivi de commande :
 * elles n'ont rien à faire dans un index de moteur, et `app/robots.ts` les
 * refuse explicitement. `/r/[slug]` — la vitrine d'un restaurant client — n'y
 * est pas non plus : elle est servie sous le domaine du restaurateur (voir
 * `src/proxy.ts`), c'est donc à SON plan de site de la porter, pas au nôtre.
 *
 * ═══ LES DATES ═══
 *
 * `lastModified` des articles vient de leur date de publication réelle
 * (`publieLe`). Les trois pages de vitrine n'ont pas de date de révision
 * suivie : leur donner `new Date()` reviendrait à jurer à chaque déploiement
 * qu'elles ont changé — un signal qu'un moteur finit par cesser de croire. On
 * ne déclare donc pas ce qu'on ne sait pas.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  /**
   * L'article le plus récent date le blog. Les trois sont sortis le même jour
   * aujourd'hui, mais `ARTICLES` est trié du plus récent au plus ancien : la
   * ligne suivante restera juste quand le quatrième arrivera.
   */
  const dernierArticle = ARTICLES[0]?.publieLe;

  return [
    {
      url: urlAbsolue("/"),
      changeFrequency: "monthly",
      // La landing est la page qu'on veut voir remonter en premier : c'est elle
      // qui porte le formulaire de rappel, seul point de conversion du site.
      priority: 1,
    },
    {
      url: urlAbsolue("/offres"),
      changeFrequency: "monthly",
      // Juste derrière la landing : « tarif logiciel caisse snack » est une
      // recherche d'acheteur, et c'est cette page-là qui y répond en entier.
      priority: 0.9,
    },
    // Les pages de la plateforme et l'Atelier : chacune répond à une recherche
    // d'acheteur précise (« logiciel caisse snack », « écran cuisine », « site
    // internet restaurant »…). Absentes du plan, elles ne vivaient que des
    // liens du menu — le travail de référencement fait, et l'effet jeté.
    ...["/caisse", "/cuisine", "/commande-en-ligne", "/atelier"].map((chemin) => ({
      url: urlAbsolue(chemin),
      changeFrequency: "monthly" as const,
      priority: 0.8,
    })),
    {
      url: urlAbsolue(BLOG_PATH),
      lastModified: dernierArticle,
      // L'index n'est qu'un sommaire ; ce sont les articles qui répondent aux
      // recherches. Le mettre au même rang qu'eux les concurrencerait.
      changeFrequency: "monthly",
      priority: 0.6,
    },
    ...ARTICLES.map((article) => ({
      url: urlAbsolue(cheminArticle(article.slug)),
      lastModified: article.publieLe,
      // Un article publié ne bouge plus, sauf relecture. « yearly » dit la
      // vérité et laisse le moteur dépenser son budget d'exploration ailleurs.
      changeFrequency: "yearly" as const,
      priority: 0.7,
    })),
  ];
}
