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
  /*
   * ═══ EN MODE `toujours`, LE CALQUE EST RENDU CÔTÉ SERVEUR ═══
   *
   * C'était le défaut le plus visible, et le plus embarrassant pour un écran
   * d'ouverture : on voyait le héros de la landing, PUIS l'animation, PUIS la
   * landing à nouveau. Une ouverture qui arrive après la page n'ouvre rien.
   *
   * La cause tenait à la solution du problème précédent. `useLayoutEffect`
   * s'exécute avant la PEINTURE, oui — mais après l'HYDRATATION, donc après
   * que le HTML du serveur a déjà été peint. Le calque ne pouvait pas exister
   * dans la première image.
   *
   * En mode `toujours` il n'y a plus rien à décider côté client : pas de
   * mémoire de session à consulter, donc pas d'écart d'hydratation possible.
   * Le calque part avec le HTML, il est là dès la première image, et le JS ne
   * fait plus que l'animer.
   *
   * LE FILET EST DANS LA CSS, et il est indispensable : un calque noir rendu
   * par le serveur masquerait le site pour toujours si le JS ne prenait jamais
   * la main. `.sm-splash` porte donc une animation CSS qui l'efface d'elle-même
   * — sans JS, le site apparaît quand même. Voir `globals.css`.
   */
  if (toujours) return <Splash duree={duree} onFini={onFini} />;

  return <SplashUneFoisParSession duree={duree} onFini={onFini} />;
}

/**
 * Le mode « une fois par session » — client seulement, par nécessité.
 *
 * Lui DOIT attendre le client : `sessionStorage` n'existe pas au rendu serveur.
 * Il accepte donc le scintillement que le mode `toujours` évite, parce qu'il
 * n'a pas le choix. Ce n'est pas le mode de la vitrine.
 */
function SplashUneFoisParSession({
  duree = 3.6,
  onFini,
}: Omit<SplashAuPremierPassageProps, "toujours">) {
  const [visible, setVisible] = useState(false);

  useAvantPeinture(() => {
    const chemin = window.location.pathname;
    if (SURFACES_CLIENT.some((p) => chemin === p.replace(/\/$/, "") || chemin.startsWith(p))) {
      return;
    }
    try {
      if (sessionStorage.getItem(CLE)) return;
      sessionStorage.setItem(CLE, "1");
    } catch {
      // Navigation privée, stockage refusé : on joue l'ouverture.
    }
    // `setState` dans un effet, et c'est voulu : `sessionStorage` n'existe pas
    // au rendu serveur, donc aucune valeur calculée au rendu ne peut décider
    // ceci — la lire au rendu provoquerait un écart d'hydratation. La règle
    // `react-hooks/set-state-in-effect` ne voit pas cet effet derrière l'alias
    // `useAvantPeinture`, donc aucune directive n'est à poser tant que l'alias
    // existe ; si l'alias disparaît un jour, elle se remettra à râler ici.
    setVisible(true);
  }, []);

  const fini = useCallback(() => {
    setVisible(false);
    onFini?.();
  }, [onFini]);

  if (!visible) return null;
  return <Splash duree={duree} onFini={fini} />;
}
