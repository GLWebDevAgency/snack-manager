import { describe, expect, it, vi } from "vitest";
import { uid } from "./helpers";

/**
 * L'IDENTIFIANT LOCAL SERT AUSSI DE CLÉ D'IDEMPOTENCE.
 *
 * Le repli produisait `l{base36}…`, qui n'est pas un UUID. Or `clientId` est
 * validé par `z.uuid()` côté API : sur tout navigateur sans
 * `crypto.randomUUID` — contexte non sécurisé, WebView ancienne, HTTP en
 * réseau local — la commande partait avec un identifiant refusé. Le client
 * voyait « commande impossible » sans qu'aucun essai ne puisse aboutir.
 */
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("l’identifiant local", () => {
  it("est un UUID quand le navigateur sait en produire", () => {
    expect(uid()).toMatch(UUID_V4);
  });

  it("reste un UUID SANS `crypto.randomUUID` — c’est là qu’il échouait", () => {
    const vrai = globalThis.crypto;
    // Un contexte non sécurisé : `getRandomValues` existe, `randomUUID` non.
    vi.stubGlobal("crypto", { getRandomValues: vrai.getRandomValues.bind(vrai) });
    try {
      expect(uid()).toMatch(UUID_V4);
    } finally {
      vi.stubGlobal("crypto", vrai);
    }
  });

  it("reste un UUID même sans aucune API de hasard", () => {
    const vrai = globalThis.crypto;
    vi.stubGlobal("crypto", {});
    try {
      for (let i = 0; i < 50; i += 1) expect(uid()).toMatch(UUID_V4);
    } finally {
      vi.stubGlobal("crypto", vrai);
    }
  });

  it("ne se répète pas", () => {
    const vus = new Set(Array.from({ length: 500 }, () => uid()));
    expect(vus.size).toBe(500);
  });
});
