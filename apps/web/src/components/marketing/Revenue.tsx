/**
 * « Du CA en plus » — les deux offres posées au-dessus de la suite logicielle :
 * la marque de livraison clé en main, et le pilotage de la page Uber Eats.
 * Elles réutilisent la carte de tarif (`.pr-card`), avec le reflet animé de la
 * maquette (`.rev-grid .pr-card::after`).
 */
export function Revenue() {
  return (
    <section className="section" id="revenus">
      <span className="badge">Du CA en plus</span>
      <h2 className="h2 center-h2" style={{ maxWidth: 680 }}>
        Vous venez de voir l&apos;outil. Voici le chiffre d&apos;affaires en plus.
      </h2>
      <p className="body-text rev-lead">
        Deux offres au-dessus de la suite : on installe une <span className="kw">marque de livraison clé en main</span>{" "}
        dans votre cuisine, ou on pilote <span className="kw">votre propre marque</span> sur les plateformes.{" "}
        <strong>Même équipe, même matériel, mêmes horaires.</strong>
      </p>

      <div className="rev-grid">
        <div className="rv">
          <article className="pr-card spot">
            <h5 className="h5">Une 2ᵉ enseigne dans votre cuisine</h5>
            <p className="pr-price sm">
              Vous ne payez <span className="kw">rien</span> pour démarrer
            </p>
            <p className="body-text pr-desc">
              On installe une <strong>marque de livraison toute prête</strong> (Maki-Ya, Pastella, Wings Club, Green
              Bowl…) dans votre cuisine : recettes, formation, comptes Uber Eats &amp; Deliveroo, pub —{" "}
              <strong>on s&apos;occupe de tout</strong>. Vous cuisinez, vous encaissez un{" "}
              <span className="kw">chiffre d&apos;affaires que vous n&apos;aviez pas</span>. Notre part :{" "}
              <strong>8 % de ces ventes</strong>, uniquement quand ça vend.{" "}
              <span className="kw">Premier ticket en 3 semaines</span>.
            </p>
            <a className="btn dark pr-cta" href="#contact">
              Découvrir les 4 marques
            </a>
            <p className="pr-featlabel" style={{ marginTop: 14 }}>
              Concepts <strong>100 % halal</strong> · <span className="kw">CA en plus</span> — sans investissement, sans
              embauche, même équipe.
            </p>
          </article>
        </div>

        <div className="rv" style={{ transitionDelay: "0.1s" }}>
          <article className="pr-card spot">
            <h5 className="h5">Vos ventes Uber Eats, boostées</h5>
            <p className="pr-price sm">dès 99 €/mois</p>
            <p className="body-text pr-desc">
              Vous êtes déjà sur Uber Eats ou Deliveroo, mais ça vend peu ? Nos experts reprennent votre page :{" "}
              <strong>menu réorganisé</strong>, <strong>photos retravaillées</strong>,{" "}
              <strong>promos aux bonnes heures</strong>, avis gérés. Vous ne touchez à rien, vous voyez le résultat sur
              un <strong>rapport clair chaque mois</strong>. Objectif :{" "}
              <span className="kw">+30 % de ventes en livraison en 60 jours</span>.
            </p>
            <a className="btn dark pr-cta" href="#contact">
              Être rappelé
            </a>
            <p className="pr-featlabel" style={{ marginTop: 14 }}>
              Sans engagement · <span className="kw">se rembourse dès le premier mois</span>.
            </p>
          </article>
        </div>
      </div>
    </section>
  );
}
