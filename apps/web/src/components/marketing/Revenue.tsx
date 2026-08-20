"use client";

import { useState } from "react";
import {
  BOOST_FIGURES,
  BOOST_LEVERS,
  BRANDS,
  BRAND_CHANNELS,
  BRAND_FAIR,
  BRAND_FIGURES,
  BRAND_INTRO,
  BRAND_KIT,
  BRAND_STEPS,
  DIRECT_CHANNELS,
  DIRECT_DELIVERY,
  DIRECT_DOES,
  DIRECT_FIGURES,
  REVENUE_ASK,
  REVENUE_FOOTNOTE,
  REVENUE_LANES,
  REVENUE_PAYOFF,
} from "./content";

/**
 * « Gérer, c'est fait. Maintenant, on vend. » — le moment où la vitrine passe
 * de l'outil à l'argent.
 *
 * TROIS ACTES, ET SEULEMENT LE DEUXIÈME EST TRIÉ.
 *
 *   1. Une question que le prospect connaît par cœur — « Vous êtes sur Uber Eats
 *      ou Deliveroo ? » — parce qu'un patron de snack ne lit pas deux
 *      argumentaires pour découvrir que l'un des deux ne le vise pas.
 *   2. La voie qui le concerne, et elle seule : on reprend ses pages
 *      plateformes, ou on le met en direct. La voie « en direct » est celle qui
 *      manquait — beaucoup de nos meilleurs clients sont dans des communes où
 *      les plateformes ne sont pas déployées.
 *   3. La 2ᵉ enseigne, COMMUNE AUX DEUX. Elle vivait dans la voie « Oui, j'y
 *      suis », et c'était une erreur de modèle : une marque blanche a besoin
 *      d'un canal, pas d'une plateforme, et le canal c'est notre page de
 *      commande. L'enfermer dans une voie, c'était la refuser à la moitié des
 *      prospects — ceux, précisément, qui n'ont aucun autre moyen de la vendre.
 *
 * La convergence — « Reprenez la main sur votre marge » — sépare l'acte 2 de
 * l'acte 3 : elle clôt l'argument de la marge et ouvre celui du volume.
 *
 * LES DEUX VOIES SONT TOUJOURS MONTÉES, masquées par `hidden`. Ce n'est pas un
 * détail : `RevealObserver` interroge `.mk .rv` UNE SEULE FOIS au montage. Une
 * voie rendue conditionnellement n'y serait jamais passée et resterait à
 * `opacity: 0` pour toujours, le jour où on lui met une classe `rv`.
 *
 * Les marques n'ont aucun visuel (voir `BRANDS`) : les tuiles sont
 * typographiques, et le jour où les vraies identités existent elles se posent
 * dedans sans toucher à cette structure.
 */
