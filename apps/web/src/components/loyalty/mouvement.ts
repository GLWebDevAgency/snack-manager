"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

/**
 * LE MOUVEMENT DE LA CARTE — et pourquoi il se lit dans le masque.
 *
 * ═══ LE PROBLÈME QUE CE FICHIER RÈGLE ═══
 *
 * Le résolveur de marque émet quatre durées par restaurant (`--sm-t-snap`,
 * `-fast`, `-med`, `-slow`) et nomme la dernière `fete` : 900 ms sur un masque
 * « posé », 600 sur un masque « vif ». La carte de fidélité ne dépensait ce
 * jeton de CÉLÉBRATION que sur une barre de progression, et n'avait aucun
 * autre mouvement — pas de compteur, pas de palier, pas de retour de scan.
 *
 * Le CSS lit ces durées tout seul (`duration-slow`, `animate-fete`). Le
 * JavaScript, lui, ne le peut pas : une animation pilotée en `requestAnimation
 * Frame` a besoin d'un NOMBRE. D'où `dureeEnMs()`, qui lit la valeur que
 * `styleDuMasque()` vient justement de calculer pour la racine de la surface —
 * jamais une constante recopiée, qui figerait le choix du restaurateur.
 */

/**
 * « 900ms », « 0.6s », « 600 » → millisecondes.
 *
 * Le résolveur écrit toujours des millisecondes suffixées (`${n}ms`), mais le
 * REPLI de `globals.css` — celui que lit l'admin, qui ne porte pas de masque —
 * est écrit en SECONDES (`0.6s`). Les deux unités doivent donc être comprises,
 * sinon la même fonction rendrait 0,6 ms là où elle doit rendre 600.
 *
 * Une valeur absente, négative ou illisible retombe sur `repli` : une durée
 * fausse ne doit jamais devenir une animation interminable ou instantanée par
 * accident.
 */
export function dureeEnMs(valeur: unknown, repli: number): number {
  if (typeof valeur === "number") {
    return Number.isFinite(valeur) && valeur >= 0 ? valeur : repli;
  }
  if (typeof valeur !== "string") return repli;
  const lu = /^\s*(-?\d*\.?\d+)\s*(ms|s)?\s*$/.exec(valeur);
  if (!lu) return repli;
  const nombre = Number(lu[1]);
  if (!Number.isFinite(nombre) || nombre < 0) return repli;
  return lu[2] === "s" ? nombre * 1_000 : nombre;
}

/**
 * Sortie douce, cubique — la même intention que `--sm-ease`
 * (`cubic-bezier(.2,.8,.2,1)`) : très rapide au départ, longue traîne. Un
 * compteur qui démarre lentement donne l'impression que l'application rame.
 *
 * Pas de rebond ici, même sur un masque « vif » dont la courbe en a un : un
 * solde qui DÉPASSE sa valeur avant d'y revenir affiche un chiffre faux
 * pendant quelques images. Le rebond appartient aux formes, jamais aux
 * nombres.
 */
export function adoucir(progression: number): number {
  const t = Math.min(1, Math.max(0, progression));
  return 1 - (1 - t) ** 3;
}

/**
 * La valeur ENTIÈRE affichée par le compteur à un instant de sa course.
 *
 * Arrondie et non tronquée : `Math.floor` collait le compteur une image de
 * trop sur la valeur de départ et, sur un écart de 1, le chiffre ne changeait
 * qu'au tout dernier rendu — le compteur ne comptait pas.
 */
export function valeurDuCompte(
  depart: number,
  arrivee: number,
  progression: number,
): number {
  if (!(progression < 1)) return arrivee;
  return Math.round(depart + (arrivee - depart) * adoucir(progression));
}

/**
 * La durée réelle d'un décompte, plafonnée par le rôle « fête » du masque.
 *
 * Un solde qui passe de 24 à 30 et un solde qui passe de 0 à 1 200 ne peuvent
 * pas prendre le même temps : le premier serait interminable à raison de
 * 900 ms pour six unités, le second passerait pour un clignotement. La durée
 * suit donc l'ÉCART — 45 ms par unité — sans jamais dépasser le jeton du
 * masque ni descendre sous son tiers, qui est la durée du retour tactile : en
 * dessous, l'œil ne voit plus une montée mais un saut.
 */
export function dureeDuCompte(ecart: number, dureeFete: number): number {
  const unites = Math.abs(ecart);
  if (unites === 0) return 0;
  return Math.min(dureeFete, Math.max(dureeFete / 3, unites * 45));
}

/*
 * ── `prefers-reduced-motion`, LU COMME UN STORE EXTERNE ──────────────────
 *
 * `useSyncExternalStore` et non un `useState` + `useEffect` : c'est le patron
 * déjà en place dans ce dépôt pour toute lecture de `window` au rendu
 * (`masque/masqueDeCapture.ts`, `order/demo/DemoStorefront.tsx`), et il est le
 * seul à régler les deux pièges d'un coup — l'instantané serveur rend le
 * premier rendu client IDENTIQUE au HTML livré (aucune hydratation en
 * désaccord), et la règle `react-hooks/set-state-in-effect` n'a rien à
 * redire puisque aucun état n'est posé depuis un effet.
 *
 * La préférence est aussi ABONNÉE, pas seulement lue : elle change en cours de
 * session (réglages iOS, mode économie d'énergie). Une valeur capturée au
 * montage laisserait une carte ouverte depuis une heure continuer d'animer
 * pour quelqu'un qui vient de demander l'inverse.
 */
