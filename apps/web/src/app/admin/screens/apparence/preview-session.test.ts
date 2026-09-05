import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPreviewSession } from "./preview-session";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function fixture() {
  const calls: { signal: AbortSignal; response: ReturnType<typeof deferred<string>> }[] = [];
  const onStart = vi.fn();
  const onContent = vi.fn();
  const onError = vi.fn();
  const session = createPreviewSession({
    request: (signal) => {
      const response = deferred<string>();
      calls.push({ signal, response });
      return response.promise;
    },
    onStart, onContent, onError,
  });
  return { ...session, calls, onStart, onContent, onError };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe("session d'aperçu — annulation et fraîcheur", () => {
  it("garde le debounce malgré les focus et ne double jamais un appel actif", async () => {
    const f = fixture();
    f.refresh();
    await vi.advanceTimersByTimeAsync(249);
    expect(f.calls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    f.refresh();
    f.refresh();
    expect(f.calls).toHaveLength(1);
    expect(f.onStart).toHaveBeenCalledTimes(1);
    f.calls[0]!.response.resolve("carte");
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(29_999);
    expect(f.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(f.calls).toHaveLength(2);
    f.stop();
  });

  it("ne lance rien si le tiroir ferme avant la fin du debounce", async () => {
    const f = fixture();
    f.stop();
    f.refresh();
    await vi.advanceTimersByTimeAsync(90_000);
    expect(f.calls).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("annule le polling en vol et ne le réarme pas après une réponse tardive", async () => {
    const f = fixture();
    await vi.advanceTimersByTimeAsync(250);
    f.calls[0]!.response.resolve("première carte");
    await vi.advanceTimersByTimeAsync(30_000);
    expect(f.calls).toHaveLength(2);
    f.stop();
    expect(f.calls[1]!.signal.aborted).toBe(true);
    f.calls[1]!.response.resolve("trop tard");
    await vi.advanceTimersByTimeAsync(120_000);
    expect(f.onContent).toHaveBeenCalledTimes(1);
    expect(f.calls).toHaveLength(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("une ancienne session ne peut livrer ni contenu ni erreur dans le nouveau brouillon", async () => {
    const old = fixture();
    await vi.advanceTimersByTimeAsync(250);
    old.stop();
    const current = fixture();
    await vi.advanceTimersByTimeAsync(250);
    current.calls[0]!.response.resolve("nouveau brouillon");
    old.calls[0]!.response.reject(new Error("ancien refus"));
    await vi.advanceTimersByTimeAsync(0);
    expect(old.onContent).not.toHaveBeenCalled();
    expect(old.onError).not.toHaveBeenCalled();
    expect(current.onContent).toHaveBeenCalledWith("nouveau brouillon");
    current.stop();
  });

  it("expire un appel bloqué et ignore sa réponse après une reprise réussie", async () => {
    const f = fixture();
    await vi.advanceTimersByTimeAsync(15_250);
    expect(f.calls[0]!.signal.aborted).toBe(true);
    expect(f.onError).toHaveBeenCalledTimes(1);
    f.refresh();
    expect(f.calls).toHaveLength(2);
    f.calls[1]!.response.resolve("révision récente");
    await vi.advanceTimersByTimeAsync(0);
    f.calls[0]!.response.resolve("révision ancienne");
    await vi.advanceTimersByTimeAsync(0);
    expect(f.onContent.mock.calls).toEqual([["révision récente"]]);
    expect(f.onError).toHaveBeenCalledTimes(1);
    f.stop();
  });

  it("après une erreur, Réessayer relance et remplace l'échéance de polling", async () => {
    const f = fixture();
    await vi.advanceTimersByTimeAsync(250);
    f.calls[0]!.response.reject(new Error("connexion perdue"));
    await vi.advanceTimersByTimeAsync(0);
    expect(f.onError).toHaveBeenCalledWith(expect.objectContaining({ message: "connexion perdue" }));
    await vi.advanceTimersByTimeAsync(20_000);
    f.refresh();
    expect(f.onStart).toHaveBeenCalledTimes(2);
    f.calls[1]!.response.resolve("retrouvée");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(f.calls).toHaveLength(2);
    expect(f.onContent).toHaveBeenCalledWith("retrouvée");
    f.stop();
  });
});
