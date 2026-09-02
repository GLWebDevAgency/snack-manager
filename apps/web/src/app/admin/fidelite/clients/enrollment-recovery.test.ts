import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearAllEnrollmentRecoveries,
  enrollmentRecoveryKey,
  enrollmentRecoveryScopeFor,
  parseEnrollmentRecovery,
  readEnrollmentRecovery,
  writeEnrollmentRecovery,
  type EnrollmentRecoveryScope,
} from "./enrollment-recovery";

describe("reprise d'adhésion fidélité dans le navigateur", () => {
  const operationId = "22222222-2222-4222-8222-222222222222";

  it("n'accepte que l'UUID et une phase fermée", () => {
    expect(
      parseEnrollmentRecovery(
        JSON.stringify({ operationId, phase: "ack_pending" }),
      ),
    ).toEqual({ operationId, phase: "ack_pending" });
    expect(
      parseEnrollmentRecovery(
        JSON.stringify({ operationId, phase: "inconnue" }),
      ),
    ).toBeNull();
  });

  it("refuse toute PII, tout QR et tout champ surnuméraire", () => {
    expect(
      parseEnrollmentRecovery(
        JSON.stringify({
          operationId,
          phase: "creating",
          phone: "06 12 34 56 78",
        }),
      ),
    ).toBeNull();
    expect(
      parseEnrollmentRecovery(
        JSON.stringify({ operationId, phase: "awaiting_handoff", qrToken: "secret" }),
      ),
    ).toBeNull();
    expect(parseEnrollmentRecovery("{cassé")).toBeNull();
  });

  it("cloisonne la clé par tenant, utilisateur et mode", () => {
    const live = { mode: "live", tenantId: "tenant-a", userId: "user-a" } as const;
    expect(enrollmentRecoveryKey(live)).not.toBe(
      enrollmentRecoveryKey({ ...live, tenantId: "tenant-b" }),
    );
    expect(enrollmentRecoveryKey(live)).not.toBe(
      enrollmentRecoveryKey({ ...live, userId: "user-b" }),
    );
    expect(enrollmentRecoveryKey(live)).not.toBe(
      enrollmentRecoveryKey({ ...live, mode: "demo" }),
    );
  });

  it("dérive le tenant et le principal du JWT, sans confondre la démo", () => {
    const payload = Buffer.from(
      JSON.stringify({ sub: "user-a", tenantId: "tenant-a" }),
    ).toString("base64url");
    expect(enrollmentRecoveryScopeFor({ demo: false, token: `x.${payload}.y` })).toEqual({
      mode: "live",
      tenantId: "tenant-a",
      userId: "user-a",
    });
    expect(enrollmentRecoveryScopeFor({ demo: true, token: `x.${payload}.y` })).toEqual({
      mode: "demo",
      tenantId: "t1",
      userId: "demo-admin-session",
    });
    expect(enrollmentRecoveryScopeFor({ demo: false, token: "cassé" })).toBeNull();
  });

  describe("stockage cloisonné", () => {
    afterEach(() => vi.unstubAllGlobals());

    it("ne lit que la reprise du scope courant et purge tout au logout", () => {
      const storage = memoryStorage();
      vi.stubGlobal("window", { sessionStorage: storage });
      const a: EnrollmentRecoveryScope = {
        mode: "live",
        tenantId: "tenant-a",
        userId: "user-a",
      };
      const b: EnrollmentRecoveryScope = {
        mode: "live",
        tenantId: "tenant-b",
        userId: "user-b",
      };
      writeEnrollmentRecovery(a, { operationId, phase: "creating" });
      writeEnrollmentRecovery(b, { operationId, phase: "ack_pending" });
      storage.setItem("sans-rapport", "préservé");

      expect(readEnrollmentRecovery(a)?.phase).toBe("creating");
      expect(readEnrollmentRecovery(b)?.phase).toBe("ack_pending");
      clearAllEnrollmentRecoveries();
      expect(readEnrollmentRecovery(a)).toBeNull();
      expect(readEnrollmentRecovery(b)).toBeNull();
      expect(storage.getItem("sans-rapport")).toBe("préservé");
    });
  });
});

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}
