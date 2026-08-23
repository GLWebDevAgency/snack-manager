import Link from "next/link";
import { Photo } from "@/components/marketing/Photo";
import { CTA_CALLBACK, CTA_DEMO, ancre } from "@/components/marketing/content";
import {
  CAISSE_CTA,
  CAISSE_HERO,
  CAISSE_SHOTS,
  CAISSE_SOMMAIRE,
  COUPURE_POINTS,
  ENCAISSEMENT_ROWS,
  SERVICE_POINTS,
  VOUS_POINTS,
  Z_NOTE,
  caisseSection,
} from "./content";

/**
 * Les blocs de la page Caisse — tous rendus au SERVEUR, comme `/offres`.
 *
 * Rien ici n'a d'état : les seules pincées de client de la route sont
 * `RevealObserver` (le `.in` des `.rv`) et `Photo` (le repli d'image), tous
 * deux importés de la landing tels quels.
 *
 * ═══ LES GABARITS SONT CEUX D'`/offres`, ET C'EST UN CHOIX DE MODÈLE ═══
 *
 * Cette page inaugure les pages par application ; celles de la cuisine et de
 * la commande en ligne se construiront en copiant SA structure. Elle
 * n'invente donc aucune classe : bandes `of-band`, grilles `of-checks`,
 * sommaire `of-toc` — tout vient de la feuille commune, et une page de plus
 * ne coûte pas une règle CSS de plus.
 *
 * Le rythme alterne les gabarits, deux de même forme ne se suivent jamais :
 * bande photographique → grille de faits → rangées → grille → grille → bande.
 */

/* ── En-tête — la bande d'ouverture ──────────────────────────── */

function PageHead() {
  return (
    <header className="of-band of-hero">
      {/* La capture réelle de la caisse, voilée : le hero raconte, la démo de
          la landing montre — et les deux boutons y mènent. Décorative, donc
          `alt` vide : son contenu est précisément ce que la page décrit. */}
      <span className="of-bandmedia of-heromedia">
        <Photo shot={CAISSE_SHOTS.hero} decorative eager sizes="100vw" />
      </span>
      <span className="of-bandveil" aria-hidden="true" />

      <div className="of-bandinner of-heroinner">
        <span className="badge">{CAISSE_HERO.badge}</span>
        <h1 className="h1 of-title">{CAISSE_HERO.title}</h1>
        <p className="subheading of-lead">{CAISSE_HERO.lead}</p>

        {/* Le premier doré de la page est un prix — dérivé de la grille. */}
        <p className="of-heroprice">
          <span className="of-heroamt">{CAISSE_HERO.price}</span>
        </p>
        <p className="of-heroclaim">{CAISSE_HERO.claim}</p>

        <nav className="of-toc" aria-label="Sommaire de la page">
          {CAISSE_SOMMAIRE.map((item) => (
            <a className="of-tocitem" href={item.href} key={item.href}>
              {item.label}
            </a>
          ))}
        </nav>
      </div>
    </header>
  );
}

/* ── 1. Le service ───────────────────────────────────────────── */

function Service() {
  const meta = caisseSection("service");
  return (
    <section className="section" id={meta.id}>
      <span className="badge">{meta.badge}</span>
      <h2 className="h2 center-h2" style={{ maxWidth: 760 }}>
        {meta.title}
      </h2>
      <p className="subheading" style={{ maxWidth: 680 }}>
        {meta.lead}
      </p>

      <ul className="of-checks rv">
        {SERVICE_POINTS.map((line) => (
          <li className="of-check" key={line}>
            <span className="of-tick" aria-hidden="true" />
            <span>{line}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ── 2. L'encaissement ───────────────────────────────────────── */

/**
 * QUATRE RANGÉES, UN MOYEN DE PAIEMENT PAR RANGÉE — pas une grille : la ligne
 * carte porte l'engagement le plus important de la page (« nous ne touchons
 * pas à votre argent ») et mérite sa largeur de lecture entière.
 */
function Encaissement() {
  const meta = caisseSection("encaissement");
  return (
    <section className="section" id={meta.id}>
      <span className="badge">{meta.badge}</span>
      <h2 className="h2 center-h2" style={{ maxWidth: 820 }}>
        {meta.title}
      </h2>
      <p className="subheading" style={{ maxWidth: 680 }}>
        {meta.lead}
      </p>

      <dl className="pr-commissions rv">
        {ENCAISSEMENT_ROWS.map((row) => (
          <div className="pr-commission" key={row.label}>
            <dt className="pr-cwho">{row.label}</dt>
            <dd className="pr-cnote">{row.line}</dd>
          </div>
        ))}
      </dl>

      {/* Le Z est la raison d'être des quatre rangées : sans lui, « chaque
          moyen a son bouton » serait un détail d'interface, pas un argument
          de comptabilité. */}
      <p className="pr-note rv">{Z_NOTE}</p>
    </section>
  );
}

/* ── 3. La coupure ───────────────────────────────────────────── */

function Coupure() {
  const meta = caisseSection("coupure");
  return (
    <section className="section" id={meta.id}>
      <span className="badge">{meta.badge}</span>
      <h2 className="h2 center-h2" style={{ maxWidth: 720 }}>
        {meta.title}
      </h2>
      <p className="subheading" style={{ maxWidth: 680 }}>
        {meta.lead}
      </p>

      <ul className="of-checks rv">
        {COUPURE_POINTS.map((line) => (
          <li className="of-check" key={line}>
            <span className="of-tick" aria-hidden="true" />
            <span>{line}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ── 4. Chez vous ────────────────────────────────────────────── */

function ChezVous() {
  const meta = caisseSection("vous");
  return (
    <section className="section" id={meta.id}>
      <span className="badge">{meta.badge}</span>
      <h2 className="h2 center-h2" style={{ maxWidth: 720 }}>
        {meta.title}
      </h2>
      <p className="subheading" style={{ maxWidth: 680 }}>
        {meta.lead}
      </p>

      <ul className="of-checks rv">
        {VOUS_POINTS.map((line) => (
          <li className="of-check" key={line}>
            <span className="of-tick" aria-hidden="true" />
            <span>{line}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ── L'appel final ───────────────────────────────────────────── */

function AppelFinal() {
  return (
    <section className="of-band of-ctaband">
      <span className="of-bandmedia of-ctamedia">
        <Photo shot={CAISSE_SHOTS.cta} decorative sizes="100vw" />
      </span>
      <span className="of-bandveil" aria-hidden="true" />

      <div className="of-bandinner of-ctainner rv">
        <h2 className="h2 of-ctatitle">{CAISSE_CTA.title}</h2>
        <p className="subheading of-ctaline">{CAISSE_CTA.line}</p>
        <div className="of-ctabtns">
          {/* `ancre()` et pas `#produit` : ces deux liens visent la LANDING
              depuis une autre route — la règle de tout le site. */}
          <Link className="btn light" href={ancre("produit").href}>
            {CTA_DEMO}
          </Link>
          <Link className="btn dark" href={ancre("contact").href}>
            {CTA_CALLBACK}
          </Link>
        </div>
      </div>
    </section>
  );
}

/**
 * La page, dans l'ordre d'un service : la commande → l'encaissement → la
 * coupure → chez vous → l'essai. Le lecteur suit sa journée, et la dernière
 * chose qu'on lui montre est une preuve manipulable, pas un argument.
 */
export function CaisseBody() {
  return (
    <>
      <PageHead />
      <Service />
      <Encaissement />
      <Coupure />
      <ChezVous />
      <AppelFinal />
    </>
  );
}
