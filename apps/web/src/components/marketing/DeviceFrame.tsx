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
 *
 * ─── OÙ VIT LA FORME, ET POURQUOI CE N'EST PAS ICI ───
 *
 * Ce composant ne pose aucune dimension. La forme de l'appareil est calculée
 * en CSS (`marketing.css`, section « Châssis d'appareils »), et dans un ordre
 * qui compte : LE RAPPORT D'ASPECT PORTE SUR `.dv-screen`, l'épaisseur du
 * châssis s'ajoute autour. L'inverse — le rapport posé sur le châssis, comme
 * c'était le cas — déformait la zone d'écran de l'épaisseur des bordures :
 * l'écran de la tablette tombait à 1,476 pour une capture en 1,600, et
 * `object-fit: cover` rognait 8 % de largeur. Sur l'écran cuisine, c'était une
 * colonne entière coupée sur l'affiche censée convaincre.
 *
 * Conséquence pratique : changer la tranche d'un appareil (`--dv-px`,
 * `--dv-pt`, `--dv-pb`) ne peut plus déformer son écran. Changer le rapport
 * `--dv-ar`, si — il doit rester celui de la capture ET de l'appareil réel.
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
