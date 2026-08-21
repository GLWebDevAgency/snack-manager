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
import { Photo } from "@/components/marketing/Photo";
import { RevealObserver } from "@/components/marketing/RevealObserver";
import { SiteFooter } from "@/components/marketing/SiteFooter";
import { SiteHeader } from "@/components/marketing/SiteHeader";
import { CTA_CALLBACK, CTA_DEMO, ancre } from "@/components/marketing/content";
import { urlAbsolue } from "@/lib/site";
import { ARTICLES, BLOG_PATH, cheminArticle, dateEnClair } from "./_articles/registre";
import { lireReseaux } from "@/lib/reseaux";

/**
 * L'INDEX DU BLOG (`/blog`).
 *
 * ═══ POURQUOI CETTE PAGE EXISTE ═══
 *
 * La refonte a ramené la vitrine de dix-sept sections à onze : environ 1 200
 * mots de surface de référencement en moins. Le blog les rend — mais en
 * répondant à des recherches RÉELLES au lieu de répéter la vitrine. Un article
 * qui reformule la page d'accueil ne se lit pas, ne se partage pas, et ne
 * remonte pas non plus : c'est du poids mort qui coûte une page à maintenir.
 *
 * D'où trois articles seulement, et trois sujets sur lesquels nous avons quelque
 * chose de vrai à dire — une procédure vérifiée dans l'aide de Google, une
 * mécanique de tarif expliquée sans faire le procès de personne, et des réglages
 * de service qu'on ne trouve nulle part parce qu'ils ne s'apprennent qu'en
 * cuisine.
 *
 * ═══ L'EN-TÊTE ET LE PIED SONT CEUX DE LA LANDING ═══
 *
 * `SiteHeader` et `SiteFooter` sont rendus ici tels quels : le blog n'est pas un
 * sous-site, c'est une route de plus. Tous leurs liens sont déjà absolus
 * (`ancre()`, content.ts), donc ils fonctionnent depuis `/blog` comme depuis
 * `/`. `RevealObserver` accompagne les classes `.rv` — sans lui, tout ce qui en
 * porte une resterait invisible.
 */

const TITRE = "Le blog — Snack Manager";
const CHAPO =
  "Ce qu'on a appris en faisant tourner un snack : la fiche Google, le coût réel des plateformes, et les réglages qui font tenir un service de click and collect.";

export const metadata: Metadata = {
  title: TITRE,
  description: CHAPO,
  alternates: { canonical: BLOG_PATH },
  openGraph: {
    type: "website",
    locale: "fr_FR",
    url: BLOG_PATH,
    siteName: "Snack Manager",
    title: TITRE,
    description: CHAPO,
  },
  robots: { index: true, follow: true },
};

