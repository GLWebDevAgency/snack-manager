import { describe, expect, it } from "vitest";
import { createLatestRequestCoordinator } from "./latest-request";

describe("coordination des pages clients", () => {
  it("annule et invalide une réponse de filtre devenue obsolète", () => {
    const requests = createLatestRequestCoordinator();
    const all = requests.start();
    const active = requests.start();

    expect(all.signal.aborted).toBe(true);
    expect(all.isCurrent()).toBe(false);
    expect(active.signal.aborted).toBe(false);
    expect(active.isCurrent()).toBe(true);
  });

  it("empêche un loadMore tardif d’écraser la nouvelle première page", () => {
    const requests = createLatestRequestCoordinator();
    const loadMore = requests.start();
    requests.cancel();
    const replacement = requests.start();

    expect(loadMore.signal.aborted).toBe(true);
    expect(loadMore.isCurrent()).toBe(false);
    expect(replacement.isCurrent()).toBe(true);
    requests.finish(loadMore);
    expect(replacement.isCurrent()).toBe(true);
  });

  it("ne laisse plus publier un ticket terminé", () => {
    const requests = createLatestRequestCoordinator();
    const ticket = requests.start();
    expect(ticket.isCurrent()).toBe(true);
    requests.finish(ticket);
    expect(ticket.isCurrent()).toBe(false);
  });
});
