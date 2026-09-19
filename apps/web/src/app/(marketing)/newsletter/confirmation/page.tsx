import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/marketing/SiteHeader";
import { SiteFooter } from "@/components/marketing/SiteFooter";
import { lireReseaux } from "@/lib/reseaux";
import styles from "./confirmation.module.css";

export const metadata: Metadata = {
  title: "Votre inscription aux nouvelles de Snack Manager",
  description: "Confirmation par e-mail et gestion de votre abonnement aux nouveautés et offres Snack Manager.",
  alternates: { canonical: "/newsletter/confirmation" },
  robots: { index: false, follow: true },
};

/** Brevo validates its confirmation link; visiting this page never changes subscription state. */
export default async function NewsletterConfirmationPage() {
  const reseaux = await lireReseaux();
  return <>
    <a className="mk-skip" href="#newsletter-confirmation">Aller au contenu</a>
    <SiteHeader />
    <main className={styles.main} id="newsletter-confirmation">
      <section className={styles.panel} aria-labelledby="newsletter-heading">
        <span className={styles.notch}>LA NEWSLETTER SNACK MANAGER</span>
        <svg className={styles.symbol} viewBox="0 0 72 72" fill="none" aria-hidden="true"><rect x="10" y="18" width="52" height="37" rx="6" stroke="currentColor" strokeWidth="1.4" /><path d="m12 22 24 19 24-19M12 52l17-17m31 17L43 35" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
        <p className={styles.eyebrow}>UN LIEN AVEC VOTRE QUOTIDIEN</p>
        <h1 id="newsletter-heading">Les nouvelles<br /><span>de Snack Manager.</span></h1>
        <p className={styles.intro}>Votre inscription prend effet après validation du lien reçu par e-mail. Brevo, notre service d’envoi, gère cette confirmation et votre abonnement.</p>
        <div className={styles.details}><div><span>01</span><h2>Des nouvelles utiles.</h2><p>Les nouveautés et les offres de Snack Manager pour votre restaurant.</p></div><div><span>02</span><h2>Vous gardez le choix.</h2><p>Un lien de désinscription figure dans chaque e-mail. Vous pouvez l’utiliser à tout moment.</p></div></div>
        <Link className={styles.link} href="/">Découvrir Snack Manager <span aria-hidden="true">↗</span></Link>
      </section>
    </main>
    <SiteFooter reseaux={reseaux} />
  </>;
}
