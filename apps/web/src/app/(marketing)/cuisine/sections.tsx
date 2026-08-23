import Link from "next/link";
import { Photo } from "@/components/marketing/Photo";
import { CTA_CALLBACK, CTA_DEMO, ancre } from "@/components/marketing/content";
import {
  ARRIVEE_POINTS,
  CUISINE_COUPURE_POINTS,
  CUISINE_CTA,
  CUISINE_HERO,
  CUISINE_SHOTS,
  CUISINE_SOMMAIRE,
  CUISINE_VOUS_POINTS,
  LISIBLE_POINTS,
  cuisineSection,
} from "./content";

/**
 * Les blocs de la page Écran cuisine — tous rendus au SERVEUR, sur les
 * gabarits de `/caisse` (elle-même sur ceux d'`/offres`) : bandes `of-band`,
 * grilles `of-checks`, sommaire `of-toc`. Aucune classe inventée — c'est le
 * contrat du modèle : une page de plus ne coûte pas une règle CSS de plus.
 */

function PageHead() {
  return (
    <header className="of-band of-hero">
      <span className="of-bandmedia of-heromedia">
        <Photo shot={CUISINE_SHOTS.hero} decorative eager sizes="100vw" />
      </span>
      <span className="of-bandveil" aria-hidden="true" />

      <div className="of-bandinner of-heroinner">
        <span className="badge">{CUISINE_HERO.badge}</span>
        <h1 className="h1 of-title">{CUISINE_HERO.title}</h1>
        <p className="subheading of-lead">{CUISINE_HERO.lead}</p>

        <p className="of-heroprice">
          <span className="of-heroamt">{CUISINE_HERO.price}</span>
        </p>
        <p className="of-heroclaim">{CUISINE_HERO.claim}</p>

        <nav className="of-toc" aria-label="Sommaire de la page">
          {CUISINE_SOMMAIRE.map((item) => (
            <a className="of-tocitem" href={item.href} key={item.href}>
              {item.label}
            </a>
          ))}
        </nav>
      </div>
    </header>
  );
}

/** Une section de faits — le gabarit unique des pages par application. */
function Faits({
  id,
  points,
  wide,
}: {
  id: string;
  points: readonly string[];
  wide?: boolean;
}) {
  const meta = cuisineSection(id);
  return (
    <section className="section" id={meta.id}>
      <span className="badge">{meta.badge}</span>
      <h2 className="h2 center-h2" style={{ maxWidth: wide ? 820 : 720 }}>
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
        <Photo shot={CUISINE_SHOTS.cta} decorative sizes="100vw" />
      </span>
      <span className="of-bandveil" aria-hidden="true" />

      <div className="of-bandinner of-ctainner rv">
        <h2 className="h2 of-ctatitle">{CUISINE_CTA.title}</h2>
        <p className="subheading of-ctaline">{CUISINE_CTA.line}</p>
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

/** La page, dans l'ordre d'un ticket : il arrive, il se lit, le réseau
 *  saute, et l'écran reste celui du restaurant. */
export function CuisineBody() {
  return (
    <>
      <PageHead />
      <Faits id="arrivee" points={ARRIVEE_POINTS} wide />
      <Faits id="lisible" points={LISIBLE_POINTS} />
      <Faits id="coupure" points={CUISINE_COUPURE_POINTS} />
      <Faits id="vous" points={CUISINE_VOUS_POINTS} />
      <AppelFinal />
    </>
  );
}
