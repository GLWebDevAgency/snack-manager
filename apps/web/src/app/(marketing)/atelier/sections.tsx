import Link from "next/link";
import { Photo } from "@/components/marketing/Photo";
import { ATELIER_SERVICES, CTA_CALLBACK, CTA_DEMO, ancre } from "@/components/marketing/content";
import {
  AGENCE_ROWS,
  ATELIER_CTA,
  ATELIER_HERO,
  ATELIER_SHOTS,
  ATELIER_SOMMAIRE,
  MAQUETTE_POINTS,
  PARCOURS_STEPS,
  atelierSection,
} from "./content";

/**
 * Les blocs de la page Atelier — tous rendus au SERVEUR, comme `/caisse`.
 *
 * Rien ici n'a d'état : les seules pincées de client de la route sont
 * `RevealObserver` (le `.in` des `.rv`) et `Photo` (le repli d'image), tous
 * deux importés de la landing tels quels.
 *
 * ═══ AUCUNE CLASSE NOUVELLE, ET C'EST LE CONTRAT DES PAGES FILLES ═══
 *
 * Bandes `of-band`, grille `of-checks`, rangées de devis `of-rows`, tableau
 * `pr-commissions` : tout vient de la feuille commune. La seule retouche que
 * cette page a coûtée à `marketing.css` est un changement de sélecteur — la
 * démotion du premier prix des `of-rows` suit désormais la classe
 * `is-compris` au lieu du rang, parce qu'ici la première rangée porte un vrai
 * montant.
 *
 * Le rythme alterne les gabarits, deux de même forme ne se suivent jamais :
 * bande photographique → grille de faits → rangées de devis → tableau → bande.
 */

/* ── En-tête — la bande d'ouverture ──────────────────────────── */

function PageHead() {
  return (
    <header className="of-band of-hero">
      {/* Le comptoir sous ses lampes, voilé : la page vend l'artisan derrière
          le comptoir, pas une plateforme — l'image pose l'ambiance, le texte
          dit tout. Décorative, donc `alt` vide. */}
      <span className="of-bandmedia of-heromedia">
        <Photo shot={ATELIER_SHOTS.hero} decorative eager sizes="100vw" />
      </span>
      <span className="of-bandveil" aria-hidden="true" />

      <div className="of-bandinner of-heroinner">
        <span className="badge">{ATELIER_HERO.badge}</span>
        <h1 className="h1 of-title">{ATELIER_HERO.title}</h1>
        <p className="subheading of-lead">{ATELIER_HERO.lead}</p>

        {/* LE renversement de risque, épinglé dès l'ouverture, avec le pouls
            doré des pastilles du hero de la landing : rien d'autre sur la
            page ne bouge en continu — une seule chose vivante, la bonne. */}
        <p className="of-herochip">
          <span className="hero-chipdot gold" aria-hidden="true" />
          {ATELIER_HERO.chip}
        </p>

        {/* Le doré du hero est la promesse de transparence, pas un montant :
            les prix arrivent tous ensemble, deux écrans plus bas. */}
        <p className="of-heroprice">
          <span className="of-heroamt">{ATELIER_HERO.price}</span>
        </p>
        <p className="of-heroclaim">{ATELIER_HERO.claim}</p>

        <nav className="of-toc" aria-label="Sommaire de la page">
          {ATELIER_SOMMAIRE.map((item) => (
            <a className="of-tocitem" href={item.href} key={item.href}>
              {item.label}
            </a>
          ))}
        </nav>
      </div>
    </header>
  );
}

/* ── 1. La maquette ──────────────────────────────────────────── */

