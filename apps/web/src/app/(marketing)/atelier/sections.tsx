import Link from "next/link";
import { Photo } from "@/components/marketing/Photo";
import { ATELIER_SERVICES, ancre, euros } from "@/components/marketing/content";
import { MENUS_OFFERS, MENU_PRINT_NOTE, type MenuOffer } from "@/components/marketing/menu-offers";
import { ATELIER_FAQ, ATELIER_SECTIONS, ATELIER_SHOTS, ATELIER_SOMMAIRE, PARCOURS_STEPS } from "./content";
import styles from "../offres/offers.module.css";

function SectionHead({ id }: { id: typeof ATELIER_SECTIONS[number]["id"] }) {
  const meta = ATELIER_SECTIONS.find((section) => section.id === id)!;
  return <div className="of-sechead rv"><span className="badge">{meta.badge}</span><h2 className="h2" id={`${id}-title`}>{meta.title}</h2><p className="subheading of-seclead">{meta.lead}</p></div>;
}

function Price({ offer }: { offer: MenuOffer }) {
  return <p className={styles.menuPrice}>{offer.priceFrom ? <span>À partir de</span> : null}<strong>{euros(offer.priceCents)}</strong><small>HT, une fois</small></p>;
}

function PageHead() {
  const firstOffer = MENUS_OFFERS[0];
  return (
    <header className={`of-band of-hero ${styles.hero}`}>
      <span className="of-bandmedia of-heromedia"><Photo shot={ATELIER_SHOTS.hero} decorative eager sizes="100vw" /></span><span className="of-bandveil" aria-hidden="true" />
      <div className="of-bandinner of-heroinner">
        <span className="badge">L’Atelier — Menus & communication</span>
        <h1 className="h1 of-title">Faites vivre votre carte.<br />Sur papier et sur écran.</h1>
        <p className="subheading of-lead">Une nouvelle carte, des prix à mettre à jour ou des menus TV à préparer : confiez-nous un travail précis, adapté à votre restaurant. Vous validez le résultat et gardez un budget clair.</p>
        <p className={styles.heroPrice}>Création dès <strong>{euros(firstOffer.priceCents)}</strong><span> HT · impression et livraison distinctes</span></p>
        <nav className="of-toc" aria-label="Sommaire de l’Atelier">{ATELIER_SOMMAIRE.map((item) => <a className="of-tocitem" href={item.href} key={item.href}>{item.label}</a>)}</nav>
      </div>
    </header>
  );
}

function MenuCard({ offer }: { offer: MenuOffer }) {
  return (
    <article className={`${styles.menuCard} rv`} id={offer.id} data-featured={offer.id === "ensemble"} aria-labelledby={`${offer.id}-title`}>
      <span className={styles.eyebrow}>{offer.category === "tv" ? "Menus sur écran" : offer.category === "ensemble" ? "Papier + TV + conseil" : "Menus papier"}</span>
      <div className={styles.menuTop}><h3 id={`${offer.id}-title`}>{offer.title}</h3><Price offer={offer} /></div>
      <p className={styles.menuSummary}>{offer.summary}</p>
      <ul className={styles.menuPoints}>{offer.included.map((point) => <li key={point}>{point}</li>)}</ul>
      <div className={styles.menuDetail}><p>{offer.note}</p><p><strong>Hors forfait : </strong>{offer.exclusions.join(". ")}.</p></div>
      <Link className={`btn ${offer.id === "ensemble" ? "light" : "dark"}`} href={ancre("contact").href}>{offer.cta}</Link>
    </article>
  );
}

function Menus() {
  return (
    <section className="section of-section" id="menus-atelier" aria-labelledby="menus-atelier-title">
      <div className="of-wrap">
        <SectionHead id="menus-atelier" />
        <div className={styles.menuGrid}>{MENUS_OFFERS.filter((offer) => offer.category !== "accompagnement").map((offer) => <MenuCard offer={offer} key={offer.id} />)}</div>
        <div className={`${styles.printNote} rv`}><h3>La conception d’un côté.<br />La fabrication de l’autre.</h3><div><p>{MENU_PRINT_NOTE}</p><p>Le fichier est préparé selon le format, les plis et les spécifications de l’imprimeur retenu. Une carte déjà imprimée nécessite un nouveau tirage pour afficher vos changements. Les téléviseurs, lecteurs et installations physiques se chiffrent également à part.</p></div></div>
      </div>
    </section>
  );
}

