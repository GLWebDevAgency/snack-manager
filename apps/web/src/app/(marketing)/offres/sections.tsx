import Link from "next/link";
import { COMPTES_PAR_FORMULE } from "@sm/contracts";
import { CommerceOffers } from "@/components/marketing/CommerceOffers";
import { Photo } from "@/components/marketing/Photo";
import { ATELIER_CENTS, BILLING_YEARLY_NOTE, ENGAGEMENT, MODULE_MONTHLY_CENTS, PLANS, PLAN_MONTHLY_CENTS, ancre, euros, yearlyCents } from "@/components/marketing/content";
import { MENUS_OFFERS, MENU_STUDIO_FUTURE } from "@/components/marketing/menu-offers";
import { COMPARISON_ROWS, MODULE_POINTS, OFFER_FAQ, OFFRE_SECTIONS, OFFRE_SHOTS, PLAN_MODULE_NOTE, PLAN_SUMMARIES, SOMMAIRE, STARTUP_ROWS } from "./content";
import styles from "./offers.module.css";

function SectionHead({ id }: { id: typeof OFFRE_SECTIONS[number]["id"] }) {
  const meta = OFFRE_SECTIONS.find((section) => section.id === id)!;
  return <div className="of-sechead rv"><span className="badge">{meta.badge}</span><h2 className="h2" id={`${id}-title`}>{meta.title}</h2><p className="subheading of-seclead">{meta.lead}</p></div>;
}

function PageHead() {
  return (
    <header className={`of-band of-hero ${styles.hero}`}>
      <span className="of-bandmedia of-heromedia"><Photo shot={OFFRE_SHOTS.hero} decorative eager sizes="100vw" /></span>
      <span className="of-bandveil" aria-hidden="true" />
      <div className="of-bandinner of-heroinner">
        <span className="badge">Offres & tarifs</span>
        <h1 className="h1 of-title">Le bon équipement.<br />Le bon accompagnement.</h1>
        <p className="subheading of-lead">Des logiciels pour votre restaurant. Des prestations pour faire vivre votre carte. Choisissez ce dont vous avez besoin, avec un prix et un périmètre clairs.</p>
        <p className={styles.heroPrice}>Suites dès <strong>{euros(PLAN_MONTHLY_CENTS.essentiel)}</strong><span> HT/mois par établissement</span></p>
        <nav className="of-toc" aria-label="Sommaire des offres">{SOMMAIRE.map((item) => <a className="of-tocitem" href={item.href} key={item.href}>{item.label}</a>)}</nav>
      </div>
    </header>
  );
}

function Plans() {
  return (
    <section className="section of-section" id="formules" aria-labelledby="formules-title">
      <div className="of-wrap">
        <SectionHead id="formules" />
        <div className="of-plans">
          {PLANS.map((plan) => {
            const summary = PLAN_SUMMARIES[plan.id];
            const boost = plan.id === "boost";
            return (
              <article className={`of-plan rv ${boost ? "is-popular" : ""}`} key={plan.id}>
                {boost ? <span className="of-planbadge">Gestion + commande directe</span> : null}
                <h3 className="of-planname">{plan.name}</h3>
                <p className="of-price"><span className="of-amt">{plan.price}</span><span className="of-per">HT / mois</span></p>
                <p className={styles.planPromise}>{summary.promise}</p>
                <p className="of-year"><span className="of-yearamt">{plan.priceYearly} HT</span> par an, réglés en une fois<span className="of-yearmonth">{plan.yearlyPerMonth} HT, à titre indicatif</span></p>
                <ul className="of-mods">{summary.points.map((point) => <li className="of-mod" key={point}><span className="of-dot" aria-hidden="true" /><span>{point}</span></li>)}</ul>
                <p className={`of-plannote ${boost ? "is-inclus" : ""}`}>{summary.note}</p>
                <Link className={`btn ${boost ? "light" : "dark"} ${styles.planCta}`} href={ancre("contact").href}>Parler de {plan.name}</Link>
              </article>
            );
          })}
        </div>
        <div className={`${styles.upgrade} rv`}>
          <div><span className={styles.eyebrow}>Vous souhaitez gestion et commande ?</span><h3>Ces deux usages sont déjà réunis dans Boost.</h3></div>
          <p><span className={styles.oldPrice}>{euros(PLAN_MONTHLY_CENTS.complet + MODULE_MONTHLY_CENTS)}</span><strong>{euros(PLAN_MONTHLY_CENTS.boost)}</strong><span>HT/mois, soit {euros(PLAN_MONTHLY_CENTS.complet + MODULE_MONTHLY_CENTS - PLAN_MONTHLY_CENTS.boost)} de moins que Gestion + Click & collect.</span></p>
        </div>
        <p className={styles.note}>Tarifs standards mensuels, hors promotion. La mise en service standard de la commande est comprise dans Boost. Matériel, interventions, prestations graphiques et frais de paiement restent distincts.</p>
      </div>
    </section>
  );
}

