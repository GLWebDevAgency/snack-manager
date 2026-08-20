import type { ReactNode } from "react";
import type { DemoDevice } from "./content";

/**
 * Châssis d'appareil, dessiné entièrement en CSS.
 *
 * POURQUOI PAS UNE IMAGE : la vitrine porte déjà 1 Mo de captures ; un mockup
 * PNG par appareil ajouterait autant sans rien apprendre au visiteur. Bordures,
 * coins et profondeur sont des dégradés et des ombres — quelques centaines
 * d'octets, nets à tous les facteurs de zoom, et qui suivent les tokens de la
 * charte (surfaces stratifiées, jamais deux valeurs identiques côte à côte).
 *
 * CE QUE ÇA CHANGE POUR LE LECTEUR : une capture rognée dans un rectangle, ça
 * reste une plaquette. La même capture dans une tablette posée en paysage, avec
 * son objectif et son épaisseur, c'est le comptoir du snack. C'est toute la
 * différence entre « ils vendent un logiciel » et « ça marcherait chez moi ».
 *
 * Trois châssis, un par usage réel du terrain :
 *   · `tablet` — tablette en paysage : la caisse et l'écran cuisine ;
 *   · `phone`  — téléphone : la commande client ;
 *   · `wide`   — écran large sur pied : le back-office du gérant et, le jour
 *                où sa démonstration existera, l'écran de menu en salle.
 *
 * Le contenu (affiche ou iframe) est passé en `children` : le châssis ne sait
 * pas ce qu'il encadre, et n'a donc rien à démonter quand la démo s'arrête.
 */
export function DeviceFrame({ device, children }: { device: DemoDevice; children: ReactNode }) {
  return (
    <div className={`dv dv-${device}`}>
      <div className="dv-chassis">
        {/* Objectif (tablette), pilule (téléphone), témoin de veille (écran). */}
        <span className="dv-cam" aria-hidden="true" />
        <div className="dv-screen">{children}</div>
      </div>
      {device === "wide" ? <span className="dv-stand" aria-hidden="true" /> : null}
    </div>
  );
}
