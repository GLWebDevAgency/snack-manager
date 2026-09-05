import { describe, expect, it } from "vitest";
import type { ScreenScenePayload } from "@sm/contracts";
import { createScenePlayback, indexSuivant, reconcileScenePlayback } from "./use-scene-rotation";

const scene = (id: string, title = id): ScreenScenePayload => ({
  id, title, kind: "custom", subtitle: null, durationMs: 10_000,
  products: [], promos: [], nextOpening: null,
});

describe("indexSuivant — la boucle du tiroir « Apparence »", () => {
  it("avance, recule, et boucle dans les deux sens", () => {
    expect(indexSuivant(0, 1, 3)).toBe(1);
    expect(indexSuivant(2, 1, 3)).toBe(0);
    expect(indexSuivant(0, -1, 3)).toBe(2);
  });

  it("sans scène, reste à zéro", () => {
    expect(indexSuivant(5, 1, 0)).toBe(0);
  });
});

describe("réconciliation avant commit — la scène sortante reste montée", () => {
  const a = scene("a");
  const b = scene("b");
  const c = scene("c");
  const scenes = [a, b, c];

  it("garde la même lecture sur un rendu inchangé", () => {
    const playback = createScenePlayback(scenes, "ardoise:landscape");
    expect(reconcileScenePlayback(playback, scenes, "ardoise:landscape")).toBe(playback);
  });

  it("retient la sortie dès le rendu qui choisit la scène suivante, sans effet différé", () => {
    const before = createScenePlayback(scenes);
    const after = reconcileScenePlayback({ ...before, index: 1 }, scenes);
    expect(after.current).toBe(b);
    expect(after.leaving).toBe(a);
    expect(after.playbackVersion).toBe(before.playbackVersion);
    expect(after.exitVersion).toBe(before.exitVersion + 1);
  });

  it("une navigation rapide ne conserve que la dernière sortie et ne duplique jamais la scène courante", () => {
    const first = createScenePlayback(scenes);
    const second = reconcileScenePlayback({ ...first, index: 1 }, scenes);
    const third = reconcileScenePlayback({ ...second, index: 2 }, scenes);
    expect(third.current).toBe(c);
    expect(third.leaving).toBe(b);
    const back = reconcileScenePlayback({ ...second, index: 0 }, scenes);
    expect(back.current).toBe(a);
    expect(back.leaving).toBe(b);
    expect(back.current?.id).not.toBe(back.leaving?.id);
  });

  it("un prix/texte actualisé garde l'entrée, la sortie et son échéance", () => {
    const before = reconcileScenePlayback({ ...createScenePlayback(scenes), index: 1 }, scenes);
    const updated = scene("b", "Nouveau libellé");
    const after = reconcileScenePlayback(before, [a, updated, c]);
    expect(after.current).toBe(updated);
    expect(after.leaving).toBe(a);
    expect(after.playbackVersion).toBe(before.playbackVersion);
    expect(after.exitVersion).toBe(before.exitVersion);
  });

  it.each(["halo:landscape", "ardoise:portrait"])("repart de la scène courante pour le nouveau modèle/format %s", (key) => {
    const before = reconcileScenePlayback({ ...createScenePlayback(scenes, "ardoise:landscape"), index: 1 }, scenes, "ardoise:landscape");
    const after = reconcileScenePlayback(before, scenes, key);
    expect(after.current).toBe(b);
    expect(after.index).toBe(1);
    expect(after.leaving).toBeNull();
    expect(after.playbackVersion).toBe(before.playbackVersion + 1);
    expect(reconcileScenePlayback(after, [...scenes], key)).toBe(after);
  });

  it("une boucle raccourcie reste dans les bornes et une boucle vide retire aussi la sortie", () => {
    const before = reconcileScenePlayback({ ...createScenePlayback(scenes), index: 2 }, scenes);
    const after = reconcileScenePlayback(before, [a]);
    expect(after.index).toBe(0);
    expect(after.current).toBe(a);
    const empty = reconcileScenePlayback(after, []);
    expect(empty.current).toBeNull();
    expect(empty.leaving).toBeNull();
    expect(empty.index).toBe(0);
  });
});
