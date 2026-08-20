"use client";

import { useState } from "react";
import { BOOST_FIGURES, BOOST_LEVERS, BRANDS, BRAND_FIGURES, BRAND_KIT, BRAND_STEPS } from "./content";

/**
 * « Gérer, c'est fait. Maintenant, on vend. » — le moment où la vitrine passe
 * de l'outil à l'argent.
 *
 * CE QUI A CHANGÉ, ET POURQUOI. La section disait la même chose en deux pavés
 * de texte jumeaux : « trop chargée, difficile de comprendre » (le fondateur).
 * Le fond est conservé mot pour mot — deux offres, quatre marques, 0 €, 8 %,
 * 3 semaines, 99 €/mois, +30 % en 60 jours, sans engagement — mais il est
 * maintenant REGARDÉ au lieu d'être lu :
 *
 *   · les deux offres n'ont plus la même forme (une vitrine large, une bande
 *     compacte), donc on ne les confond plus d'un coup d'œil ;
 *   · les marques passent DEVANT l'argumentaire, comme chez Not So Dark et
 *     Taster — ce sont des produits, pas des paragraphes ;
 *   · les chiffres sont seuls et gros, sans phrase autour ;
 *   · le déroulé tient en trois mots.
 *
 * Les marques n'ont aucun visuel (voir `BRANDS`) : les tuiles sont
 * typographiques, et le jour où les vraies identités existent elles se posent
 * dedans sans toucher à cette structure.
 */
export function Revenue() {
  const [active, setActive] = useState(0);
  const brand = BRANDS[active];

  /**
   * Flèches gauche/droite dans la vitrine — c'est ce qu'attend un lecteur
   * d'écran d'un `role="tablist"`, et le `tabIndex` glissant ci-dessous n'a de
   * sens qu'avec : sans ces touches, une seule tuile serait atteignable et les
   * trois autres marques deviendraient invisibles au clavier.
   */
  function onKey(e: React.KeyboardEvent<HTMLDivElement>) {
    const dir = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (dir === 0) return;
    e.preventDefault();
    const next = (active + dir + BRANDS.length) % BRANDS.length;
    setActive(next);
    document.getElementById(`rev-tab-${BRANDS[next].id}`)?.focus();
  }

  return (
    <section className="section rev-section" id="revenus">
      <span className="badge">Le virage</span>
      {/* Une seule ligne, à pleine largeur : c'est une rupture, pas un
          paragraphe. Le titre annonce la couleur commerciale au lieu de
          l'enrober — et il tient sur un souffle. */}
      <h2 className="h2 center-h2" style={{ maxWidth: 940 }}>
        Gérer, c&apos;est fait. Maintenant, on vend.
      </h2>
      <p className="body-text rev-lead">
        Deux façons de faire du chiffre avec la cuisine et l&apos;équipe que vous avez déjà.
      </p>

      {/* ─── Offre 1 — la vitrine des marques ─── */}
      <article className="rev-offer rv spot">
        <header className="rev-offerhead">
          <span className="rev-kicker">Offre 1</span>
          <h3 className="h4 rev-offertitle">Une 2ᵉ enseigne dans votre cuisine</h3>
          {/* Pas « vous cuisinez, vous encaissez » : c'est mot pour mot les
              étapes 2 et 3 du déroulé, dix centimètres plus bas. */}
          <p className="rev-offerline">Livrée clé en main, dans la cuisine que vous avez.</p>
        </header>

        <div className="rev-brands" role="tablist" aria-label="Nos quatre marques de livraison" onKeyDown={onKey}>
          {BRANDS.map((b, i) => (
            <button
              type="button"
              key={b.id}
              role="tab"
              id={`rev-tab-${b.id}`}
              aria-selected={i === active}
              aria-controls="rev-brandpanel"
              tabIndex={i === active ? 0 : -1}
              className={i === active ? "rev-brand is-on" : "rev-brand"}
              style={{ "--bt": b.tint } as React.CSSProperties}
              onClick={() => setActive(i)}
            >
              <span className="rev-brandname">{b.name}</span>
              <span className="rev-brandcuisine">{b.cuisine}</span>
              <span className="rev-halal">100 % halal</span>
            </button>
          ))}
        </div>

        <div
          className="rev-brandpanel"
          id="rev-brandpanel"
          role="tabpanel"
          aria-labelledby={`rev-tab-${brand.id}`}
          style={{ "--bt": brand.tint } as React.CSSProperties}
        >
          <ul className="rev-kit">
            {BRAND_KIT.map((k) => (
              <li className="rev-kititem" key={k}>
                {k}
              </li>
            ))}
          </ul>
          <a className="btn light rev-discover" href="#contact">
            Découvrir {brand.name}
          </a>
        </div>

        <ol className="rev-steps">
          {BRAND_STEPS.map((s, i) => (
            <li className="rev-step" key={s}>
              <span className="rev-stepnum">{i + 1}</span>
              {s}
            </li>
          ))}
        </ol>

        <dl className="rev-figures">
          {BRAND_FIGURES.map((f) => (
            <div className="rev-figure" key={f.fig}>
              <dt className="rev-fig">{f.fig}</dt>
              <dd className="rev-figlabel">{f.label}</dd>
            </div>
          ))}
        </dl>
      </article>

      {/* ─── Offre 2 — la bande compacte, deux colonnes ─── */}
      <article className="rev-offer boost rv spot" style={{ transitionDelay: "0.08s" }}>
        <div className="rev-boostmain">
          <header className="rev-offerhead">
            <span className="rev-kicker">Offre 2</span>
            <h3 className="h4 rev-offertitle">Vous y êtes déjà, mais ça vend peu</h3>
            <p className="rev-offerline">On reprend votre page Uber Eats et Deliveroo.</p>
          </header>

          <ul className="rev-levers">
            {BOOST_LEVERS.map((l) => (
              <li className="rev-lever" key={l}>
                {l}
              </li>
            ))}
          </ul>
        </div>

        <div className="rev-boostside">
          <dl className="rev-figures boost">
            {BOOST_FIGURES.map((f) => (
              <div className="rev-figure" key={f.fig}>
                <dt className="rev-fig">{f.fig}</dt>
                <dd className="rev-figlabel">{f.label}</dd>
              </div>
            ))}
          </dl>
          <a className="btn dark rev-boostcta" href="#contact">
            Être rappelé
          </a>
        </div>
      </article>
    </section>
  );
}