function Maquette() {
  const meta = atelierSection("maquette");
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
        {MAQUETTE_POINTS.map((line) => (
          <li className="of-check" key={line}>
            <span className="of-tick" aria-hidden="true" />
            <span>{line}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ── 1 bis. La démarche — la frise en trois étapes ───────────── */

/**
 * LE GABARIT DE LA FRISE DES JALONS (`jl-`), APPLIQUÉ À LA DÉMARCHE : le rail,
 * les nœuds dorés, l'étagement — le type visuel le plus premium du site, et
 * une démarche EST une frise. Trois colonnes au lieu de quatre (`.trois`),
 * tous les nœuds pleins : rien n'est « à venir », chaque étape existe.
 */
function Parcours() {
  const meta = atelierSection("parcours");
  return (
    <section className="section jl-section" id={meta.id}>
      <span className="badge">{meta.badge}</span>
      <h2 className="h2 center-h2" style={{ maxWidth: 760 }}>
        {meta.title}
      </h2>
      <p className="subheading" style={{ maxWidth: 680 }}>
        {meta.lead}
      </p>

      <ol className="jl-track trois">
        {PARCOURS_STEPS.map((step) => (
          <li className="jl-step rv" key={step.when}>
            <span className="jl-node" aria-hidden="true" />
            <p className="jl-when">{step.when}</p>
            <h3 className="jl-title">{step.title}</h3>
            <div className="jl-lines">
              <p className="jl-line">{step.line}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

/* ── 2. Les services, et leurs prix ──────────────────────────── */

/**
 * SIX RANGÉES DE DEVIS, JAMAIS SIX CARTES — même arbitrage que la section
 * services d'`/offres`, dont c'est le gabarit : les six prix forment une
 * colonne qu'on lit sans lire les rangées, ce qui est exactement ce qu'on fait
 * devant un devis. Et c'est bien ce que cette page est : le devis, affiché
 * d'avance.
 *
 * `ATELIER_SERVICES` est LU depuis la vitrine — le même objet que la bande
 * d'`/offres`, jamais un texte réécrit.
 */
function Services() {
  const meta = atelierSection("services");
  return (
    <section className="section of-section" id={meta.id}>
      <div className="of-wrap">
        <div className="of-sechead rv">
          <span className="badge">{meta.badge}</span>
          <h2 className="h2">{meta.title}</h2>
          <p className="subheading of-seclead">{meta.lead}</p>
        </div>

        <ol className="of-rows">
          {ATELIER_SERVICES.map((s, i) => (
            <li className="of-row rv" key={s.id} style={{ transitionDelay: `${i * 0.08}s` }}>
              <div className="of-rowhead">
                <h3 className="of-rowtitle">{s.title}</h3>
                <p className="of-rowlead">{s.lead}</p>
              </div>
              <p className="of-rowline">{s.line}</p>
              <p className="of-rowprice">
                {s.price}
                {s.priceNote ? <span className="of-rowpricenote">{s.priceNote}</span> : null}
              </p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/* ── 3. Et pas une agence ────────────────────────────────────── */

/**
 * QUATRE RANGÉES, UNE RAISON PAR RANGÉE — le gabarit du tableau de la page
 * Caisse (`pr-commissions`), pas une grille : la dernière rangée porte
 * l'argument que personne d'autre ne peut écrire (« une seule facture ») et
 * mérite sa largeur de lecture entière.
 */
function Agence() {
  const meta = atelierSection("agence");
  return (
    <section className="section" id={meta.id}>
      <span className="badge">{meta.badge}</span>
      <h2 className="h2 center-h2" style={{ maxWidth: 720 }}>
        {meta.title}
      </h2>
      <p className="subheading" style={{ maxWidth: 680 }}>
        {meta.lead}
      </p>

      <dl className="pr-commissions rv">
        {AGENCE_ROWS.map((row) => (
          <div className="pr-commission" key={row.label}>
            <dt className="pr-cwho">{row.label}</dt>
            <dd className="pr-cnote">{row.line}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/* ── L'appel final ───────────────────────────────────────────── */

function AppelFinal() {
  return (
    <section className="of-band of-ctaband">
      <span className="of-bandmedia of-ctamedia">
        <Photo shot={ATELIER_SHOTS.cta} decorative sizes="100vw" />
      </span>
      <span className="of-bandveil" aria-hidden="true" />

      <div className="of-bandinner of-ctainner rv">
        <h2 className="h2 of-ctatitle">{ATELIER_CTA.title}</h2>
        <p className="subheading of-ctaline">{ATELIER_CTA.line}</p>
        <div className="of-ctabtns">
          {/* Le rappel d'abord : la maquette commence par une conversation.
              `ancre()` et pas `#contact` : ces deux liens visent la LANDING
              depuis une autre route — la règle de tout le site. */}
          <Link className="btn light" href={ancre("contact").href}>
            {CTA_CALLBACK}
          </Link>
          <Link className="btn dark" href={ancre("produit").href}>
            {CTA_DEMO}
          </Link>
        </div>
        {/* La preuve au moment de demander le numéro — un fait du site, pas
            un chiffre inventé. */}
        <p className="of-ctaproof">{ATELIER_CTA.proof}</p>
      </div>
    </section>
  );
}

/**
 * La page, dans l'ordre d'une mise en confiance : la démarche → la grille →
 * la comparaison → le geste. On ne demande le numéro qu'après avoir tout
 * montré, prix compris.
 */
export function AtelierBody() {
  return (
    <>
      <PageHead />
      <Maquette />
      <Parcours />
      <Services />
      <Agence />
      <AppelFinal />
    </>
  );
}
