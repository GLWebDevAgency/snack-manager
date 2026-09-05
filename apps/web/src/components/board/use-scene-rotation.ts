"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ScreenScenePayload } from "@sm/contracts";
import { createSceneTimer } from "./scene-timer";
import { SCENE_EXIT_MS } from "./scene-motion";

/**
 * Le carrousel : une scène à la fois, pour la durée choisie par le gérant.
 *
 * Le rythme vient du serveur (`durationMs`) et non d'une constante recopiée
 * ici : c'est le back-office qui décide qu'une catégorie s'attarde et qu'une
 * offre passe vite. L'écran, lui, se contente de tenir la cadence.
 *
 * `leaving` garde la scène sortante montée le temps du fondu-glissé — sans
 * elle, la transition serait un passage par le noir, ce qui se remarque
 * immédiatement dans une salle et fait croire à une coupure.
 */

export interface SceneRotation {
  current: ScreenScenePayload | null;
  leaving: ScreenScenePayload | null;
  /** Position dans la boucle — sert à pré-charger la photo d'après. */
  index: number;
  /** Avance ou recule d'un cran, en boucle — le tiroir « Apparence ». */
  go: (delta: number) => void;
  /** Rejoue explicitement la scène courante, même seule ; ne change pas la pause. */
  replay: () => void;
  /** Change seulement pour Rejouer ou un nouveau modèle/format, jamais pour un prix. */
  playbackVersion: number;
}

/** L'index d'après, en boucle dans les deux sens ; zéro sans scène. */
export const indexSuivant = (index: number, delta: number, length: number): number =>
  length === 0 ? 0 : (((index + delta) % length) + length) % length;

interface ScenePlayback {
  index: number;
  current: ScreenScenePayload | null;
  leaving: ScreenScenePayload | null;
  playbackKey: string | undefined;
  playbackVersion: number;
  exitVersion: number;
}

export function createScenePlayback(
  scenes: readonly ScreenScenePayload[],
  playbackKey?: string,
): ScenePlayback {
  return { index: 0, current: scenes[0] ?? null, leaving: null, playbackKey, playbackVersion: 0, exitVersion: 0 };
}

/**
 * Réconcilier AVANT le commit garde le DOM de la scène sortante en place.
 * Un effet après le rendu arriverait trop tard : React l'aurait déjà démontée.
 * La référence courante suit les prix frais sans redémarrer aucune horloge.
 */
export function reconcileScenePlayback(
  previous: ScenePlayback,
  scenes: readonly ScreenScenePayload[],
  playbackKey?: string,
): ScenePlayback {
  const index = indexSuivant(previous.index, 0, scenes.length);
  const current = scenes[index] ?? null;
  const restarted = previous.playbackKey !== playbackKey;
  if (!restarted && previous.current === current && previous.index === index) return previous;
  const changed = previous.current?.id !== current?.id;
  return {
    ...previous,
    index,
    current,
    leaving: restarted || !current ? null : changed ? previous.current : previous.leaving,
    playbackKey,
    playbackVersion: previous.playbackVersion + (restarted ? 1 : 0),
    exitVersion: previous.exitVersion + (restarted || changed ? 1 : 0),
  };
}

export function useSceneRotation(
  scenes: readonly ScreenScenePayload[],
  options: { paused?: boolean; playbackKey?: string } = {},
): SceneRotation {
  const paused = options.paused === true;
  const [stored, setPlayback] = useState(() => createScenePlayback(scenes, options.playbackKey));
  const playback = reconcileScenePlayback(stored, scenes, options.playbackKey);
  // Ajustement conditionnel de notre propre état : React recommence ce rendu
  // avant de commettre les enfants. Aucun effet tardif ni état par frame.
  if (playback !== stored) setPlayback(playback);
  const { current, leaving, index, playbackVersion, exitVersion } = playback;
  const sceneTimer = useRef<{
    id: string;
    playbackVersion: number;
    clock: ReturnType<typeof createSceneTimer>;
  } | null>(null);

  const currentId = current?.id ?? null;
  const durationMs = current?.durationMs ?? 0;

  useEffect(() => {
    if (currentId === null) {
      sceneTimer.current = null;
      return;
    }
    if (sceneTimer.current?.id !== currentId || sceneTimer.current.playbackVersion !== playbackVersion) {
      sceneTimer.current = { id: currentId, playbackVersion, clock: createSceneTimer(durationMs) };
    }
    const { clock } = sceneTimer.current;
    clock.setDuration(durationMs);
    // Une scène seule ou en pause ne programme aucun changement. Reprendre
    // conserve le temps écoulé, comme la progression CSS figée par l'hôte.
    if (!paused && scenes.length > 1) {
      clock.resume(() => setPlayback((value) => ({ ...value, index: indexSuivant(value.index, 1, scenes.length) })));
    }
    return clock.pause;
  }, [currentId, durationMs, scenes.length, paused, playbackVersion]);

  const go = useCallback(
    (delta: number) => setPlayback((value) => ({ ...value, index: indexSuivant(value.index, delta, scenes.length) })),
    [scenes.length],
  );

  const replay = useCallback(() => setPlayback((value) => value.current ? {
    ...value, leaving: null, playbackVersion: value.playbackVersion + 1, exitVersion: value.exitVersion + 1,
  } : value), []);

  const leavingId = leaving?.id ?? null;
  useEffect(() => {
    if (!leavingId) return;
    const timer = setTimeout(() => setPlayback((value) => (
      value.exitVersion === exitVersion ? { ...value, leaving: null } : value
    )), SCENE_EXIT_MS);
    return () => clearTimeout(timer);
  }, [leavingId, exitVersion]);

  return { current, leaving, index, go, replay, playbackVersion };
}
