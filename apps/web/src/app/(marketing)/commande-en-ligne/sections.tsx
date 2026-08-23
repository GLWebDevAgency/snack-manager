import Link from "next/link";
import { Photo } from "@/components/marketing/Photo";
import { CTA_CALLBACK, CTA_DEMO, ancre } from "@/components/marketing/content";
import {
  COMMANDE_CTA,
  COMMANDE_HERO,
  COMMANDE_SHOTS,
  COMMANDE_SOMMAIRE,
  CUISINE_LIEN_POINTS,
  DIRECT_POINTS,
  FIDELITE_POINTS,
  GOOGLE_POINTS,
  commandeSection,
} from "./content";

/**
 * Les blocs de la page Commande en ligne — rendus au SERVEUR, sur les
 * gabarits communs des pages par application (`/caisse`, `/cuisine`) :
 * bandes `of-band`, grilles `of-checks`, sommaire `of-toc`. Aucune classe
 * inventée.
 */

function PageHead() {
  return (
    <header className="of-band of-hero">
      <span className="of-bandmedia of-heromedia">
        <Photo shot={COMMANDE_SHOTS.hero} decorative eager sizes="100vw" />
      </span>
      <span className="of-bandveil" aria-hidden="true" />

      <div className="of-bandinner of-heroinner">
        <span className="badge">{COMMANDE_HERO.badge}</span>
        <h1 className="h1 of-title">{COMMANDE_HERO.title}</h1>
        <p className="subheading of-lead">{COMMANDE_HERO.lead}</p>

        <p className="of-heroprice">
          <span className="of-heroamt">{COMMANDE_HERO.price}</span>
        </p>
        <p className="of-heroclaim">{COMMANDE_HERO.claim}</p>

        <nav className="of-toc" aria-label="Sommaire de la page">
          {COMMANDE_SOMMAIRE.map((item) => (
            <a className="of-tocitem" href={item.href} key={item.href}>
              {item.label}
            </a>
          ))}
        </nav>
      </div>
    </header>
  );
}

/** Le gabarit unique des pages par application : badge, titre, faits. */
function Faits({ id, points }: { id: string; points: readonly string[] }) {
  const meta = commandeSection(id);
  return (
    <section className="section" id={meta.id}>
      <span className="badge">{meta.badge}</span>
      <h2 className="h2 center-h2" style={{ maxWidth: 780 }}>
        {meta.title}
      </h2>
      <p className="subheading" style={{ maxWidth: 680 }}>
        {meta.lead}
      </p>

      <ul className="of-checks rv">
        {points.map((line) => (
          <li className="of-check" key={line}>
            <span className="of-tick" aria-hidden="true" />
            <span>{line}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function AppelFinal() {
  return (
    <section className="of-band of-ctaband">
      <span className="of-bandmedia of-ctamedia">
        <Photo shot={COMMANDE_SHOTS.cta} decorative sizes="100vw" />
      </span>
      <span className="of-bandveil" aria-hidden="true" />

      <div className="of-bandinner of-ctainner rv">
        <h2 className="h2 of-ctatitle">{COMMANDE_CTA.title}</h2>
        <p className="subheading of-ctaline">{COMMANDE_CTA.line}</p>
        <div className="of-ctabtns">
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

/** La page, dans l'ordre d'une commande : chez vous → vers la cuisine →
 *  la fidélité → Google — puis l'essai. */
export function CommandeBody() {
  return (
    <>
      <PageHead />
      <Faits id="direct" points={DIRECT_POINTS} />
      <Faits id="cuisine" points={CUISINE_LIEN_POINTS} />
      <Faits id="fidelite" points={FIDELITE_POINTS} />
      <Faits id="google" points={GOOGLE_POINTS} />
      <AppelFinal />
    </>
  );
}
