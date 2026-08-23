"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

/**
 * REMONTER EN HAUT QUAND ON CHANGE DE PAGE — ET POURQUOI IL FAUT LE FAIRE À LA MAIN.
 *
 * ═══ LE DÉFAUT ═══
 *
 * Cliquer sur « Offres » depuis la landing amenait le visiteur au BAS de la
 * page d'offres — mesuré à 7 896 px sur 8 759. Idem pour le blog. Un chargement
 * direct de la même adresse arrivait correctement à 0 : le défaut n'était donc
 * pas dans la page, mais dans la navigation.
 *
 * ═══ LA CAUSE, ISOLÉE PAR L'EXPÉRIENCE ═══
 *
 * `marketing.css` pose `html:has(.mk) { scroll-behavior: smooth }`. C'est
 * voulu, et c'est utile : les ancres de l'en-tête (`/#tarifs`, `/#contact`)
 * glissent au lieu de sauter.
 *
 * Mais `<html>` est L'ÉLÉMENT QUI DÉFILE. Or à chaque changement de route,
 * Next replace le défilement lui-même ; avec `smooth`, ce repositionnement
 * devient une ANIMATION, qui se déroule pendant que l'ancien document est
 * remplacé par le nouveau. La cible calculée au départ ne vaut plus rien à
 * l'arrivée, et l'animation dépose le visiteur n'importe où — en l'occurrence
 * tout en bas.
 *
 * Vérifié en neutralisant la seule règle `scroll-behavior` sur la page en
 * production : le même clic arrive alors à 0.
 *
 * ═══ POURQUOI PAS SIMPLEMENT RETIRER LE `smooth` ═══
 *
 * Parce qu'on perdrait les ancres douces, qui sont la moitié de la navigation
 * de la vitrine. On garde donc le fluide, et on l'ÉTEINT le temps d'un saut :
 * le changement de page redevient instantané, les ancres restent glissées.
 *
 * ═══ POURQUOI PAS AU PREMIER RENDU ═══
 *
 * Un chargement direct est déjà correct — le navigateur pose le défilement
 * lui-même, et il sait restaurer la position d'un retour arrière. Remonter de
 * force effacerait cette restauration : on ne touche donc qu'aux changements
 * de route qui suivent.
 */
export function RemonterAuChangementDePage() {
  const pathname = usePathname();
  const premierRendu = useRef(true);

  useEffect(() => {
    if (premierRendu.current) {
      premierRendu.current = false;
      return;
    }

    const racine = document.documentElement;
    const avant = racine.style.scrollBehavior;
    racine.style.scrollBehavior = "auto";
    window.scrollTo(0, 0);

    // On rend le fluide à la trame suivante, une fois le saut consommé — le
    // rétablir tout de suite le ferait s'appliquer au saut lui-même.
    const trame = requestAnimationFrame(() => {
      racine.style.scrollBehavior = avant;
    });
    return () => cancelAnimationFrame(trame);
  }, [pathname]);

  return null;
}
