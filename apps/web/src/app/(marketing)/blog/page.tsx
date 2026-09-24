import type { Metadata } from "next";
import Link from "next/link";
import { Photo } from "@/components/marketing/Photo";
import { SiteFooter } from "@/components/marketing/SiteFooter";
import { SiteHeader } from "@/components/marketing/SiteHeader";
import { lireReseaux } from "@/lib/reseaux";
import { ARTICLES, BLOG_PATH, cheminArticle, dateEnClair } from "./_articles/registre";
import { BlogCta } from "./_components/BlogCta";
import { blogSchema, jsonLd } from "./_lib/metadata";
import styles from "./blog.module.css";

const TITRE = "Guides restaurateurs : menus, visibilité et commande directe";
const DESCRIPTION = "Des guides pratiques pour refaire votre menu, améliorer votre visibilité sur Google, comparer vos coûts et organiser la commande directe de votre restaurant.";
export const metadata: Metadata = {
  title: `${TITRE} — Snack Manager`, description: DESCRIPTION,
  alternates: { canonical: BLOG_PATH },
  openGraph: { type: "website", locale: "fr_FR", url: BLOG_PATH, siteName: "Snack Manager", title: TITRE, description: DESCRIPTION, images: [{ url: "/blog/partage", width: 1200, height: 630, alt: "Le carnet des restaurateurs — Snack Manager" }] },
  twitter: { card: "summary_large_image", title: TITRE, description: DESCRIPTION, images: ["/blog/partage"] },
  robots: { index: true, follow: true },
};
export default async function BlogIndexPage() {
  const reseaux = await lireReseaux();
  const vedette = ARTICLES.find((a) => a.categorie === "Menus papier & TV") ?? ARTICLES[0];
  const categories = [...new Set(ARTICLES.map((a) => a.categorie))];
  return <>
    <a href="#guides" className="mk-skip">Aller aux guides</a>
    <SiteHeader />
    <main id="top" className={styles.page}>
      <header className={styles.indexHead}>
        <p className={styles.eyebrow}><span aria-hidden="true" /> Le carnet des restaurateurs</p>
        <h1 className={styles.indexTitle}>Votre restaurant.<br /><em>Des réponses concrètes.</em></h1>
        <div className={styles.introRow}>
          <p>Une carte à refaire. Une fiche Google à améliorer. Des commandes à mieux organiser. Des guides pour prendre la prochaine décision, simplement.</p>
          <Link href="/blog/la-redaction" className={styles.textLink}>Comment nous préparons nos guides <span aria-hidden="true">↗</span></Link>
        </div>
      </header>
      {vedette && <section aria-label="Le guide à découvrir" className={styles.feature}>
        <div className={styles.featureCopy}>
          <p className={styles.eyebrow}>À la une <span aria-hidden="true">/</span> {vedette.categorie}</p>
          <h2><Link href={cheminArticle(vedette.slug)}>{vedette.titre}</Link></h2>
          <p>{vedette.chapo}</p>
          <Link className={styles.readLink} href={cheminArticle(vedette.slug)}>Lire le guide <span aria-hidden="true">↗</span></Link>
          <p className={styles.meta}>{vedette.minutes} min de lecture · {dateEnClair(vedette.modifieLe ?? vedette.publieLe)}</p>
        </div>
        <div className={styles.featureVisual} aria-hidden="true">
          <div className={styles.paperBack} />
          <div className={styles.paperFront}>
            <span className={styles.paperLabel}>LA CARTE</span>
            <Photo shot={vedette.photo} decorative eager sizes="400px" />
            <span className={styles.paperLine} /><span className={styles.paperLineShort} />
            <span className={styles.paperCaption}>Pensée pour être choisie.</span>
          </div>
          <span className={styles.visualCaption}>Papier · Écran · Même identité</span>
        </div>
      </section>}
      <section id="guides" className={styles.library} aria-labelledby="guides-titre">
        <div className={styles.libraryHead}><h2 id="guides-titre">De quoi avez-vous besoin ?</h2><span>{ARTICLES.length} guides pratiques</span></div>
        <nav className={styles.topics} aria-label="Thèmes du carnet">
          {categories.map((categorie, i) => <a key={categorie} href={`#theme-${i}`}>{categorie} <span aria-hidden="true">↘</span></a>)}
        </nav>
        {categories.map((categorie, i) => <section key={categorie} id={`theme-${i}`} className={styles.category} aria-labelledby={`titre-theme-${i}`}>
          <div className={styles.categoryLabel}><span aria-hidden="true">{String(i + 1).padStart(2, "0")}</span><h3 id={`titre-theme-${i}`}>{categorie}</h3></div>
          <ul className={styles.articleList}>{ARTICLES.filter((a) => a.categorie === categorie).map((article) => <li key={article.slug}>
            <Link className={styles.articleCard} href={cheminArticle(article.slug)}>
              <div className={styles.cardImage}><Photo shot={article.photo} decorative sizes="180px" /></div>
              <div className={styles.cardBody}>
                <p className={styles.meta}>{article.minutes} min de lecture</p><h4>{article.titre}</h4><p>{article.chapo}</p>
                <span className={styles.cardArrow}>Lire le guide <span aria-hidden="true">↗</span></span>
              </div>
            </Link>
          </li>)}</ul>
        </section>)}
      </section>
      <BlogCta />
    </main>
    <SiteFooter reseaux={reseaux} />
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(blogSchema(DESCRIPTION)) }} />
  </>;
}
