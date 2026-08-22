import { HARDWARE, HARDWARE_OFFLINE, HARDWARE_PATHS, section, type HardwareItem } from "./content";
import { MtEcran, MtImprimante, MtReseau, MtTablette } from "./icons";

/**
 * Le pictogramme est choisi par l'`id` de l'article, jamais par son rang :
 * réordonner `HARDWARE` ne doit pas décaler les dessins.
 */
const PICTO: Record<HardwareItem["id"], React.ReactNode> = {
  tablette: <MtTablette />,
  imprimante: <MtImprimante />,
  ecran: <MtEcran />,
  reseau: <MtReseau />,
};

/**
 * « Rien à racheter. Et rien ne s'arrête quand le réseau tombe. » — quatre
 * pictogrammes, quatre lignes de six mots, zéro prose.
 *
 * C'est la question qui bloque le plus (« est-ce que ça marche chez MOI, dans
 * MA cuisine ? ») et la page n'y répondait qu'en sixième et huitième position
 * d'un accordéon. Elle est promue juste après la démonstration, là où elle se
 * pose vraiment.
 *
 * C'est aussi la respiration la plus COURTE de la page, posée juste avant la
 * plus commerciale : toute phrase ajoutée ici la détruit. D'où l'absence de
 * carte, de fond et d'encadré — quatre colonnes de texte nu sous quatre traits.
 *
 * Le hors-ligne, lui, prend la forme d'un demi-titre et pas d'une cinquième
 * colonne : c'est notre vrai différenciant, le ranger dans une pastille de
 * fonctionnalité le gâcherait.
 */
export function Materiel() {
  const { badge, title } = section("materiel");

  return (
    <section className="section mt-section" id="materiel">
      <div className="section-head mt-head rv">
        {badge ? <span className="badge">{badge}</span> : null}
        <h2 className="h2">{title}</h2>
      </div>

      <ul className="mt-grid rv">
        {HARDWARE.map((item) => (
          <li className="mt-item" key={item.id}>
            <span className="mt-picto" aria-hidden="true">
              {PICTO[item.id]}
            </span>
            <p className="mt-label">{item.label}</p>
            <p className="mt-line">{item.line}</p>
          </li>
        ))}
      </ul>

      {/*
       * LES DEUX VOIES, DANS CET ORDRE. Celle qui ne coûte rien d'abord :
       * proposer l'installation avant de dire qu'elle est facultative ferait
       * lire un supplément obligatoire, et la question de la section est
       * justement « est-ce que ça marche chez moi », pas « combien en plus ».
       */}
      <ul className="mt-paths rv">
        {HARDWARE_PATHS.map((path) => (
          <li className="mt-path" key={path.id}>
            <div className="mt-pathhead">
              <h3 className="mt-pathtitle">{path.title}</h3>
              <span className="mt-pathprice">{path.price}</span>
            </div>
            <p className="mt-pathline">{path.line}</p>
          </li>
        ))}
      </ul>

      <div className="mt-offline rv">
        <p className="mt-offlinelead">{HARDWARE_OFFLINE.lead}</p>
        <p className="mt-offlineline">{HARDWARE_OFFLINE.line}</p>
      </div>
    </section>
  );
}
