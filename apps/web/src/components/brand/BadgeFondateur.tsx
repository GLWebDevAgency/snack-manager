import { LogoMark } from "./Logo";
import { cx } from "@/lib/cx";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * LE BADGE FONDATEUR — un signe, un seul, partout
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Dix places fondateur ont été vendues à moitié prix pendant douze mois. Ces
 * clients-là sont les premiers à nous avoir fait confiance : quand leur nom
 * apparaît quelque part, l'équipe doit le savoir SANS avoir à ouvrir la fiche.
 *
 * ── CE QUI EXISTAIT, ET POURQUOI ÇA NE TENAIT PAS ─────────────────────────
 *
 * Une étoile `Icon name="star"`, recopiée à trois endroits, à trois tailles
 * différentes (14, 15 et 17 px), et teintée en `text-accent`. Trois défauts,
 * chacun suffisant :
 *
 * 1. L'ÉTOILE NE VEUT RIEN DIRE. Elle sert de « favori », de « noté », de
 *    « recommandé » dans à peu près toutes les interfaces du monde. Un signe
 *    qui pourrait vouloir dire quatre choses n'en dit aucune.
 *
 * 2. `text-accent` EST LA COULEUR DU RESTAURANT, remplacée au runtime par la
 *    sienne (voir l'en-tête de `globals.css`). Le marqueur de NOTRE offre
 *    prenait donc la couleur du client — et devenait invisible chez celui qui
 *    a choisi une teinte proche.
 *
 * 3. Trois tailles pour un même signe : l'œil ne le reconnaît plus d'un écran
 *    à l'autre, il le relit.
 *
 * ── LE SIGNE RETENU ───────────────────────────────────────────────────────
 *
 * Notre propre marque, en laiton, dans un cercle. Il ne peut vouloir dire que
 * ce qu'il veut dire : « celui-là est avec nous depuis le début ».
 *
 * Le laiton vient de `--cf-gold` via `text-gold` — FIXE, jamais la couleur du
 * tenant. C'est la même séparation que `--sm-logo-accent` défend dans
 * `globals.css` : notre marque ne se repeint pas aux couleurs d'un client.
 *
 * ── POURQUOI UN CERCLE CREUX ET NON UNE PASTILLE PLEINE ───────────────────
 *
 * Charte §09 : « ne jamais poser la version duo sur un fond laiton — un steak
 * laiton sur une tuile laiton ne se voit pas ». Un logo doré sur un disque
 * doré disparaîtrait. Le cercle est donc SOMBRE et légèrement teinté, cerclé
 * de laiton : le signe s'y détache, et le badge reste discret dans une liste
 * de quarante lignes — ce qu'une pastille pleine ne serait pas.
 *
 * Le logo passe en gravure `micro` sous 20 px (`SEUIL_MICRO`) et en
 * monochrome sous 48 px (`PLANCHER_DUO`) : `LogoMark` s'en charge seul, on ne
 * force rien ici.
 */

/**
 * Ce que le badge signale — un lead et un client ne sont pas au même stade.
 *
 * `reserve` : la place est POSÉE sur un lead, rien n'est signé. Le contour est
 * plus discret, parce que ce n'est pas encore un fait.
 * `acquis` : le client EST fondateur. Sa remise court, son offre est signée.
 */
export type StatutFondateur = "reserve" | "acquis";

const INFOBULLE: Record<StatutFondateur, string> = {
  reserve: "Place fondateur réservée — moitié prix pendant douze mois à la signature",
  acquis: "Client fondateur — moitié prix sur son contrat, douze mois",
};

const INTITULE: Record<StatutFondateur, string> = {
  reserve: "Place fondateur réservée",
  acquis: "Client fondateur",
};

export function BadgeFondateur({
  statut = "acquis",
  size = 22,
  className,
}: {
  statut?: StatutFondateur;
  /** Diamètre du cercle. 22 px dans les listes, 26 sur une fiche. */
  size?: number;
  className?: string;
}) {
  return (
    <span
      // `role="img"` avec un intitulé : le badge PORTE une information, il
      // n'est pas décoratif. Sans cela, un lecteur d'écran annonce le nom du
      // client sans dire qu'il est fondateur — soit le contraire du but.
      role="img"
      aria-label={INTITULE[statut]}
      title={INFOBULLE[statut]}
      style={{ width: size, height: size }}
      className={cx(
        "inline-grid shrink-0 place-items-center rounded-full border text-gold",
        // Un cercle SOMBRE et cerclé, jamais un disque plein : le laiton du
        // signe doit se détacher de son fond (charte §09).
        statut === "acquis"
          ? "border-gold/45 bg-gold/12"
          : "border-gold/30 bg-gold/6 opacity-90",
        className,
      )}
    >
      {/*
        `Math.round(size * 0.62)` : le signe occupe un peu moins des deux tiers
        du cercle, ce qui laisse au laiton du contour de quoi se lire. Plus
        gros, le ticket touche le bord ; plus petit, il devient un point.
      */}
      {/* Sans `label`, `LogoMark` se pose en `aria-hidden` : c'est le bon
          défaut ici, le `<span>` ci-dessus portant déjà l'intitulé. Deux
          annonces pour un seul signe feraient bégayer le lecteur d'écran. */}
      <LogoMark size={Math.round(size * 0.62)} />
    </span>
  );
}
