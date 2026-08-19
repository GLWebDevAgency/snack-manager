"use client";

import { useEffect, useRef, useState } from "react";
import type { ScreenScenePayload } from "@sm/contracts";

/**
 * Le carrousel : une scène à la fois, 8 à 12 secondes chacune.
 *
 * Le rythme vient du serveur (`durationMs`) et non d'une constante recopiée
 * ici : c'est le back-office qui décide qu'une catégorie s'attarde et qu'une
 * offre passe vite. L'écran, lui, se contente de tenir la cadence.
 *
 * `leaving` garde la scène sortante montée le temps du fondu-glissé — sans
 * elle, la transition serait un passage par le noir, ce qui se remarque
 * immédiatement dans une salle et fait croire à une coupure.
 */

/** Doit rester aligné sur `.bd-layer[data-phase="out"]` dans board.css. */
const SCENE_EXIT_MS = 380;

export interface SceneRotation {
  current: ScreenScenePayload | null;
  leaving: ScreenScenePayload | null;
  /** Position dans la boucle — sert à pré-charger la photo d'après. */
  index: number;
}

export function useSceneRotation(scenes: readonly ScreenScenePayload[]): SceneRotation {
  const [index, setIndex] = useState(0);
  const [leaving, setLeaving] = useState<ScreenScenePayload | null>(null);
  const previousRef = useRef<ScreenScenePayload | null>(null);

  // Le contenu peut avoir rétréci depuis (une catégorie vidée par le
  // dayparting) : on reste dans les bornes plutôt que d'afficher du vide.
  const safeIndex = scenes.length > 0 ? index % scenes.length : 0;
  const current = scenes.length > 0 ? (scenes[safeIndex] ?? null) : null;
  const currentId = current?.id ?? null;

  useEffect(() => {
    // Une scène unique (écran fermé, plaque de marque) ne tourne pas : aucun
    // minuteur ne doit courir pendant douze heures pour rien.
    if (scenes.length <= 1 || !current) return;
    const timer = setTimeout(() => {
      setIndex((value) => (value + 1) % scenes.length);
    }, current.durationMs);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId, scenes.length]);

  useEffect(() => {
    const previous = previousRef.current;
    previousRef.current = current;
    // Même scène recalculée (rafraîchissement du contenu) : pas de transition.
    if (!previous || !current || previous.id === current.id) return;

    setLeaving(previous);
    const timer = setTimeout(() => setLeaving(null), SCENE_EXIT_MS);
    return () => clearTimeout(timer);
  }, [current]);

  return { current, leaving, index: safeIndex };
}
