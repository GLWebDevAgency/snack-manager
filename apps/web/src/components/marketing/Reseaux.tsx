import { RESEAUX_PUBLIÉS } from "./content";
import { RESEAU_ICONS } from "./icons";

/**
 * La rangée de réseaux sociaux — un seul composant pour les DEUX endroits où
 * elle apparaît.
 *
 * Elle est écrite une fois parce qu'elle a une règle à ne pas oublier deux
 * fois : ON NE REND QUE LES COMPTES QUI EXISTENT. `RESEAUX_PUBLIÉS` (content.ts)
 * ne contient que les lignes dont l'URL est renseignée ; aujourd'hui elle est
 * vide, et ce composant rend alors `null` — pas une rangée vide, pas un filet
 * orphelin, RIEN. Le hero et le pied de page sortent exactement le balisage
 * qu'ils sortaient avant l'existence de ce fichier.
 *
 * Conséquence à garder en tête en relecture : tant que le fondateur n'a pas
 * donné une adresse, ce composant est invisible en développement comme en
 * production. Il ne se vérifie qu'en renseignant temporairement une URL dans
 * `RESEAUX`.
 *
 * ═══ POURQUOI LA VARIANTE « hero » EXISTE, ET POURQUOI ELLE EST DISCRÈTE ═══
 *
 * Le hero n'a qu'un travail : ouvrir une porte. Il porte déjà deux appels —
 * « Prendre une commande en démo » et « Être rappelé » — et quatre icônes
 * posées à leur hauteur leur voleraient le regard : sur un premier écran, tout
 * ce qui est cliquable concurrence ce qu'on veut faire cliquer, et un
 * pictogramme rond attire l'œil mieux qu'un bouton rectangulaire.
 *
 * Elles sont donc SOUS les boutons, sans libellé, en blanc à 50 %, à la taille
 * du texte courant et non à celle d'un appel à l'action. Le visiteur qui les
 * cherche les trouve ; celui qui lit le titre ne les voit pas. C'est le seul
 * arbitrage qui satisfait la demande du fondateur — les réseaux sont bien dans
 * le hero — sans coûter au bouton la moitié de son attention.
 *
 * `rel="me"` : la déclaration standard « ce compte est le nôtre ». Elle sert à
 * la vérification croisée des profils, ce qui est précisément la raison pour
 * laquelle on affiche ces liens.
 */
export function Reseaux({ variant }: { variant: "hero" | "pied" }) {
  if (RESEAUX_PUBLIÉS.length === 0) return null;

  return (
    <ul className={variant === "hero" ? "rs-row rs-hero" : "rs-row rs-pied"}>
      {RESEAUX_PUBLIÉS.map((reseau) => {
        const Picto = RESEAU_ICONS[reseau.id];
        return (
          <li key={reseau.id}>
            <a
              className="rs-link"
              href={reseau.url}
              // Un lien sortant vers un compte tiers : nouvelle fenêtre, et
              // `noopener` sans quoi la page ouverte garde une poignée sur la
              // nôtre via `window.opener`.
              target="_blank"
              rel="me noopener noreferrer"
              // Le dessin est `aria-hidden` : sans ce libellé, le lien serait
              // annoncé « lien » et rien d'autre.
              aria-label={`Snack Manager sur ${reseau.nom}`}
              title={reseau.nom}
            >
              <Picto size={variant === "hero" ? 17 : 18} />
            </a>
          </li>
        );
      })}
    </ul>
  );
}
