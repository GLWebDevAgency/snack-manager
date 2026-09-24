import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteFooter } from "@/components/marketing/SiteFooter";
import { SiteHeader } from "@/components/marketing/SiteHeader";
import { lireReseaux } from "@/lib/reseaux";
import { urlAbsolue } from "@/lib/site";
import { ARTICLES, articleParSlug, cheminArticle, dateEnClair } from "../_articles/registre";
import { BlogCta } from "../_components/BlogCta";
import { articleSchema, breadcrumbs, jsonLd, REDACTION_PATH } from "../_lib/metadata";
import styles from "../blog.module.css";
export const dynamicParams = false;
export function generateStaticParams() { return ARTICLES.map(({ slug }) => ({ slug })); }
type Props = { params: Promise<{ slug: string }> };
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const article = articleParSlug((await params).slug);
  if (!article) return {};
  const chemin = cheminArticle(article.slug);
  return {
    title: `${article.titre} — Snack Manager`, description: article.chapo,
    alternates: { canonical: chemin },
    openGraph: {
      type: "article", locale: "fr_FR", url: chemin, siteName: "Snack Manager",
      title: article.titre, description: article.chapo, publishedTime: article.publieLe,
      modifiedTime: article.modifieLe ?? article.publieLe, authors: [urlAbsolue(REDACTION_PATH)],
      images: [{ url: `${chemin}/partage`, width: 1200, height: 630, alt: article.titre }],
    },
    twitter: { card: "summary_large_image", title: article.titre, description: article.chapo, images: [`${chemin}/partage`] },
    robots: { index: true, follow: true },
  };
}
export default async function ArticlePage({ params }: Props) {
  const article = articleParSlug((await params).slug);
  if (!article) notFound();
  const reseaux = await lireReseaux();
  const autres = article.lies.map(articleParSlug).filter((a) => a !== undefined);
  const atelier = article.categorie === "Menus papier & TV" || article.categorie === "Visibilité locale";
  return <>
    <a href="#article" className="mk-skip">Aller au guide</a><SiteHeader />
    <main id="top" className={styles.page}>
      <nav aria-label="Fil d’Ariane" className={styles.breadcrumb}><Link href="/">Accueil</Link><span aria-hidden="true">/</span><Link href="/blog">Le carnet</Link><span aria-hidden="true">/</span><span aria-current="page">{article.categorie}</span></nav>
      <article id="article">
        <header className={styles.articleHead}>
          <p className={styles.eyebrow}>{article.categorie} <span aria-hidden="true">/</span> Guide pratique</p>
          <h1>{article.titre}</h1><p className={styles.chapo}>{article.chapo}</p>
          <div className={styles.byline}><Link href={REDACTION_PATH}>Équipe Snack Manager</Link><span aria-hidden="true">·</span><span>{article.minutes} min de lecture</span><span aria-hidden="true">·</span><span>{article.modifieLe ? "Mis à jour" : "Publié"} le <time dateTime={article.modifieLe ?? article.publieLe}>{dateEnClair(article.modifieLe ?? article.publieLe)}</time></span></div>
        </header>
        <div className={styles.readingGrid}>
          <aside className={styles.sidebar}>
            <nav aria-label="Sommaire du guide" className={styles.toc}><p>Dans ce guide</p><ol>{article.sections.map((section, i) => <li key={section.id}><a href={`#${section.id}`}><span aria-hidden="true">{String(i + 1).padStart(2, "0")}</span>{section.titre}</a></li>)}</ol></nav>
            <Link className={styles.sidebarLink} href={atelier ? "/atelier" : "/commande-en-ligne"}>{atelier ? "Du guide à votre projet" : "Découvrir la commande directe"} <span aria-hidden="true">↗</span></Link>
          </aside>
          <div className={styles.readingColumn}>
            <div className={styles.answer}><p className={styles.eyebrow}>L’essentiel pour commencer</p><p>{article.reponseCourte}</p></div>
            <div className={`bl-corps ${styles.body}`}>{article.corps()}</div>
            {article.sources.length > 0 && <section className={styles.sources} aria-labelledby="sources-titre"><h2 id="sources-titre">Sources et vérification</h2><p>Les interfaces et les conditions des services cités peuvent évoluer. Les liens ci-dessous permettent de vérifier les informations à leur source.</p><ul>{article.sources.map((source) => <li key={source.url}><a href={source.url}>{source.titre} <span aria-hidden="true">↗</span></a><span>Consulté le {dateEnClair(source.consulteLe)}</span></li>)}</ul></section>}
            <div className={styles.signature}><strong>Préparé par l’équipe Snack Manager</strong><p>Nous concevons des outils et un accompagnement pour les restaurateurs. Ce guide distingue les procédures documentées, les exemples et nos recommandations.</p><Link href={REDACTION_PATH}>Notre méthode éditoriale <span aria-hidden="true">→</span></Link><p className={styles.meta}>Première publication : <time dateTime={article.publieLe}>{dateEnClair(article.publieLe)}</time>.</p></div>
          </div>
        </div>
      </article>
      <BlogCta atelier={atelier} />
      {autres.length > 0 && <nav className={styles.related} aria-label="Guides complémentaires"><h2>Pour aller plus loin</h2><ul>{autres.map((autre) => <li key={autre.slug}><Link href={cheminArticle(autre.slug)}><span className={styles.eyebrow}>{autre.categorie}</span><h3>{autre.titre}</h3><span className={styles.meta}>{autre.minutes} min de lecture <span aria-hidden="true">↗</span></span></Link></li>)}</ul></nav>}
    </main>
    <SiteFooter reseaux={reseaux} />
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd([articleSchema(article), breadcrumbs(article)]) }} />
  </>;
}
