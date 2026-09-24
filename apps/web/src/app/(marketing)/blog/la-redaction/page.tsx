import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/marketing/SiteHeader";
import { SiteFooter } from "@/components/marketing/SiteFooter";
import { lireReseaux } from "@/lib/reseaux";
import { urlAbsolue } from "@/lib/site";
import { jsonLd, REDACTION_PATH } from "../_lib/metadata";
import styles from "../blog.module.css";

export const metadata: Metadata = {
  title: "L’équipe et la méthode du carnet — Snack Manager",
  description: "Qui prépare les guides Snack Manager, comment nous vérifions les sources et comment nous distinguons exemples, recommandations et services proposés.",
  alternates: { canonical: REDACTION_PATH },
  openGraph: { title: "L’équipe et la méthode du carnet", url: REDACTION_PATH, type: "website", images: [{ url: "/blog/partage", width: 1200, height: 630, alt: "Le carnet des restaurateurs — Snack Manager" }] },
  twitter: { card: "summary_large_image", images: ["/blog/partage"] },
};

export default async function RedactionPage() {
  const reseaux = await lireReseaux();
  return <>
    <a href="#methode" className="mk-skip">Aller au contenu</a><SiteHeader />
    <main className={styles.page} id="top"><div className={styles.method} id="methode">
      <p className={styles.eyebrow}>Le carnet des restaurateurs</p>
      <h1>Des conseils utiles.<br />Une méthode transparente.</h1>
      <p>Ce carnet est préparé par l’équipe Snack Manager. Nous concevons des logiciels pour la restauration et proposons un accompagnement pour les menus papier et TV, les sites internet et la visibilité des restaurants.</p>
      <p>Nos guides répondent aux questions qui précèdent un projet : quoi préparer, quels coûts distinguer, quels réglages vérifier et quelles limites connaître. Ils s’adressent aux restaurateurs, quelle que soit leur spécialité.</p>
      <h2>Comment nous préparons un guide</h2>
      <ul><li><strong>Des sources identifiables.</strong> Pour une procédure Google ou les conditions d’un service, nous renvoyons à la documentation de son éditeur, avec une date de consultation.</li>
        <li><strong>Des exemples clairement nommés.</strong> Un budget simulé ou une organisation proposée est un exemple de travail, jamais un résultat client présenté comme réel.</li>
        <li><strong>Des mises à jour motivées.</strong> La date de révision change lorsque le contenu est réellement revu. Les interfaces et les offres tierces peuvent évoluer entre deux vérifications.</li>
        <li><strong>Un périmètre explicite.</strong> Nous distinguons conseil, logiciel, conception graphique, impression et diffusion. Les prestations incluses et les options se vérifient dans les offres et le devis.</li></ul>
      <h2>Notre lien avec les sujets traités</h2>
      <p>Snack Manager commercialise des services en rapport avec ces guides. Les liens vers nos solutions sont donc des liens commerciaux identifiables. Vous pouvez appliquer les conseils avec vos outils actuels ; nos services de communication sont accessibles avec ou sans nos logiciels.</p>
      <p><Link href="/offres">Voir les offres</Link> · <Link href="/atelier">Découvrir l’Atelier</Link></p>
      <h2>Une information à corriger ?</h2>
      <p>Une interface a changé ou un passage manque de précision ? <Link href="/#contact">Signalez-le depuis notre formulaire</Link>, en indiquant le lien du guide et le point concerné.</p>
      <p><Link href="/blog">← Revenir au carnet</Link></p>
    </div></main>
    <SiteFooter reseaux={reseaux} />
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd({ "@context": "https://schema.org", "@type": "AboutPage", url: urlAbsolue(REDACTION_PATH), name: "L’équipe et la méthode du carnet", mainEntity: { "@type": "Organization", name: "Équipe Snack Manager", url: urlAbsolue(REDACTION_PATH), parentOrganization: { "@type": "Organization", name: "Snack Manager", url: urlAbsolue("/") } } }) }} />
  </>;
}