function Accompagnement() {
  return (
    <section className="section of-section is-tinted" id="mises-a-jour" aria-labelledby="mises-a-jour-title">
      <div className="of-wrap"><SectionHead id="mises-a-jour" /><div className={styles.supportRows}>{MENUS_OFFERS.filter((offer) => offer.category === "accompagnement").map((offer) => <article className={`${styles.supportRow} rv`} id={offer.id} key={offer.id}><h3>{offer.title}</h3><div><p>{offer.summary}</p><ul className={styles.menuPoints}>{offer.included.map((point) => <li key={point}>{point}</li>)}</ul><p>{offer.note}</p><p className={styles.note}>Hors forfait : {offer.exclusions.join(". ")}.</p><Link className={styles.textLink} href={ancre("contact").href}>{offer.cta} <span aria-hidden="true">↗</span></Link></div><Price offer={offer} /></article>)}</div>
        <div className={`${styles.scopeGrid} rv`}><article><span className={styles.eyebrow}>Vos choix, vos données</span><h3>Les meilleures ventes ne disent pas tout.</h3><p>Les coûts renseignés, la disponibilité et le temps de préparation complètent l’analyse. Nous expliquons les recommandations et vous choisissez les produits à mettre en avant.</p></article><article><span className={styles.eyebrow}>Votre rythme</span><h3>Une intervention quand elle est utile.</h3><p>Une carte stable n’a pas besoin de changer chaque mois. Une analyse saisonnière ou une correction ponctuelle peut suffire. Vous choisissez la prestation adaptée à votre besoin.</p></article></div>
      </div>
    </section>
  );
}

function Process() {
  return <section className="section of-section" id="parcours" aria-labelledby="parcours-title"><div className="of-wrap"><SectionHead id="parcours" /><ol className={styles.process}>{PARCOURS_STEPS.map((step) => <li className="rv" key={step.when}><span>{step.when}</span><h3>{step.title}</h3><p>{step.line}</p></li>)}</ol><p className={styles.note}>Au comptoir, à emporter ou à table : la présentation suit votre identité et votre mode de service. Nous examinons la longueur de la carte, ses variantes et la fréquence des changements avant de confirmer le forfait.</p></div></section>;
}

function OtherServices() {
  return (
    <section className="section of-section is-tinted" id="services" aria-labelledby="services-title"><div className="of-wrap"><SectionHead id="services" /><div className={styles.otherRows}>{ATELIER_SERVICES.filter((service) => service.id !== "integration").map((service) => <article className="rv" key={service.id}><h3>{service.title}</h3><div><p>{service.lead}</p><p>{service.line}</p></div><p className={styles.otherPrice}>{service.price}<small>HT · {service.priceNote}</small></p></article>)}</div><p className={styles.note}>Domaine, hébergement, maintenance, contenus, retours et calendrier sont précisés au devis. Shooting, vidéo originale et budget publicitaire restent distincts. L’intégration de votre commande sur un site existant figure dans les frais de mise en service.</p><Link className="btn dark" href="/offres#demarrage">Voir les frais de mise en service</Link></div></section>
  );
}

function Questions() {
  return <section className="section of-section" id="questions" aria-labelledby="questions-title"><div className="of-wrap"><SectionHead id="questions" /><div className={styles.faq}>{ATELIER_FAQ.map((item) => <details key={item.q}><summary>{item.q}<span aria-hidden="true">+</span></summary><p>{item.a}</p></details>)}</div><aside className={`${styles.printNote} rv`}><div><span className={styles.eyebrow}>En préparation</span><h3>Le Studio autonome papier & TV.</h3></div><div><p>Nous préparons un espace guidé pour décliner votre catalogue sur vos supports. Cet éditeur papier n’est pas encore disponible à la souscription. Les fonctions TV existantes restent comprises dans les trois suites.</p><Link className={styles.textLink} href="/offres#studio-a-venir">Lire les évolutions prévues <span aria-hidden="true">↗</span></Link></div></aside></div></section>;
}

function FinalCta() {
  return <section className="of-band of-ctaband"><span className="of-bandmedia of-ctamedia"><Photo shot={ATELIER_SHOTS.cta} decorative sizes="100vw" /></span><span className="of-bandveil" aria-hidden="true" /><div className="of-bandinner of-ctainner rv"><h2 className="h2 of-ctatitle">Votre prochaine carte commence ici.</h2><p className="subheading of-ctaline">Papier, TV ou les deux : parlons de vos supports et de votre prochain changement. Vous recevez une proposition écrite avant de décider.</p><div className="of-ctabtns"><Link className="btn light" href={ancre("contact").href}>Faire le point sur ma carte</Link><Link className="btn dark" href={ancre("produit").href}>Voir les applications</Link></div></div></section>;
}

export function AtelierBody() {
  return <div className={styles.root}><PageHead /><Menus /><Accompagnement /><Process /><OtherServices /><Questions /><FinalCta /></div>;
}
