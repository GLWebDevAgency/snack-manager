"use client";

import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { DEVICE_SCREEN, type DemoDevice } from "./content";

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
 * Quatre châssis, un par usage réel du terrain :
 *   · `tablet` — tablette en paysage : la caisse du comptoir ;
 *   · `wall`   — moniteur accroché au mur : l'écran cuisine, lu depuis le
 *                piano. 16/9, comme tous les murals du commerce ;
 *   · `phone`  — téléphone : la commande client ;
 *   · `wide`   — écran d'ordinateur sur pied : le back-office du gérant.
 *
 * Le contenu (affiche ou iframe) est passé en `children` : le châssis ne sait
 * pas ce qu'il encadre, et n'a donc rien à démonter quand la démo s'arrête.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * L'APPLICATION EMBARQUÉE REÇOIT SA VRAIE RÉSOLUTION, PUIS ON LA RÉDUIT
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * LE DÉFAUT CORRIGÉ ICI. Une iframe posée en `width: 100%` dans un cadre de
 * 844 px fait croire à l'application qu'elle tourne sur un écran de 844 px.
 * Elle se met alors en page pour un petit écran — et ce n'est pas un détail
 * cosmétique, c'est le produit qui disparaît :
 *
 *   · l'écran cuisine, sous les 900 px de `TABS_MAX_WIDTH`, remplaçait ses
 *     TROIS COLONNES par des onglets et escamotait le panneau « À lancer » —
 *     très exactement ce que la démonstration existe pour montrer ;
 *   · le back-office repliait sa rangée de cartes sous ~1150 px : la mise en
 *     page d'un petit portable, jamais celle de l'ordinateur du gérant.
 *
 * LE PRINCIPE. On donne à l'iframe la taille EXACTE de l'appareil réel
 * (`DEVICE_SCREEN`), en pixels absolus, puis on la réduit optiquement dans le
 * cadre (`transform: scale`, origine en haut à gauche, `overflow: hidden` sur
 * l'écran). L'application compose donc sa vraie mise en page ; le visiteur la
 * voit en réduction, comme s'il regardait l'écran de loin. Les clics et le
 * défilement continuent de tomber juste — le navigateur applique la matrice de
 * transformation aux coordonnées de pointeur, on n'a rien à corriger.
 *
 * POURQUOI LE FACTEUR EST CALCULÉ ICI ET PAS ÉCRIT EN CSS. Il l'était : quatre
 * constantes à la main, redoublées à chaque point de rupture. Deux défauts, et
 * le second est vicieux. D'abord le doublon — changer la hauteur de la scène
 * obligeait à recalculer quatre nombres, et rien ne prévenait quand on oubliait.
 * Ensuite la fausse précision : la largeur du cadre suit celle de la fenêtre
 * (`min(1160px, 92%)`), donc entre deux points de rupture un facteur figé donne
 * à l'application une résolution QUI N'EST PLUS CELLE VISÉE — une cuisine qui
 * se croit en 1730 px, par exemple, redescend sous des seuils qu'on pensait
 * franchis. Le facteur est ici une CONSÉQUENCE mesurée de la largeur réellement
 * dessinée, relevée par un `ResizeObserver` : à toute largeur de fenêtre,
 * l'application voit exactement `DEVICE_SCREEN`, ni plus ni moins.
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
 * Ce rapport n'est plus saisi à la main non plus : il DÉCOULE de la résolution
 * de l'appareil (`--dv-ar`, calculé plus bas). Un cadre ne peut donc plus
 * diverger de l'application qu'il encadre — ni de l'affiche, capturée aux
 * mêmes dimensions par `scripts/capture-shots.mjs`.
 */
export function DeviceFrame({ device, children }: { device: DemoDevice; children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  const screen = useRef<HTMLDivElement>(null);
  const { w, h } = DEVICE_SCREEN[device];

  /*
   * Le facteur de réduction, relevé sur l'écran RÉELLEMENT dessiné.
   *
   * On écrit `--dv-zoom` plutôt que de piloter le style de l'iframe : celle-ci
   * n'existe pas tant que le visiteur n'a pas cliqué « Essayer » (rien ne
   * charge avant, c'est la promesse de la scène), et une variable déjà posée
   * sur le châssis s'applique à la milliseconde où l'iframe se monte — sans
   * premier rendu à la mauvaise taille, donc sans reflow visible.
   *
   * `ResizeObserver` et non un écouteur `resize` : le cadre bouge aussi quand
   * la scène change de hauteur (bascule petit écran, changement d'appareil),
   * ce qu'un écouteur de fenêtre ne voit pas.
   *
   * ─── LA LARGEUR DE MISE EN PAGE, JAMAIS LA LARGEUR VUE ───
   *
   * `getBoundingClientRect()` renverrait la largeur APRÈS transformation — et
   * la scène est un carrousel 3D : au moment où l'on observe, la carte est le
   * plus souvent de côté (`rotateY(28deg) translateZ(-540px)`) ou hors-champ,
   * donc rétrécie par la perspective. Relevé ainsi, le back-office recevait un
   * facteur de 0,58 au lieu de 0,79 : la mise en page était juste, mais
   * l'application flottait dans un coin de son cadre, deux fois trop petite.
   * Défaut vu à l'écran, jamais en revue de code — les deux mesures ont le
   * même nom et la même unité.
   *
   * `getComputedStyle().width` donne la valeur UTILISÉE de la mise en page :
   * insensible aux transformations, et fractionnaire (là où `clientWidth`
   * arrondit et laisserait un liseré noir sous certaines largeurs de fenêtre).
   */
  useEffect(() => {
    const el = screen.current;
    const host = root.current;
    if (!el || !host) return;

    const apply = () => {
      const drawn = parseFloat(getComputedStyle(el).width);
      // Carte hors-champ, section repliée : une largeur nulle donnerait un
      // facteur nul, donc une iframe écrasée à la remontée. On garde la
      // dernière valeur valide.
      if (!Number.isFinite(drawn) || drawn <= 0) return;
      host.style.setProperty("--dv-zoom", String(drawn / w));
    };

    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, [w]);

  return (
    <div
      ref={root}
      className={`dv dv-${device}`}
      /*
       * La résolution de l'appareil descend en CSS : elle y sert deux fois, et
       * c'est ce qui interdit à la forme du cadre de diverger de l'application.
       *   · `--dv-ar` (le rapport de l'écran) en est le quotient ;
       *   · `.dv-live` y prend ses dimensions en pixels absolus.
       */
      style={{ "--dv-app-w": w, "--dv-app-h": h } as CSSProperties}
    >
      <div className="dv-chassis">
        {/* Objectif (tablette), pilule (téléphone), témoin de veille (écrans). */}
        <span className="dv-cam" aria-hidden="true" />
        <div className="dv-screen" ref={screen}>
          {children}
        </div>
      </div>
      {device === "wide" ? <span className="dv-stand" aria-hidden="true" /> : null}
      {/* Le mural est accroché, pas posé : une patte, pas un pied. */}
      {device === "wall" ? <span className="dv-mount" aria-hidden="true" /> : null}
    </div>
  );
}
