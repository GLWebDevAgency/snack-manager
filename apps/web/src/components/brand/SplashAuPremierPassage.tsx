"use client";

import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { Splash } from "./Splash";

/**
 * L'ÉCRAN D'OUVERTURE, MONTÉ AU BON MOMENT ET AU BON ENDROIT.
 *
 * Le composant `Splash` ne sait qu'une chose : se dessiner. Décider s'il DOIT
 * se dessiner est un tout autre problème, et c'est celui-ci qui casse en
 * production. Trois règles le gouvernent.
 *
 * ═══ 1 · UNE FOIS PAR SESSION, PAS UNE FOIS PAR PAGE ═══
 *
 * La vitrine sert quatre routes. Sans mémoire, le visiteur qui passe de la
 * landing aux tarifs puis au blog subirait l'ouverture trois fois — et la
 * troisième, ce n'est plus une marque, c'est un péage.
 *
 * `sessionStorage` et non `localStorage` : revenir le lendemain doit rejouer
 * l'ouverture, c'est une nouvelle visite. Naviguer dans la même session, non.
 *
 * ═══ 2 · JAMAIS DEVANT UN MANGEUR ═══
 *
 * Charte §10 : notre marque n'a rien à faire sur le site de commande d'un
 * restaurant, son écran de salle ou son suivi de commande. Une animation
 * plein écran à notre nom y serait la faute la plus visible du produit.
 *
 * La garde est ici, portée par le composant qui décide — pas laissée à la
 * discipline de celui qui le pose.
 *
 * ═══ 3 · NI SCINTILLEMENT, NI ÉCART D'HYDRATATION ═══
 *
 * Le problème est réel et n'a pas de solution évidente. Rendre le calque côté
 * serveur, c'est l'imposer à celui qui l'a déjà vu — le temps que le JS
 * décide de le retirer. Le rendre au premier rendu client, c'est un écart
 * d'hydratation garanti : le serveur ne peut pas lire `sessionStorage`.
 *
 * D'où `useLayoutEffect` : il s'exécute APRÈS l'hydratation et AVANT la
 * peinture. Le serveur et le premier rendu client s'accordent sur `null`,
 * puis le calque apparaît sans qu'une seule image de la page ait été montrée.
 */

/** Chemins où notre marque ne doit jamais paraître — voir la règle 2. */
const SURFACES_CLIENT = ["/r/", "/embed/", "/t/", "/board"];

const CLE = "sm.splash.vu";

/**
 * Le drapeau d'une TRANSITION — armé au moment où des identifiants sont
 * validés, lu par la coque qui prend le relais.
 *
 * Pourquoi passer par le stockage plutôt que par un état React : la page de
 * connexion DISPARAÎT au moment où l'on navigue vers le tableau de bord. Un
 * calque monté chez elle partirait avec elle, précisément pendant la seconde
 * qu'il est censé couvrir. Le drapeau, lui, traverse.
 */
const CLE_TRANSITION = "sm.splash.transition";

/** À appeler juste avant de naviguer, une fois la connexion acceptée. */
export function armerSplashDeTransition(): void {
  try {
    sessionStorage.setItem(CLE_TRANSITION, "1");
  } catch {
    // Stockage refusé : on entrera sans ouverture. Sans conséquence.
  }
}

/** Consomme le drapeau : il ne se joue qu'une fois. */
export function consommerSplashDeTransition(): boolean {
  try {
    if (sessionStorage.getItem(CLE_TRANSITION) !== "1") return false;
    sessionStorage.removeItem(CLE_TRANSITION);
    return true;
  } catch {
    return false;
  }
}

/** `useLayoutEffect` côté client, `useEffect` au rendu serveur (pas d'alerte). */
const useAvantPeinture = typeof window === "undefined" ? useEffect : useLayoutEffect;

export type SplashAuPremierPassageProps = {
  /** Durée totale, en secondes. */
  duree?: number;
  /**
   * Rejouer à chaque montage plutôt qu'une fois par session.
   *
   * C'est le mode de la VITRINE — une ouverture qu'on ne peut pas revoir en
   * rechargeant n'est pas une ouverture — et celui des TRANSITIONS, après une
   * connexion validée.
   *
   * Le montage n'a lieu qu'au chargement d'un DOCUMENT : la navigation interne
   * de Next ne remonte pas un layout partagé. Passer de la landing aux tarifs
   * ne rejoue donc rien ; recharger, si.
   */
  toujours?: boolean;
  onFini?: () => void;
};

export function SplashAuPremierPassage({
  duree = 3.6,
  toujours = false,
  onFini,
}: SplashAuPremierPassageProps) {
  const [visible, setVisible] = useState(false);

  useAvantPeinture(() => {
    const chemin = window.location.pathname;
    if (SURFACES_CLIENT.some((p) => chemin === p.replace(/\/$/, "") || chemin.startsWith(p))) {
      return;
    }

    if (!toujours) {
      try {
        if (sessionStorage.getItem(CLE)) return;
        sessionStorage.setItem(CLE, "1");
      } catch {
        // Navigation privée, stockage refusé : on joue l'ouverture. Mieux vaut
        // la rejouer une fois de trop que de la devoir à un `try` silencieux.
      }
    }
    setVisible(true);
  }, [toujours]);

  const fini = useCallback(() => {
    setVisible(false);
    onFini?.();
  }, [onFini]);

  if (!visible) return null;
  return <Splash duree={duree} onFini={fini} />;
}
