import type { CSSProperties } from "react";

/** One exit clock for CSS and the two-layer player: never cut a dissolve short. */
export const SCENE_EXIT_MS = 380;

/**
 * The longest reveal is beat 11 (eight products + four copy steps).
 * Even at the contract minimum, at least 60% of a scene remains for reading.
 * No frame-by-frame React state and no animation library on the TV player.
 */
export function sceneMotionStyle(durationMs: number): CSSProperties & Record<`--bd-${string}`, string> {
  const duration = Number.isFinite(durationMs) && durationMs > 0 ? Math.max(4000, durationMs) : 4000;
  return {
    "--bd-scene-ms": `${duration}ms`,
    "--bd-reveal-ms": `${Math.min(850, Math.round(duration * 0.15))}ms`,
    "--bd-beat-ms": `${Math.min(60, Math.round(duration * 0.008))}ms`,
    "--bd-intro-delay": "40ms",
    "--bd-exit-ms": `${SCENE_EXIT_MS}ms`,
  };
}