export default async function BlogIndexPage() {
  // Les réseaux sont lus ICI plutôt que dans le pied de page : `SiteFooter`
  // est un îlot client. Si l'API ne répond pas, `lireReseaux` rend une liste
  // vide et la rangée disparaît — la page, elle, s'affiche.
  const reseaux = await lireReseaux();

  return (
    <>
      {/*
       * La seule ancre nue légitime d'une page de blog : elle vise un élément
       * de CETTE page. Depuis `/blog`, `#articles` résout en `/blog#articles`,
       * ce qui est exactement la cible voulue. Tout lien vers une section de la
       * landing, lui, passe par `ancre()` — sans quoi il résoudrait contre
       * `/blog` et ne ferait rien du tout, silencieusement.
       */}
      <a href="#articles" className="mk-skip">
        Aller au contenu
      </a>

      <SiteHeader />

      <main id="top">
        <section className="section bl-index" id="articles">
          <div className="section-head rv">
            <span className="badge">Le blog</span>
            <h1 className="h2">Ce qu'on a appris derrière un comptoir</h1>
            <p className="subheading">{CHAPO}</p>
          </div>

          <ul className="bl-cards rv">
            {ARTICLES.map((article) => (
              <li className="bl-card spot" key={article.slug}>
                <Link className="bl-cardlink" href={cheminArticle(article.slug)}>
                  {/*
                   * LA VIGNETTE OCCUPE LA HAUTEUR DE LA CARTE, ELLE N'EN AJOUTE
                   * PAS. Elle prend une colonne à gauche et s'étire sur la
                   * hauteur que le texte fixe déjà : c'est la seule forme qui
                   * distingue les trois cartes d'un coup d'œil sans allonger un
                   * index qui ne mesure que 1 932 px. Un bandeau en tête de
                   * carte aurait coûté trois fois 390 px, soit un cinquième de
                   * page pour un besoin que le brief classe lui-même dernier.
                   *
                   * Décorative : le titre et le chapô sont juste à côté, dans le
                   * même lien. Une image annoncée ici ferait entendre deux fois
                   * le même article à qui navigue au lecteur d'écran.
                   */}
                  <span className="bl-cardmedia">
                    <Photo shot={article.photo} decorative sizes="214px" />
                    {/* Le raccord du bord droit sur le fond de la carte : sans
                        lui, la vignette s'arrête sur une arête verticale nette
                        contre le texte. Même procédé que `.of-mediafeather`. */}
                    <span className="bl-cardfeather" aria-hidden="true" />
                  </span>

                  <div className="bl-cardbody">
                    <p className="bl-meta">
                      <time dateTime={article.publieLe}>{dateEnClair(article.publieLe)}</time>
                      <span aria-hidden="true"> · </span>
                      <span>{article.minutes} min de lecture</span>
                    </p>
                    <h2 className="bl-cardtitre">{article.titre}</h2>
                    <p className="bl-cardchapo">{article.chapo}</p>
                    <span className="bl-cardcta">
                      Lire l'article
                      <span aria-hidden="true"> →</span>
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>

          {/*
           * LE SEUL APPEL À L'ACTION DE LA PAGE, ET IL RENVOIE À LA LANDING.
           *
           * Le blog ne convertit pas, il attire. Y recopier un formulaire, une
           * grille de prix ou un comparatif, ce serait rouvrir la vitrine à un
           * deuxième endroit — c'est-à-dire garantir qu'un jour les deux se
           * contrediront. On renvoie donc, et par `ancre()`, jamais par une
           * ancre nue qui résoudrait contre `/blog`.
           */}
          <aside className="bl-outro rv">
            <p className="bl-outrotitre">Vous voulez voir le produit plutôt que d'en lire ?</p>
            <p className="bl-outroline">
              Les quatre applications sont manipulables sur la page d'accueil, sans compte et sans rendez-vous.
            </p>
            <div className="bl-outroctas">
              {/* Les libellés viennent de content.ts : la page en portait six pour deux destinations. */}
              <Link className="btn light" href={ancre("produit").href}>
                {CTA_DEMO}
              </Link>
              <Link className="btn dark" href={ancre("contact").href}>
                {CTA_CALLBACK}
              </Link>
            </div>
          </aside>
        </section>
      </main>

      <SiteFooter reseaux={reseaux} />
      <RevealObserver />

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(donneesStructurees()) }}
      />
    </>
  );
}

/**
 * `Blog` + la liste de ses billets.
 *
 * `blogPost` porte les mêmes champs que la page d'article publie de son côté :
 * un moteur qui lit l'index sait déjà quoi trouver au bout de chaque lien, et
 * les deux ne peuvent pas diverger puisque les deux lisent `ARTICLES`.
 */
function donneesStructurees() {
  return {
    "@context": "https://schema.org",
    "@type": "Blog",
    "@id": urlAbsolue(BLOG_PATH),
    name: "Le blog de Snack Manager",
    description: CHAPO,
    inLanguage: "fr-FR",
    publisher: { "@type": "Organization", name: "Snack Manager", url: urlAbsolue("/") },
    blogPost: ARTICLES.map((article) => ({
      "@type": "BlogPosting",
      "@id": urlAbsolue(cheminArticle(article.slug)),
      url: urlAbsolue(cheminArticle(article.slug)),
      headline: article.titre,
      description: article.chapo,
      datePublished: article.publieLe,
      inLanguage: "fr-FR",
      author: { "@type": "Organization", name: "Snack Manager" },
    })),
  };
}