function Comparison() {
  return (
    <section className="section of-section is-tinted" id="comparaison" aria-labelledby="comparaison-title">
      <div className="of-wrap">
        <SectionHead id="comparaison" />
        <p className={styles.scrollHint}>Faites défiler le tableau horizontalement pour comparer les trois suites.</p>
        <div className={styles.tableScroll} role="region" aria-label="Comparaison des suites" tabIndex={0}>
          <table className={styles.table}>
            <caption className={styles.sr}>Fonctions incluses dans chaque suite, prix HT par mois et par établissement.</caption>
            <thead><tr><th scope="col">Votre usage</th>{PLANS.map((plan) => <th scope="col" key={plan.id}>{plan.name}<span>{plan.price} HT/mois</span></th>)}</tr></thead>
            <tbody><tr><th scope="row">Comptes à mot de passe, propriétaire compris</th>{PLANS.map((plan) => <td key={plan.id}>{COMPTES_PAR_FORMULE[plan.id as keyof typeof COMPTES_PAR_FORMULE]}</td>)}</tr>{COMPARISON_ROWS.map((row) => <tr key={row.label}><th scope="row">{row.label}</th>{PLANS.map((plan) => <td key={plan.id} data-included={plan.modules.includes(row.module)}>{plan.modules.includes(row.module) ? row.included : row.excluded}</td>)}</tr>)}
              <tr><th scope="row">Studio autonome pour les cartes papier</th>{PLANS.map((plan) => <td key={plan.id}>En préparation</td>)}</tr>
              <tr><th scope="row">Création graphique et conseil humain</th>{PLANS.map((plan) => <td key={plan.id}>Prestations distinctes</td>)}</tr>
              <tr><th scope="row">Impression, matériel, frais de paiement et livreurs</th>{PLANS.map((plan) => <td key={plan.id}>Non compris</td>)}</tr>
            </tbody>
          </table>
        </div>
        <p className={styles.note}>Les accès équipiers par code PIN ne sont pas décomptés comme des comptes à mot de passe. La mention « pilote » décrit un périmètre accompagné à valider avant ouverture. Les limites de la fidélité et de la livraison sont précisées ci-dessous.</p>
      </div>
    </section>
  );
}

function Applications() {
  return (
    <div id="module" className={styles.applications}>
      <div className={styles.appIntro}><SectionHead id="module" /></div>
      <CommerceOffers />
      <div className={styles.applicationNotes}>
        {MODULE_POINTS.map((point) => <article key={point.title}><h3>{point.title}</h3><p>{point.line}</p></article>)}
        <p className={styles.sr}>{PLAN_MODULE_NOTE.inclus}</p>
      </div>
    </div>
  );
}

function Atelier() {
  return (
    <section className="section of-section" id="atelier" aria-labelledby="atelier-title">
      <div className="of-wrap">
        <SectionHead id="atelier" />
        <div className={styles.serviceSummary}>
          {MENUS_OFFERS.filter((offer) => ["papier", "tv", "ensemble"].includes(offer.id)).map((offer) => <Link href={`/atelier#${offer.id}`} className={`${styles.serviceTile} rv`} key={offer.id}><span className={styles.eyebrow}>{offer.category === "tv" ? "Vos écrans" : offer.category === "ensemble" ? "Vos supports réunis" : "Votre carte papier"}</span><h3>{offer.title}</h3><p>{offer.summary}</p><strong>{euros(offer.priceCents)} <small>HT, une fois</small></strong><span className={styles.textLink}>Voir le contenu de la prestation <span aria-hidden="true">↗</span></span></Link>)}
        </div>
        <p className={styles.note}>L’Atelier propose aussi l’adaptation d’un modèle, les modifications ponctuelles et l’analyse de carte. Impression et livraison sont chiffrées séparément. La diffusion TV utilise les fonctions existantes de votre suite.</p>
        <dl className={styles.compactPrices}>
          <div><dt>Identité visuelle</dt><dd>{euros(ATELIER_CENTS.identite)} HT, une fois</dd></div>
          <div><dt>Site vitrine</dt><dd>Dès {euros(ATELIER_CENTS.site)} HT · refonte dès {euros(ATELIER_CENTS.refonte)} HT</dd></div>
          <div><dt>Fiche Google</dt><dd>{euros(ATELIER_CENTS.presence)} HT/mois</dd></div>
          <div><dt>Réseaux sociaux</dt><dd>{euros(ATELIER_CENTS.social1)} ou {euros(ATELIER_CENTS.social2)} HT/mois</dd></div>
        </dl>
        <Link className="btn light" href="/atelier">Voir toutes les prestations de l’Atelier</Link>
      </div>
    </section>
  );
}

