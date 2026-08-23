/*
 * `react/no-unescaped-entities` est désactivée ici, et par fichier : la prose
 * d'un article est du texte JSX (gras, emphase et renvois au milieu des
 * phrases), là où tout le reste du dépôt affiche des CHAÎNES venues de
 * `content.ts`, que la règle ne voit pas. Le raisonnement complet est dans
 * `_articles/blocs.tsx`, en tête de fichier.
 */
/* eslint-disable react/no-unescaped-entities */
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Photo } from "@/components/marketing/Photo";
import { RevealObserver } from "@/components/marketing/RevealObserver";
import { SiteFooter } from "@/components/marketing/SiteFooter";
import { SiteHeader } from "@/components/marketing/SiteHeader";
import { CTA_CALLBACK, CTA_DEMO, ancre } from "@/components/marketing/content";
import { urlAbsolue } from "@/lib/site";
import { lireReseaux } from "@/lib/reseaux";
import {
  ARTICLES,
  BLOG_PATH,
  articleParSlug,
  autresArticles,
  cheminArticle,
  dateEnClair,
  type ArticlePublie,
} from "../_articles/registre";

/**
 * LA PAGE D'UN ARTICLE (`/blog/[slug]`).
 *
 * ═══ TROIS ROUTES, TOUTES CONNUES À LA COMPILATION ═══
 *
 * `generateStaticParams` les énumère depuis `ARTICLES`, et `dynamicParams` est
 * mis à `false` : un slug inconnu répond 404 sans jamais atteindre le rendu.
 * C'est le comportement voulu — un blog dont le contenu vit dans le dépôt n'a
 * aucune raison d'accepter une adresse qui n'existe pas, et une page d'erreur
 * franche vaut mieux qu'une page vide rendue à la demande.
 *
 * `notFound()` reste malgré tout : `dynamicParams: false` couvre la production,
 * pas l'appel direct au composant, et un `find()` qui rend `undefined` doit
 * casser franchement plutôt que déréférencer.
 *
 * ═══ CE QUE LA PAGE N'A PAS ═══
 *
 * Pas d'auteur nommé, pas de photo de rédaction, pas de compteur de partages,
 * pas de « lu 1 240 fois ». Nous n'avons qu'un restaurant pilote et deux
 * personnes : tout compteur affiché ici serait un chiffre que personne ne peut
 * vérifier, sur les pages mêmes qui existent pour établir qu'on dit vrai.
 * L'auteur des données structurées est l'ORGANISATION, ce qui est exact.
 */

export const dynamicParams = false;

export function generateStaticParams() {
  return ARTICLES.map((article) => ({ slug: article.slug }));
}

/**
 * `params` est une PROMESSE depuis Next 15 — l'oublier compile (le type se
 * résout en `any` sur un `await` inutile) mais rend un objet là où on attend une
 * chaîne. On l'attend donc explicitement, ici comme dans le composant.
 */
type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const article = articleParSlug(slug);
  if (!article) return {};

  const chemin = cheminArticle(article.slug);

  return {
    title: `${article.titre} — Snack Manager`,
    description: article.chapo,
    keywords: [...article.motsCles],
    alternates: { canonical: chemin },
    openGraph: {
      // `article` et non `website` : c'est ce type qui autorise `publishedTime`,
      // et c'est lui que lisent les aperçus des messageries.
      type: "article",
      locale: "fr_FR",
      url: chemin,
      siteName: "Snack Manager",
      title: article.titre,
      description: article.chapo,
      publishedTime: article.publieLe,
    },
    twitter: { card: "summary_large_image", title: article.titre, description: article.chapo },
    robots: { index: true, follow: true },
  };
}

