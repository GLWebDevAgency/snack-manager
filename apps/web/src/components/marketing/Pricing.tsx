import {
  COMMISSIONS,
  CTA_CALLBACK,
  ENGAGEMENT,
  FOUNDER_POLICY,
  MODULE_ADDON,
  PLANS,
  PLAN_MODULES,
  PRICING_FOOTNOTE,
  PRICING_MATH,
  section,
} from "./content";

/**
 * « Trois prix, affichés. Zéro commission, toujours. »
 *
 * LA SECTION NE DEMANDE QU'UN SEUL ARBITRAGE : où s'arrête ma colonne. Tout ce
 * qui est écrit ici sert cette décision-là, et rien d'autre ne s'y invite.
 *
 * L'ORDRE EST L'ARGUMENT. Le tableau des commissions vient EN TÊTE, avant les
 * prix, parce que l'objection « et en plus vous allez prendre un
 * pourcentage ? » naît exactement ici et jamais avant. Trois lignes, aucune
 * phrase de plaidoyer autour : un restaurateur qui pose « 0 % » à côté de
 * « jusqu'à 30 % » se convainc tout seul, et l'entourer de commentaires
 * transformerait un fait en argumentaire.
 *
 * LA GRILLE LIT TROIS FOIS LA MÊME LISTE. `PLAN_MODULES` est rendue ENTIÈRE
 * dans les trois colonnes, pastille pleine ou vide. Les listes cumulatives
 * d'hier (« Tout Starter, plus : ») obligeaient le lecteur à comparer quatre
 * lignes contre cinq contre trois et à reconstruire de tête ce que chacune
 * contenait ; il lui reste maintenant une seule chose à chercher, et elle est
 * visible en travers des trois colonnes d'un seul regard.
 *
 * UN SEUL APPEL, EN PIED DE GRILLE. Trois boutons identiques posés sur trois
 * cartes de prix redemandent la décision qu'on vient de réduire à une.
 *
 * L'ADDITION EST ÉCRITE FRANCHEMENT, on ne la laisse pas découvrir : Complet
 * plus le module font 218 €, Boost en coûte 189. Le prospect qui fait ce
 * calcul tout seul après coup se demande pourquoi on ne le lui a pas dit.
 *
 * CE QUI EST SORTI : le compteur de places prises et ses pastilles. Il
 * affirmait trois clients signés que nous n'avons pas — le seul énoncé de la
 * page qu'un prospect pouvait prendre en flagrant délit d'un coup de
 * téléphone. La politique, elle, est vraie et reste : `FOUNDER_POLICY`.
 */
export function Pricing() {
  const { badge, title } = section("tarifs");

  return (
    <section className="section pr-section" id="tarifs">
      {badge ? <span className="badge">{badge}</span> : null}
      <h2 className="h2 center-h2" style={{ maxWidth: 760 }}>
        {title}
      </h2>

      {/* ─── Ce qu'on prélève, et ce que prélèvent les autres ─── */}
      <dl className="pr-commissions rv">
        {COMMISSIONS.map((c, i) => (
          // La première ligne est la nôtre. C'est aussi la seule qui porte
          // l'astérisque : il appelle `PRICING_FOOTNOTE`, en pied de section,
          // qui dit les frais d'encaissement que nous ne touchons pas.
          <div className={i === 0 ? "pr-commission is-ours" : "pr-commission"} key={c.who}>
            <dt className="pr-cwho">{c.who}</dt>
            <dd className="pr-crate">
              {c.rate}
              {i === 0 ? (
                <sup className="pr-star" aria-hidden="true">
                  *
                </sup>
              ) : null}
            </dd>
            <dd className="pr-cnote">{c.note}</dd>
          </div>
        ))}
      </dl>

      {/* ─── Les trois formules ─── */}
      <div className="pr-grid">
        {PLANS.map((plan, i) => (
          <div className="rv" key={plan.id} style={{ transitionDelay: `${i * 0.1}s` }}>
            <article className={plan.popular ? "pr-card popular spot" : "pr-card spot"}>
              {plan.popular ? <span className="pr-badge">Populaire</span> : null}
              <h3 className="h5">{plan.name}</h3>
              <p className="pr-price">
                {plan.price}
                <span className="pr-period">{plan.period}</span>
              </p>
              <p className="body-text pr-desc">{plan.desc}</p>

              <ul className="pr-modules">
                {PLAN_MODULES.map((m) => {
                  const included = plan.modules.includes(m.id);
                  return (
                    <li className={included ? "pr-module" : "pr-module off"} key={m.id}>
                      <span className="pr-dot" aria-hidden="true" />
                      <span>{m.label}</span>
                      {/* La pastille est muette pour un lecteur d'écran : sans
                          ce mot, les trois colonnes lui dictent onze fois la
                          même liste et la grille ne dit plus rien. */}
                      <span className="pr-sr">{included ? "Inclus" : "Non inclus"}</span>
                    </li>
                  );
                })}
              </ul>
            </article>
          </div>
        ))}
      </div>

      <a className="btn light pr-cta" href="#contact">
        {CTA_CALLBACK}
      </a>

      {/* ─── L'addition, avant qu'on la fasse ─── */}
      <div className="pr-math rv">
        <div className="pr-mathrow">
          <div className="pr-mathside">
            <span className="pr-mathlabel">{PRICING_MATH.left}</span>
            <span className="pr-mathsum">{PRICING_MATH.sum}</span>
          </div>
          <div className="pr-mathside is-boost">
            <span className="pr-mathlabel">{PRICING_MATH.right}</span>
            <span className="pr-mathsum">{PRICING_MATH.boost}</span>
          </div>
        </div>
        <p className="pr-mathsave">{PRICING_MATH.save}</p>
        <p className="pr-mathline">{PRICING_MATH.line}</p>
      </div>

      {/* Le module vendu à part. Il s'affiche « Commande en ligne & click and
          collect » et jamais « Livraison » : le mot Livraison en face d'un prix
          se lit comme un livreur qu'on facture, et nous n'en fournissons
          aucun — le tunnel s'arrête au créneau de retrait. */}
      <p className="pr-addon">
        <strong>{MODULE_ADDON.name}</strong> — <span className="pr-addonprice">{MODULE_ADDON.price}</span>.{" "}
        {MODULE_ADDON.line}
      </p>

      {/* La clause d'engagement est affichée telle quelle, jamais reformulée :
          la FAQ affiche la MÊME constante, et c'est à ce prix que la page cesse
          de se contredire à voix haute. */}
      <div className="pr-band rv">
        <p className="pr-engagement">{ENGAGEMENT}</p>
        <p className="pr-policy">{FOUNDER_POLICY}</p>
      </div>

      {/* Discrète par sa taille, pas par son emplacement : elle ferme la
          section, personne ne peut prétendre ne pas l'avoir vue. */}
      <p className="pr-note">{PRICING_FOOTNOTE}</p>
    </section>
  );
}
