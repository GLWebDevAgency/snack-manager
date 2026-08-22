"use client";

import { useId } from "react";
import {
  DECOUPE_ECLAIR,
  ECLAIR,
  GARNITURE,
  GARNITURE_MICRO,
  LAITON,
  PAIN_BAS,
  PAIN_HAUT,
  SEUIL_MICRO,
  TICKET,
  TRAIT_MICRO,
  TRAIT_STANDARD,
} from "./geometry";

export { LAITON, SEUIL_MICRO } from "./geometry";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * LE TICKET-BURGER — MARQUE SNACK MANAGER
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Ce fichier est la SOURCE UNIQUE de la géométrie du logo. Tout le reste —
 * favicon, icônes d'application, image de partage, tampon des tickets — en est
 * dérivé, et doit le rester : un logo redessiné à la main quelque part est un
 * logo qui divergera.
 *
 * TROIS SIGNES EMBOÎTÉS, UN SEUL DESSIN :
 *
 *   · LE CADRE — un ticket au bord déchiré. L'objet du métier, celui qu'on
 *     griffonnait avant nous.
 *   · LE BURGER — trois barres. Le snack, et l'icône « menu » du logiciel.
 *   · L'ÉCLAIR — la commande qui fend le rush.
 *
 * ═══ L'ÉCLAIR EST UN VIDE, PAS UNE COULEUR ═══
 *
 * C'est l'idée centrale du dessin et la contrainte qui gouverne tout le
 * fichier : l'éclair n'est pas peint, il est ÉVIDÉ. Il laisse voir le fond,
 * quel qu'il soit. D'où deux conséquences qu'on ne peut pas contourner :
 *
 * 1. Le logo réclame un FOND UNI derrière lui. Posé sur une photographie ou un
 *    dégradé, l'éclair laisse passer l'image et le signe se brouille. Sur la
 *    vitrine, `.mk` garantit ce fond ; ailleurs, c'est au poseur d'y veiller.
 * 2. L'évidement passe par un `<mask>` SVG, donc par un identifiant.
 *
 * ═══ POURQUOI `useId` ET PAS UN SPRITE PARTAGÉ ═══
 *
 * La planche d'origine pose le masque UNE fois, dans un `<svg>` caché à la
 * racine du document, et chaque logo y renvoie. C'est élégant sur une page
 * unique. Dans une application, c'est un piège : le jour où un logo est rendu
 * dans un document qui n'a pas le sprite — une iframe de démonstration, un
 * courriel, une autre application de la suite — la référence tombe dans le
 * vide. Et les navigateurs ne s'accordent pas sur ce qu'il faut faire alors :
 * la spécification SVG 1.1 dit de ne RIEN rendre, CSS Masking dit d'ignorer le
 * masque. Selon le navigateur, on perd donc soit l'éclair, soit le burger
 * entier — sans rien qui le signale.
 *
 * Chaque instance porte donc son propre masque, avec un identifiant unique
 * rendu par `useId` (stable entre le serveur et le client, donc sans écart
 * d'hydratation). Le coût est de quelques centaines d'octets répétés ; le gain
 * est un composant qui marche partout où on le pose, sans rien à monter
 * ailleurs. C'est ce qui justifie le `"use client"` sur un composant aussi
 * simple : `useId` est un hook, il n'existe pas dans un composant serveur.
 *
 * ═══ DEUX GRAVURES SELON LA TAILLE ═══
 *
 * Sous 20 px, l'éclair se referme : ses contre-formes deviennent plus fines
 * qu'un pixel et le signe tourne à la tache. La version micro garde le ticket
 * et le burger, supprime l'évidement, et ÉPAISSIT le trait du cadre (2,4 au
 * lieu de 2,1) pour qu'il tienne encore. C'est le réflexe des grandes marques :
 * un seul mark, deux gravures.
 *
 * Ce choix n'est PAS laissé à l'appelant. `<LogoMark size={16} />` sert la
 * micro tout seul. Un `variant` explicite existe pour les cas délibérés —
 * un rendu à 16 px destiné à être agrandi, par exemple — mais le défaut est
 * juste, et personne ne peut se tromper par omission.
 */

export type LogoTone = "mono" | "duo";
export type LogoVariant = "auto" | "standard" | "micro";

export type LogoMarkProps = {
  /** Côté du carré de rendu, en pixels. Décide seul de la gravure. */
  size?: number;
  /**
   * `mono` — tout le signe en `currentColor`. C'est le défaut, et le cas le
   * plus fréquent : barre de navigation, pied de page, favicon, tampon.
   * `duo` — la garniture passe au laiton. Réservé aux tailles où le détail se
   * voit (≥ 52 px) : héros, planche de marque, écran d'accueil.
   */
  tone?: LogoTone;
  /** Forcer une gravure. À n'employer que délibérément — voir l'en-tête. */
  variant?: LogoVariant;
  /**
   * Texte alternatif. Absent, le signe est décoratif (`aria-hidden`) — c'est
   * le bon défaut quand il est posé DANS un lien qui porte déjà son libellé,
   * ce qui est le cas de tous ses emplois en en-tête et en pied de page.
   */
  label?: string;
  className?: string;
  style?: React.CSSProperties;
};

