"use client";

import { useId } from "react";
import { Icon } from "@/components/ui";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * LA MATIÈRE DE LA CARTE DE SOLDE — DES COUCHES, PAS UN APLAT
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Le constat du fondateur sur la capture de son pilote : « ça manque de
 * premium ». Il avait raison, et le défaut se nomme — le bloc du solde était
 * un rectangle arrondi, un voile d'encre à 5 % (`--cf-card-gradient`) et une
 * tache d'accent floutée dans un coin. Propre, et plat.
 *
 * Ce composant pose ce qui manquait : un halo directionnel, un GUILLOCHÉ —
 * les arcs concentriques fins d'une carte bancaire — et un lustre diagonal.
 * Trois couches, toutes lues de l'accent du restaurant, toutes à très faible
 * opacité.
 *
 * ═══ POURQUOI UN SVG ET NON TROIS `div` FLOUTÉES ═══
 *
 * Un `blur-3xl` sur une div est un flou de COMPOSITION : le navigateur crée
 * une couche, la floute, la recompose — et sur un mobile d'entrée de gamme,
 * chaque défilement la repasse. Ici les trois couches sont des dégradés SVG
 * dans un seul nœud : aucun filtre, aucune couche supplémentaire, et le
 * dessin reste net à toutes les densités.
 *
 * ═══ POURQUOI TOUT VIENT DE L'ACCENT, ET SEULEMENT DE LUI ═══
 *
 * L'écueil de cette surface est connu et déjà rencontré : un dégradé accordé
 * sur Nuit devient une auréole sale sur Brasserie. La parade n'est pas de
 * doser six fois, c'est de n'employer qu'UNE teinte — celle du restaurant — à
 * des opacités que le masque définit déjà. Le plus fort de ces voiles vaut
 * exactement `--cf-accent-wash` (12 %, l'unique lavis d'accent du produit) ;
 * les autres sont plus faibles encore. Aucune direction ne peut donc virer
 * d'une couleur qu'elle ne porte pas.
 *
 * ═══ ET LE SOLDE RESTE LE PLUS FORT ═══
 *
 * Rien ici ne dépasse 12 % d'opacité et rien n'est peint en `--cf-text`. Le
 * solde, lui, est de l'encre pleine à ~50 px : l'écart de valeur entre la
 * matière et le chiffre reste d'un ordre de grandeur. Un effet qui volerait
 * la vedette au solde serait un effet raté.
 */
export function MatiereCarte() {
  const id = useId();
  const halo = `${id}-halo`;
  const lustre = `${id}-lustre`;

  /*
   * LE CENTRE DU GUILLOCHÉ, hors du cadre en haut à droite : les arcs entrent
   * dans la carte par le coin d'où vient la lumière et la traversent en
   * s'élargissant. Centrés DANS le cadre, ils auraient dessiné une cible.
   */
  const cx = 352;
  const cy = 14;

  return (
    <svg
      className="pointer-events-none absolute inset-0 size-full"
      viewBox="0 0 400 260"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <radialGradient id={halo} cx="0.88" cy="0.06" r="0.72">
          <stop offset="0" stopColor="var(--cf-accent)" stopOpacity="0.12" />
          <stop offset="1" stopColor="var(--cf-accent)" stopOpacity="0" />
        </radialGradient>
        {/*
         * LE LUSTRE — une bande de lumière en travers, éteinte avant la moitié.
         * Elle part du même coin que le halo : une seule source de lumière sur
         * la carte, sinon l'objet cesse d'en être un.
         */}
        <linearGradient id={lustre} x1="1" y1="0" x2="0.15" y2="1">
          <stop offset="0" stopColor="var(--cf-accent)" stopOpacity="0.09" />
          <stop offset="0.42" stopColor="var(--cf-accent)" stopOpacity="0" />
        </linearGradient>
      </defs>

      <rect width="400" height="260" fill={`url(#${lustre})`} />
      <rect width="400" height="260" fill={`url(#${halo})`} />

      {/*
       * LE GUILLOCHÉ. Sept arcs concentriques, tracés à 1 unité et à 7 %
       * d'accent : c'est la texture d'une carte imprimée, celle qu'on voit
       * quand on incline l'objet et qu'on oublie sinon. Débordant largement du
       * cadre, ils sont rognés par l'`overflow-hidden` de la carte — d'où des
       * ARCS et non des anneaux.
       *
       * `vectorEffect` non : l'échelle non uniforme de `preserveAspectRatio`
       * étire volontairement ces arcs, comme la surface d'un objet plus large
       * que haut. Ce qu'on ne veut pas étirer, c'est le SCEAU — lui est rendu
       * dans son propre repère (voir `SceauRecompense`).
       */}
      <g fill="none" stroke="var(--cf-accent)" strokeOpacity="0.07" strokeWidth="1">
        {[54, 86, 118, 150, 182, 214, 246].map((r) => (
          <circle key={r} cx={cx} cy={cy} r={r} />
        ))}
      </g>
    </svg>
  );
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * LE SCEAU DE RÉCOMPENSE — un objet dessiné, pas un pictogramme égaré
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Ce qu'il remplace : un cadeau de 19 px posé seul dans le coin de la carte,
 * qui se lisait comme une icône de barre d'outils oubliée là.
 *
 * Le dessin est celui d'un TAMPON : un anneau perforé — les pointillés d'un
 * ticket qu'on détache —, un disque de lavis d'accent, et le cadeau au centre.
 * C'est la même figure que les trois tampons de l'icône de lancement : l'objet
 * installé et l'objet à l'écran racontent la même chose.
 *
 * ═══ LES DEUX COULEURS SONT DÉJÀ PROUVÉES ═══
 *
 * Le disque est `--cf-accent-wash`, et le cadeau `--cf-accent-ink`. Ce couple
 * précis (`accentInk/accentWash`) est l'un de ceux que `contraste()` vérifie
 * sur les six directions — c'est même pour LUI que le lavis a été ajouté à la
 * liste des fonds. Rien à mesurer de plus ici : la garantie existe déjà.
 *
 * L'anneau, lui, est décoratif au sens de WCAG 1.4.11 — il ne porte aucune
 * information que le reste de la carte ne dise (la jauge dit la progression,
 * le catalogue dit les paliers). Il n'a donc pas de plancher à tenir, et il
 * est volontairement discret.
 */
export function SceauRecompense({ className }: { className?: string }) {
  return (
    <span
      className={className ? `relative shrink-0 ${className}` : "relative shrink-0"}
      aria-hidden="true"
    >
      <svg width="56" height="56" viewBox="0 0 56 56" fill="none" focusable="false">
        {/* L'anneau perforé — le bord d'un ticket qu'on détache. */}
        <circle
          cx="28"
          cy="28"
          r="26.5"
          stroke="var(--cf-accent)"
          strokeOpacity="0.4"
          strokeWidth="1.25"
          strokeDasharray="2 5"
          strokeLinecap="round"
        />
        <circle cx="28" cy="28" r="21.5" fill="var(--cf-accent-wash)" />
        <circle cx="28" cy="28" r="21.5" stroke="var(--cf-accent)" strokeOpacity="0.28" />
      </svg>
      {/* Le cadeau, centré dans le disque et posé sur le lavis : couple prouvé. */}
      <Icon
        name="gift"
        size={24}
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-accentink"
      />
    </span>
  );
}