export function Revenue() {
  const [lane, setLane] = useState(0);
  const [active, setActive] = useState(0);
  const brand = BRANDS[active];

  /**
   * Flèches gauche/droite dans une bande d'onglets. Les deux `tablist` de la
   * section — le sélecteur de voie et la vitrine des marques — n'ont aucune
   * relation d'ancêtre : la vitrine est désormais hors des voies, donc encore
   * plus sûrement hors de portée. Aucune flèche pressée sur une tuile de marque
   * ne peut changer de voie.
   */
  function arrows<T>(
    e: React.KeyboardEvent,
    items: readonly T[],
    index: number,
    set: (n: number) => void,
    id: (item: T) => string,
  ) {
    const dir = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (dir === 0) return;
    e.preventDefault();
    const next = (index + dir + items.length) % items.length;
    set(next);
    document.getElementById(id(items[next]))?.focus();
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

      {/* ─── Acte 1 — la question qui trie ───
          Question et réponses sur la MÊME ligne en grand écran : c'est une
          question posée à voix haute, pas un intertitre suivi d'un menu. */}
      <div className="rev-ask">
        <p className="rev-askq" id="rev-ask-label">
          {REVENUE_ASK}
        </p>
        <div
          className="rev-switch"
          role="tablist"
          aria-labelledby="rev-ask-label"
          onKeyDown={(e) => arrows(e, REVENUE_LANES, lane, setLane, (x) => `rev-lane-${x.id}`)}
        >
          {REVENUE_LANES.map((l, i) => (
            <button
              type="button"
              key={l.id}
              role="tab"
              id={`rev-lane-${l.id}`}
              aria-selected={i === lane}
              aria-controls={`rev-lanepanel-${l.id}`}
              tabIndex={i === lane ? 0 : -1}
              className={i === lane ? "rev-choice is-on" : "rev-choice"}
              onClick={() => setLane(i)}
            >
              {l.answer}
            </button>
          ))}
        </div>
      </div>

      {/* ─── Acte 2, voie 1 — « Oui, j'y suis » ─── */}
      <div
        className="rev-lane"
        id={`rev-lanepanel-${REVENUE_LANES[0].id}`}
        role="tabpanel"
        aria-labelledby={`rev-lane-${REVENUE_LANES[0].id}`}
        hidden={lane !== 0}
      >
        {/* Une seule offre ici désormais : reprendre en main ce qui tourne déjà.
            La 2ᵉ enseigne était dans cette voie et n'y avait rien à faire — elle
            est descendue à l'acte 3, commun aux deux réponses. */}
        <article className="rev-offer boost rv spot">
          <div className="rev-boostmain">
            <header className="rev-offerhead">
              <span className="rev-kicker">On améliore</span>
              <h3 className="h4 rev-offertitle">Vos pages, mais qui vendent</h3>
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
      </div>

      {/* ─── Acte 2, voie 2 — « Non, ou pas encore » ─── */}
      <div
        className="rev-lane"
        id={`rev-lanepanel-${REVENUE_LANES[1].id}`}
        role="tabpanel"
        aria-labelledby={`rev-lane-${REVENUE_LANES[1].id}`}
        hidden={lane !== 1}
      >
        <article className="rev-offer direct rv spot">
          <header className="rev-offerhead">
            <span className="rev-kicker">En direct</span>
            <h3 className="h4 rev-offertitle">Votre commande en ligne, sans intermédiaire</h3>
            <p className="rev-offerline">Deux façons de la brancher — vous choisissez, on installe.</p>
          </header>

          <div className="rev-channels">
            {DIRECT_CHANNELS.map((c) => (
              <div className="rev-channel" key={c.id}>
                <h4 className="rev-channeltitle">{c.title}</h4>
                <p className="rev-channelline">{c.line}</p>
              </div>
            ))}
          </div>

          <div className="rev-does">
            <ul className="rev-kit">
              {DIRECT_DOES.map((d) => (
                <li className="rev-kititem" key={d}>
                  {d}
                </li>
              ))}
            </ul>
            {/* La livraison est nommée, jamais promise : on ne fournit pas de
                livreurs, et le tunnel de commande s'arrête au créneau de
                retrait. */}
            <p className="rev-delivery">
              <strong>{DIRECT_DELIVERY.lead}</strong> {DIRECT_DELIVERY.line}
            </p>
          </div>

          <dl className="rev-figures direct">
            {DIRECT_FIGURES.map((f) => (
              <div className="rev-figure" key={f.fig}>
                <dt className="rev-fig">{f.fig}</dt>
                <dd className="rev-figlabel">{f.label}</dd>
              </div>
            ))}
          </dl>

          {/* Même verbe que dans l'autre voie, et c'est voulu : les deux voies
              s'excluent, personne ne verra la répétition. « Voir ma page de
              commande » aurait promis une démonstration alors que le lien mène
              au formulaire — la vitrine du tunnel de commande est déjà offerte,
              en direct, dans la section des applications. */}
          <a className="btn light rev-directcta" href="#contact">
            Être rappelé
          </a>
        </article>
      </div>

      {/* ─── Le point de convergence ───
          Hors des voies, donc lu quelle que soit la réponse. Il clôt l'argument
          de la marge — et sert de charnière vers celui du volume. */}
      <div className="rev-payoff rv">
        <p className="rev-payofftitle">{REVENUE_PAYOFF.title}</p>
        <p className="rev-payoffline">{REVENUE_PAYOFF.line}</p>
      </div>

      {/* ─── Acte 3 — la 2ᵉ enseigne, pour tout le monde ───
          Hors des voies : c'est le sens même de la correction. Elle se vend sur
          la page de commande qu'on installe, donc elle est offerte aussi bien à
          qui n'a jamais entendu parler d'Uber qu'à qui en vit. */}
      <article className="rev-offer brandsact rv spot">
        <header className="rev-offerhead">
          <span className="rev-kicker">{BRAND_INTRO.kicker}</span>
          <h3 className="h4 rev-offertitle">{BRAND_INTRO.title}</h3>
          <p className="rev-offerline">{BRAND_INTRO.line}</p>
        </header>

        {/* Les canaux AVANT les marques : la première question d'un patron qui
            n'est sur aucune plateforme, c'est « oui, mais ça se vend où ? ».
            Tant qu'elle est sans réponse, il ne regarde pas les enseignes. */}
        <div className="rev-channels">
          {BRAND_CHANNELS.map((c) => (
            <div className="rev-channel" key={c.id}>
              <h4 className="rev-channeltitle">{c.title}</h4>
              <p className="rev-channelline">{c.line}</p>
            </div>
          ))}
        </div>

        <div
          className="rev-brands"
          role="tablist"
          aria-label="Nos quatre enseignes"
          onKeyDown={(e) => arrows(e, BRANDS, active, setActive, (b) => `rev-tab-${b.id}`)}
        >
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

        {/* Placée APRÈS les chiffres, et jamais avant : l'objection ne naît
            qu'à la seconde où le lecteur voit « 8 % » après avoir lu « 0 % de
            commission » plus haut. On y répond à cet instant précis — la
            devancer, c'est défendre une accusation que personne n'a portée. */}
        <div className="rev-fair">
          <p className="rev-fairline">
            <strong>{BRAND_FAIR.lead}</strong> {BRAND_FAIR.line}
          </p>
          <p className="rev-fairedge">{BRAND_FAIR.edge}</p>
        </div>
      </article>

      {/* La note qui porte l'astérisque du « 0 % ». Discrète par sa taille, pas
          par son emplacement : elle ferme la section, personne ne peut prétendre
          ne pas l'avoir vue. */}
      <p className="rev-note">{REVENUE_FOOTNOTE}</p>
    </section>
  );
}
