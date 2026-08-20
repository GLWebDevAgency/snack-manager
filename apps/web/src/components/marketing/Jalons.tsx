import { MILESTONES, section } from "./content";

/**
 * « On date ce qu'on livre. Jamais ce que vous gagnerez. » — la frise du
 * lancement.
 *
 * Quatre jalons, et aucun ne dépend du marché, de la saison ni de la clientèle
 * du restaurateur : ce sont NOS actes. Une date que nous tenons seuls ne peut
 * être démentie que par nous — c'est la seule réponse honnête possible au
 * « +30 % en 60 jours » du concurrent, et la seule qui tienne sans un client.
 *
 * Elle remplace Process, dont le fond survit (on observe, on configure, on
 * reste) mais dont la forme mentait : c'était écrit comme une frise et rendu
 * comme trois cartes identiques à celles qui l'entouraient. On lui rend sa
 * forme.
 *
 * Aucun appel à l'action : la section répond à la peur qui suit le prix — « je
 * vais me retrouver seul avec un truc que personne ne sait utiliser » — et elle
 * ne profite pas du soulagement pour redemander un numéro.
 */
export function Jalons() {
  const { badge, title } = section("lancement");
  const dernier = MILESTONES.length - 1;

  return (
    <section className="section jl-section" id="lancement">
      <div className="section-head jl-head rv">
        {badge ? <span className="badge">{badge}</span> : null}
        <h2 className="h2">{title}</h2>
      </div>

      <ol className="jl-track">
        {MILESTONES.map((jalon, i) => {
          // « Ensuite » n'a pas de date de fin : son point reste ouvert, et le
          // rail s'arrête sur lui au lieu de filer dans le vide.
          const ouvert = i === dernier;
          const [premiere, seconde] = jalon.lines;

          return (
            <li className={ouvert ? "jl-step open rv" : "jl-step rv"} key={jalon.when}>
              <span className="jl-node" aria-hidden="true" />
              <p className="jl-when">{jalon.when}</p>
              <h3 className="jl-title">{jalon.title}</h3>
              <div className="jl-lines">
                <p className="jl-line">{premiere}</p>
                <p className="jl-line dim">{seconde}</p>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