const REQUETE_MOUVEMENT_REDUIT = "(prefers-reduced-motion: reduce)";

function abonnerMouvementReduit(rejouer: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return () => {};
  }
  const liste = window.matchMedia(REQUETE_MOUVEMENT_REDUIT);
  liste.addEventListener("change", rejouer);
  return () => liste.removeEventListener("change", rejouer);
}

function lireMouvementReduit(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia(REQUETE_MOUVEMENT_REDUIT).matches;
}

const pasDeMouvementReduitAuServeur = () => false;

/** `true` quand le système demande moins de mouvement — à désarmer partout. */
export function useMouvementReduit(): boolean {
  return useSyncExternalStore(
    abonnerMouvementReduit,
    lireMouvementReduit,
    pasDeMouvementReduitAuServeur,
  );
}

/**
 * LE SOLDE QUI MONTE.
 *
 * ═══ POURQUOI UNE BOUCLE JS ET PAS UNE TRANSITION CSS ═══
 *
 * On n'anime pas une propriété, on anime un NOMBRE : le CSS n'a rien à
 * interpoler entre le texte « 24 » et le texte « 30 ». C'est le seul endroit
 * de la surface où le JavaScript doit tenir la boucle lui-même.
 *
 * ═══ CE QUE `prefers-reduced-motion` DÉSARME ICI ═══
 *
 * La règle globale de `globals.css` ramène toute animation CSS à 0,01 ms, mais
 * elle ne peut rien contre une boucle JavaScript : celle-ci doit se désarmer
 * elle-même. Le hook rend alors la cible DIRECTEMENT, sans passer par l'état —
 * pas même une image à 0, qui serait un chiffre faux affiché à quelqu'un qui
 * a demandé qu'on arrête de bouger.
 *
 * Le premier affichage part de 0 : c'est l'arrivée, le moment où le client
 * découvre son solde. Les suivants partent de la valeur AFFICHÉE — pas de la
 * précédente cible — sinon une actualisation lancée pendant une montée ferait
 * sauter le compteur en arrière avant de repartir.
 */
export function useCompteAnime(cible: number, dureeFete: number): number {
  const reduit = useMouvementReduit();
  const [affiche, setAffiche] = useState(0);
  // Écrit UNIQUEMENT depuis l'effet et depuis la boucle d'animation : jamais
  // pendant un rendu (`react-hooks/refs`).
  const courantRef = useRef(0);

  useEffect(() => {
    if (reduit) return;
    const depart = courantRef.current;
    if (depart === cible) return;
    const duree = dureeDuCompte(cible - depart, dureeFete);
    const debut = performance.now();
    let image = 0;
    const pas = (maintenant: number) => {
      const progression = duree <= 0 ? 1 : (maintenant - debut) / duree;
      const valeur = valeurDuCompte(depart, cible, progression);
      courantRef.current = valeur;
      setAffiche(valeur);
      if (progression < 1) image = requestAnimationFrame(pas);
    };
    image = requestAnimationFrame(pas);
    return () => cancelAnimationFrame(image);
  }, [cible, dureeFete, reduit]);

  return reduit ? cible : affiche;
}

/**
 * UN DRAPEAU QUI RETOMBE TOUT SEUL.
 *
 * `cle` et non un booléen : deux événements coup sur coup doivent REJOUER
 * l'animation, ce qu'un booléen déjà à `true` ne permet pas. Le hook ne
 * mémorise donc pas « c'est allumé » mais « quelle clé est déjà éteinte » — un
 * état DÉRIVÉ, posé par un minuteur et jamais synchroniquement depuis l'effet
 * (`react-hooks/set-state-in-effect`).
 */
export function useDrapeauTemporaire(
  cle: number | string | null,
  dureeMs: number,
): boolean {
  const [eteinte, setEteinte] = useState<number | string | null>(null);

  useEffect(() => {
    if (cle === null) return;
    const minuteur = window.setTimeout(() => setEteinte(cle), dureeMs);
    return () => window.clearTimeout(minuteur);
  }, [cle, dureeMs]);

  return cle !== null && eteinte !== cle;
}

/**
 * Le même drapeau, mais DÉSARMÉ par `prefers-reduced-motion` — l'éclat d'un
 * palier, le halo d'un scan réussi, la respiration d'une récompense gagnée.
 *
 * La distinction avec `useDrapeauTemporaire` est celle de la NATURE du signal :
 * un message qui s'efface porte une information et doit rester lisible quelle
 * que soit la préférence ; une onde décorative, non.
 */
export function useGesteBref(
  cle: number | string | null,
  dureeMs: number,
): boolean {
  const reduit = useMouvementReduit();
  const actif = useDrapeauTemporaire(reduit ? null : cle, dureeMs);
  return actif && !reduit;
}
