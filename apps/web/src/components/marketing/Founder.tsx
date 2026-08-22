import { FOUNDER_FACTS, FOUNDER_PHOTO, FOUNDER_QUOTE, PILOTE_PHOTOS, section } from "./content";
import { Photo } from "./Photo";

/**
 * Le pilote — une voix et un collage, à l'endroit où l'on se demande à qui on
 * donne son numéro. C'est la dernière question du parcours, pas la première :
 * l'EXISTENCE du pilote est déjà affirmée en une ligne sous la démonstration
 * (`PILOTE_SIGNATURE`), c'est sa VOIX qui est ici.
 *
 * LES PHOTOS SONT DES VISUELS DE CARTE, PAS UNE PREUVE D'EXPLOITATION. Ce sont
 * des plats du restaurant pilote, pas sa salle ni son équipe : aucune légende
 * ne les commente, elles n'apportent que le registre affectif du métier. La
 * preuve, c'est la commune nommée et la démonstration manipulable deux sections
 * plus haut. Elles ne portent donc pas de légende visible — leur texte
 * alternatif dit exactement ce qu'elles sont.
 */
export function Founder() {
  const { badge, title } = section("histoire");

  return (
    <section className="section fd-section" id="histoire">
      {badge ? <span className="badge">{badge}</span> : null}
      <h2 className="h2 center-h2" style={{ maxWidth: 680 }}>
        {title}
      </h2>

      <article className="fd-card fd-pilote rv spot">
        {/*
         * Un collage, pas une galerie : trois cadres figés, aucun défilement,
         * aucune flèche. Le visuel signature occupe la rangée haute, les deux
         * autres la rangée basse — c'est une illustration de citation, elle ne
         * demande aucun geste au lecteur.
         */}
        <div className="fd-collage">
          <div className="fd-shot lead">
            <Photo shot={FOUNDER_PHOTO} sizes="(max-width: 810px) 90vw, 440px" />
          </div>
          {PILOTE_PHOTOS.map((shot) => (
            <div className="fd-shot" key={shot.src}>
              <Photo shot={shot} sizes="(max-width: 810px) 45vw, 215px" />
            </div>
          ))}
        </div>

        <div className="fd-body">
          <blockquote className="fd-quote">{FOUNDER_QUOTE}</blockquote>
          <p className="fd-name">
            Les fondateurs · <strong>Class&apos;Food</strong>, restaurant pilote — Perriers-sur-Andelle
          </p>
          {/*
           * UN SEUL FAIT, ET LA RANGÉE N'EST PLUS DESSINÉE POUR TROIS. On garde
           * le `map` — il reste juste si la liste regrossit un jour — mais la
           * mise en forme est celle d'une mention isolée, pas d'une file de
           * pastilles à moitié vide.
           */}
          <div className="fd-solofacts">
            {FOUNDER_FACTS.map((f) => (
              <p className="fd-solofact" key={f}>
                {f}
              </p>
            ))}
          </div>
        </div>
      </article>
    </section>
  );
}