/**
 * Le mark seul, sans le nom.
 *
 * La couleur du signe suit `currentColor` : posez-le dans un conteneur clair
 * ou sombre, il suit. La garniture bichrome, elle, lit
 * `--sm-logo-accent` et retombe sur le laiton.
 *
 * ═══ POURQUOI L'ACCENT EST UNE VARIABLE ET NON `#c9a15a` EN DUR ═══
 *
 * La planche d'origine code le laiton en dur dans le symbole bichrome — et
 * elle porte, dans sa feuille de style, des règles qui prévoient de l'inverser
 * sur fond clair et sur fond laiton (`.tile.inv .duo .accent`,
 * `.tile.br .duo .accent`) sans jamais y être branchées. Ces règles ont
 * raison : sur une tuile laiton, une garniture laiton DISPARAÎT. La variable
 * rétablit ce que la planche avait prévu — `--sm-logo-accent: currentColor`
 * suffit alors à rendre la garniture lisible.
 */
export function LogoMark({
  size = 25,
  tone = "mono",
  variant = "auto",
  label,
  className,
  style,
}: LogoMarkProps) {
  const masqueId = useId();
  const micro = variant === "micro" || (variant === "auto" && size < SEUIL_MICRO);

  // La garniture est le seul élément qui puisse quitter `currentColor`.
  const remplissageGarniture =
    tone === "duo" ? `var(--sm-logo-accent, ${LAITON})` : "currentColor";

  const accessibilite = label
    ? ({ role: "img" as const, "aria-label": label })
    : ({ "aria-hidden": true as const });

  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      className={className}
      style={style}
      {...accessibilite}
    >
      {/*
       * LE CADRE EST TRACÉ, PAS REMPLI. `stroke-linejoin: round` adoucit les
       * dents du bord déchiré — anguleuses, elles se lisent comme un défaut de
       * rendu plutôt que comme une déchirure.
       */}
      <path
        d={TICKET}
        fill="none"
        stroke="currentColor"
        strokeWidth={micro ? TRAIT_MICRO : TRAIT_STANDARD}
        strokeLinejoin="round"
        strokeLinecap="round"
      />

      {micro ? (
        <>
          <path d={PAIN_HAUT} fill="currentColor" />
          <path d={GARNITURE_MICRO} fill={remplissageGarniture} />
          <path d={PAIN_BAS} fill="currentColor" />
        </>
      ) : (
        <>
          <mask id={masqueId} maskUnits="userSpaceOnUse" x="0" y="0" width="32" height="32">
            {/* Blanc = on garde, noir = on creuse. */}
            <rect width="32" height="32" fill="#fff" />
            <path
              d={ECLAIR}
              fill="#000"
              stroke="#000"
              strokeWidth={DECOUPE_ECLAIR}
              strokeLinejoin="round"
            />
          </mask>
          <g mask={`url(#${masqueId})`}>
            <path d={PAIN_HAUT} fill="currentColor" />
            <path d={GARNITURE} fill={remplissageGarniture} />
            <path d={PAIN_BAS} fill="currentColor" />
          </g>
        </>
      )}
    </svg>
  );
}

export type LogoLockupProps = Omit<LogoMarkProps, "label"> & {
  /** Libellé du groupe entier. Le mark redevient décoratif à l'intérieur. */
  label?: string;
};

/**
 * Le verrouillage : le mark et le nom, solidaires.
 *
 * « Snack » porte le poids, « Manager » s'efface — c'est ce contraste qui fait
 * lire un nom et non deux mots. Le second suit `--sm-logo-mut` pour pouvoir
 * s'adapter au fond : sur fond sombre un blanc à 55 %, sur fond clair un gris
 * chaud. Sans cette variable, « Manager » posé sur blanc resterait blanc.
 *
 * LES PROPORTIONS SONT DÉRIVÉES DE LA TAILLE DU MARK, pas fixées. La planche
 * verrouille un mark de 34 px avec un nom de 21 px : c'est ce rapport de 0,62
 * qui est reporté ici, pour que le groupe reste juste à toutes les échelles.
 */
export function LogoLockup({
  size = 34,
  tone = "mono",
  variant = "auto",
  label = "Snack Manager",
  className,
  style,
}: LogoLockupProps) {
  return (
    <span
      className={className ? `sm-lockup ${className}` : "sm-lockup"}
      role="img"
      aria-label={label}
      style={{ ...style, ["--sm-lockup-size" as string]: `${size}px` }}
    >
      <LogoMark size={size} tone={tone} variant={variant} />
      <span className="sm-lockup-nom" aria-hidden="true">
        Snack <i>Manager</i>
      </span>
    </span>
  );
}
