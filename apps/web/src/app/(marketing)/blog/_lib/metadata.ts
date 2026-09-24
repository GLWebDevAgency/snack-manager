import { urlAbsolue } from "@/lib/site";
import { ARTICLES, BLOG_PATH, cheminArticle, type ArticlePublie } from "../_articles/registre";
export const REDACTION_PATH = "/blog/la-redaction";
const auteur = { "@type": "Organization", name: "Équipe Snack Manager", url: urlAbsolue(REDACTION_PATH) };
const editeur = { "@type": "Organization", name: "Snack Manager", url: urlAbsolue("/") };
/** Escape '<' so editorial strings cannot terminate the JSON-LD script. */
export function jsonLd(value: unknown): string { return JSON.stringify(value).replace(/</g, "\\u003c"); }
export function articleSchema(article: ArticlePublie) {
  const url = urlAbsolue(cheminArticle(article.slug));
  return {
    "@context": "https://schema.org", "@type": "BlogPosting", "@id": `${url}#article`,
    mainEntityOfPage: { "@type": "WebPage", "@id": url }, url,
    headline: article.titre, description: article.chapo,
    image: urlAbsolue(`${cheminArticle(article.slug)}/partage`),
    datePublished: article.publieLe, dateModified: article.modifieLe ?? article.publieLe,
    inLanguage: "fr-FR", articleSection: article.categorie,
    isPartOf: { "@type": "Blog", "@id": urlAbsolue(BLOG_PATH), name: "Le carnet des restaurateurs" },
    author: auteur, publisher: editeur, citation: article.sources.map((source) => source.url),
  };
}
export function breadcrumbs(article: ArticlePublie) {
  return {
    "@context": "https://schema.org", "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Accueil", item: urlAbsolue("/") },
      { "@type": "ListItem", position: 2, name: "Le carnet", item: urlAbsolue(BLOG_PATH) },
      { "@type": "ListItem", position: 3, name: article.titre, item: urlAbsolue(cheminArticle(article.slug)) },
    ],
  };
}
export function blogSchema(description: string) {
  return {
    "@context": "https://schema.org", "@type": "Blog", "@id": urlAbsolue(BLOG_PATH),
    url: urlAbsolue(BLOG_PATH), name: "Le carnet des restaurateurs", description, inLanguage: "fr-FR",
    publisher: editeur, blogPost: ARTICLES.map(articleSchema),
  };
}
