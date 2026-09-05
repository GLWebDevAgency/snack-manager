import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSceneTimer } from "./scene-timer";

beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe("horloge de scène — le temps regardé est conservé", () => {
  it("reprend les sept secondes restantes après trois secondes puis une longue pause", () => {
    const clock = createSceneTimer(10_000, () => Date.now());
    const next = vi.fn();
    clock.resume(next);
    vi.advanceTimersByTime(3_000);
    clock.pause();
    vi.advanceTimersByTime(60_000);
    expect(next).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    clock.resume(next);
    vi.advanceTimersByTime(6_999);
    expect(next).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("cumule plusieurs pauses sans redémarrer ni doubler la rotation", () => {
    const clock = createSceneTimer(10_000, () => Date.now());
    const next = vi.fn();
    clock.resume(next);
    clock.resume(next);
    vi.advanceTimersByTime(2_000);
    clock.pause();
    clock.pause();
    vi.advanceTimersByTime(4_000);
    clock.resume(next);
    vi.advanceTimersByTime(3_000);
    clock.pause();
    clock.resume(next);
    vi.advanceTimersByTime(4_999);
    expect(next).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("une durée corrigée conserve le temps déjà écoulé", () => {
    const clock = createSceneTimer(10_000, () => Date.now());
    const next = vi.fn();
    clock.resume(next);
    vi.advanceTimersByTime(3_000);
    clock.setDuration(5_000);
    clock.resume(next);
    vi.advanceTimersByTime(1_999);
    expect(next).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("une scène quittée annule son échéance et la suivante commence entière", () => {
    const old = createSceneTimer(10_000, () => Date.now());
    const oldNext = vi.fn();
    old.resume(oldNext);
    vi.advanceTimersByTime(4_000);
    old.pause();
    const current = createSceneTimer(8_000, () => Date.now());
    const next = vi.fn();
    current.resume(next);
    vi.advanceTimersByTime(7_999);
    expect(oldNext).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(next).toHaveBeenCalledTimes(1);
  });
});
