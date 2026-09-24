import Link from "next/link";
import styles from "../blog.module.css";
export function BlogCta({ atelier = false }: { atelier?: boolean }) {
  return <aside className={styles.cta}>
    <div><p className={styles.eyebrow}>Passer à la pratique</p>
      <h2>{atelier ? "Votre carte et votre visibilité méritent un projet clair." : "Un besoin précis pour votre restaurant ?"}</h2>
      <p>Menus papier et TV, site internet, visibilité locale ou outils pour le service : construisons une réponse adaptée. Notre accompagnement est disponible avec ou sans nos logiciels.</p>
    </div>
    <div className={styles.ctaLinks}><Link className="btn light" href="/#contact">Parlons de votre projet <span aria-hidden="true">↗</span></Link><Link className={styles.textLink} href={atelier ? "/atelier" : "/offres"}>{atelier ? "Découvrir l’Atelier" : "Voir les offres et ce qui est inclus"} <span aria-hidden="true">→</span></Link></div>
  </aside>;
}
