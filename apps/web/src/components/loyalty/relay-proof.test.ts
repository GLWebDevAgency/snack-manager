import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { publicRelayHeaders } from "./relay-proof";

const SECRET = Buffer.alloc(32, 7);
const NOW = Date.parse("2026-09-01T12:00:00.000Z");
const TOKEN = "A".repeat(43);

describe("preuve serveur du relais fidélité", () => {
  it("transmet un pseudonyme stable et une preuve liée au restaurant", () => {
    const headers = publicRelayHeaders("classfood", "edge-ip:203.0.113.41", TOKEN, {
      nowMs: NOW,
      secret: SECRET,
      production: true,
    });
    const client = createHmac("sha256", SECRET)
      .update("client\0edge-ip:203.0.113.41")
      .digest("base64url");

    expect(headers["X-SM-Relay-Client"]).toBe(client);
    expect(headers["X-SM-Relay-At"]).toBe("1788264000");
    expect(headers["X-SM-Relay-Proof"]).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(JSON.stringify(headers)).not.toContain("203.0.113.41");
    expect(
      publicRelayHeaders("autre-resto", "edge-ip:203.0.113.41", TOKEN, {
        nowMs: NOW,
        secret: SECRET,
        production: true,
      })["X-SM-Relay-Proof"],
    ).not.toBe(headers["X-SM-Relay-Proof"]);
    expect(
      publicRelayHeaders("classfood", "edge-ip:203.0.113.41", "B".repeat(43), {
        nowMs: NOW,
        secret: SECRET,
        production: true,
      })["X-SM-Relay-Proof"],
    ).not.toBe(headers["X-SM-Relay-Proof"]);
  });

  it("échoue fermé en production sans identité ou clé exacte", () => {
    expect(() =>
      publicRelayHeaders("classfood", null, TOKEN, {
        secret: SECRET,
        production: true,
      }),
    ).toThrow(/Identité edge/);
    expect(() =>
      publicRelayHeaders("classfood", "edge-ip:203.0.113.41", TOKEN, {
        secret: Buffer.alloc(12),
        production: true,
      }),
    ).toThrow(/Clé de signature/);
  });

  it("autorise le développement local sans preuve quand la clé n'est pas configurée", () => {
    expect(
      publicRelayHeaders("classfood", "edge-ip:127.0.0.1", TOKEN, {
        secret: null,
        production: false,
      }),
    ).toEqual({});
  });
});