export default async function ArticlePage({ params }: Props) {
  // Les réseaux sont lus ICI plutôt que dans le pied de page : `SiteFooter`
  // est un îlot client. Si l'API ne répond pas, `lireReseaux` rend une liste
  // vide et la rangée disparaît — la page, elle, s'affiche.
  const reseaux = await lireReseaux();

  const { slug } = await params;
  const article = articleParSlug(slug);
  if (!article) notFound();

  const autres = autresArticles(article.slug);

  return (
    <>
      {/*
       * Ancre nue LÉGITIME : elle vise un élément de cette page-ci. Les liens
       * vers la landing, eux, passent tous par `ancre()` — voir `Renvoi` dans
       * `_articles/blocs.tsx`, qui rend la faute impossible à commettre.
       */}
      <a href="#article" className="mk-skip">
        Aller au contenu
      </a>

      <SiteHeader />

      <main id="top">
        <article className="section bl-article" id="article">
          {/*
           * ═══ L'EN-TÊTE EST UN PANNEAU PHOTOGRAPHIQUE, PAS UN BANDEAU ═══
           *
           * La photo est POSÉE DERRIÈRE le bloc de titre, pas au-dessus de lui.
           * Un bandeau de 720 × 360 ajouté sous le titre aurait coûté 360 px à
           * une page qui en fait déjà 5 947 ; le fond, lui, occupe une place qui
           * existait — les 321 px du bloc de titre. Le solde mesuré tient dans
           * les marges internes du panneau, et la section les rend en réduisant
           * d'autant sa marge haute : le panneau porte sa propre masse, 90 px de
           * noir au-dessus de lui n'avaient plus de raison d'être.
           *
           * Trois couches, dans l'ordre des bandes de `/offres` : la photo, le
           * voile, le texte. La photo est DÉCORATIVE — le chapô dit le sujet
           * deux lignes plus bas, et le faire dire une deuxième fois par une
           * image allongerait le trajet vers le texte.
           */}
          <header className="bl-head rv">
            <span className="bl-headmedia">
              <Photo shot={article.photo} decorative eager sizes="(max-width: 809.98px) 100vw, 720px" />
            </span>
            {/*
             * VOILE MESURÉ SUR LE PIRE PIXEL DU CADRAGE RÉEL, jamais sur la
             * moyenne : on rend la photo dans son cadrage `cover` (720 × 386 au
             * bureau, 350 × 424 au téléphone), on applique l'alpha canal par
             * canal, et on prend le pixel le plus clair du cadre.
             *
             * Il est à 70 % et non à 84 %, et le chiffre a été RÉVISÉ À LA
             * MESURE : à 84 % le contraste passait partout et la photo ne se
             * voyait plus du tout — ces trois scènes sont nocturnes, leur
             * médiane est quasi noire, et seuls leurs points chauds portent
             * l'image. À 70 %, le pire pixel vaut 71 en sRGB : le titre blanc de
             * 44 px conserve 9,25:1 et le chapô 5,52:1, au-dessus des 4,5:1
             * exigés en AA. Le détail du calcul est dans `marketing.css`, sur
             * `.bl-headveil`.
             */}
            <span className="bl-headveil" aria-hidden="true" />

            <Link className="ui-link bl-retour" href={BLOG_PATH}>
              <span aria-hidden="true">← </span>
              Le blog
            </Link>
            <p className="bl-meta">
              <time dateTime={article.publieLe}>{dateEnClair(article.publieLe)}</time>
              <span aria-hidden="true"> · </span>
              <span>{article.minutes} min de lecture</span>
            </p>
            <h1 className="bl-titre">{article.titre}</h1>
            <p className="bl-chapo">{article.chapo}</p>
          </header>

          <div className="bl-corps rv">{article.corps()}</div>

          {/*
           * LE PIED D'ARTICLE — un renvoi, pas un deuxième site.
           *
           * Ni formulaire, ni grille de prix, ni comparatif : tout cela vit sur
           * la landing, et le dupliquer ici garantirait qu'un jour les deux se
           * contredisent. Les deux libellés viennent de `content.ts` pour la
           * même raison — la page en portait six pour deux destinations.
           */}
          <aside className="bl-outro rv">
            <p className="bl-outrotitre">Plus de commandes. Moins de galère. Zéro commission.</p>
            <p className="bl-outroline">
              Caisse, cuisine, commande en ligne et back-office, réunis. Les quatre applications sont manipulables sur la
              page d'accueil, sans compte et sans rendez-vous.
            </p>
            <div className="bl-outroctas">
              <Link className="btn light" href={ancre("produit").href}>
                {CTA_DEMO}
              </Link>
              <Link className="btn dark" href={ancre("contact").href}>
                {CTA_CALLBACK}
              </Link>
            </div>
          </aside>

          {autres.length > 0 ? (
            <nav className="bl-autres rv" aria-label="Autres articles">
              <h2 className="bl-autrestitre">À lire aussi</h2>
              <ul className="bl-autreslist">
                {autres.map((autre) => (
                  <li className="bl-autre spot" key={autre.slug}>
                    <Link className="bl-cardlink" href={cheminArticle(autre.slug)}>
                      <p className="bl-meta">{autre.minutes} min de lecture</p>
                      <p className="bl-autretitre">{autre.titre}</p>
                      <span className="bl-cardcta">
                        Lire l'article
                        <span aria-hidden="true"> →</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ) : null}
        </article>
      </main>

      <SiteFooter reseaux={reseaux} />
      <RevealObserver />

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(donneesStructurees(article)) }}
      />
    </>
  );
}

/**
 * `BlogPosting` + le fil d'Ariane.
 *
 * `dateModified` vaut `datePublished` tant qu'un article n'a pas été repris :
 * annoncer une date de modification qu'on ne suit pas serait fabriquer de la
 * fraîcheur, et c'est précisément ce que les moteurs finissent par sanctionner.
 * Le jour où un article est révisé, le champ méritera sa propre clé dans
 * `Article` — pas une date calculée à la volée.
 *
 * L'auteur est l'ORGANISATION. Nous sommes deux, aucune signature personnelle
 * n'apporterait de garantie vérifiable, et une signature inventée en enlèverait.
 */
function donneesStructurees(article: ArticlePublie) {
  const url = urlAbsolue(cheminArticle(article.slug));

  return [
    {
      "@context": "https://schema.org",
      "@type": "BlogPosting",
      "@id": url,
      mainEntityOfPage: { "@type": "WebPage", "@id": url },
      url,
      headline: article.titre,
      description: article.chapo,
      datePublished: article.publieLe,
      dateModified: article.publieLe,
      inLanguage: "fr-FR",
      keywords: [...article.motsCles],
      wordCount: article.mots,
      isPartOf: { "@type": "Blog", "@id": urlAbsolue(BLOG_PATH), name: "Le blog de Snack Manager" },
      author: { "@type": "Organization", name: "Snack Manager", url: urlAbsolue("/") },
      publisher: { "@type": "Organization", name: "Snack Manager", url: urlAbsolue("/") },
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Accueil", item: urlAbsolue("/") },
        { "@type": "ListItem", position: 2, name: "Blog", item: urlAbsolue(BLOG_PATH) },
        { "@type": "ListItem", position: 3, name: article.titre, item: url },
      ],
    },
  ];
}