function Startup() {
  return (
    <section className="section of-section is-tinted" id="demarrage" aria-labelledby="demarrage-title"><div className="of-wrap"><SectionHead id="demarrage" /><dl className={styles.budget}>{STARTUP_ROWS.map((row, i) => <div className="rv" key={row.title}><dt><span aria-hidden="true">{String(i + 1).padStart(2, "0")}</span>{row.title}</dt><dd><strong>{row.amount}</strong><p>{row.note}</p></dd></div>)}</dl></div></section>
  );
}

function FutureStudio() {
  return (
    <aside className={`${styles.future} rv`} id="studio-a-venir" aria-labelledby="future-title">
      <div><span className={styles.eyebrow}>{MENU_STUDIO_FUTURE.status}</span><h3 id="future-title">Le Studio Menus, une évolution à venir.</h3><p>Un espace guidé pour préparer vos versions papier et TV à partir de votre catalogue. Les prestations humaines actuelles peuvent vous accompagner dès maintenant ; cet éditeur logiciel n’est pas encore proposé à la souscription.</p></div>
      <div className={styles.futurePrices}><p><span>Studio autonome envisagé</span><strong>{euros(MENU_STUDIO_FUTURE.studioMonthlyCents)} HT/mois</strong><small>{euros(yearlyCents(MENU_STUDIO_FUTURE.studioMonthlyCents))} HT/an, réglés en une fois</small></p><p><span>Futur Boost avec Studio</span><strong>{euros(MENU_STUDIO_FUTURE.boostMonthlyCents)} HT/mois</strong><small>{euros(yearlyCents(MENU_STUDIO_FUTURE.boostMonthlyCents))} HT/an, réglés en une fois</small></p></div>
      <p className={styles.futureNote}>{MENU_STUDIO_FUTURE.note} Les droits et tarifs des contrats existants restent applicables. Création et conseil humains restent des prestations distinctes.</p>
    </aside>
  );
}

function Conditions() {
  return (
    <section className="section of-section" id="conditions" aria-labelledby="conditions-title"><div className="of-wrap"><SectionHead id="conditions" /><div className={styles.conditions}><p>{ENGAGEMENT}</p><p>{BILLING_YEARLY_NOTE} L’équivalent mensuel annuel n’est pas une mensualité prélevée. Les prestations humaines et les impressions restent distinctes.</p></div><div className={styles.faq}>{OFFER_FAQ.map((item) => <details key={item.q}><summary>{item.q}<span aria-hidden="true">+</span></summary><p>{item.a}</p></details>)}</div><FutureStudio /></div></section>
  );
}

function FinalCta() {
  return <section className="of-band of-ctaband"><span className="of-bandmedia of-ctamedia"><Photo shot={OFFRE_SHOTS.cta} decorative sizes="100vw" /></span><span className="of-bandveil" aria-hidden="true" /><div className="of-bandinner of-ctainner rv"><h2 className="h2 of-ctatitle">Choisissons ce qui est utile à votre restaurant.</h2><p className="subheading of-ctaline">Votre carte, votre organisation et vos outils actuels : nous précisons votre besoin, puis le prix et le calendrier avant que vous décidiez.</p><div className="of-ctabtns"><Link className="btn light" href={ancre("contact").href}>Parler de mon restaurant</Link><Link className="btn dark" href={ancre("produit").href}>Voir la démo</Link></div></div></section>;
}

export function OffresBody() {
  return <div className={styles.root}><PageHead /><Plans /><Comparison /><Applications /><Atelier /><Startup /><Conditions /><FinalCta /></div>;
}
