import { describe, expect, it } from "vitest";
import {
  reconnaitreUneSeuleFois,
  scanAutorise,
  supprimerCarteJusquAuVerdict,
} from "./session-guards";

function attente(): {
  promise: Promise<void>;
  terminer: () => void;
  echouer: (cause: unknown) => void;
} {
  let terminer!: () => void;
  let echouer!: (cause: unknown) => void;
  const promise = new Promise<void>((resolve, reject) => {
    terminer = resolve;
    echouer = reject;
  });
  return { promise, terminer, echouer };
}

describe("la suppression de session et le scan ne se croisent jamais", () => {
  it("verrouille synchroniquement avant DELETE et jusqu'à son succès terminal", async () => {
    const verrou = { current: false };
    const deleteEnVol = attente();

    const terminale = supprimerCarteJusquAuVerdict(
      verrou,
      () => deleteEnVol.promise,
      () => expect(verrou.current).toBe(true),
    );

    expect(verrou.current).toBe(true);
    expect(scanAutorise(verrou)).toBe(false);

    deleteEnVol.terminer();
    await expect(terminale).resolves.toEqual({ ok: true });
    expect(scanAutorise(verrou)).toBe(true);
  });

  it("attend aussi l'échec terminal avant de rendre le scanner disponible", async () => {
    const verrou = { current: false };
    const deleteEnVol = attente();
    const cause = new Error("réseau coupé");

    const terminale = supprimerCarteJusquAuVerdict(
      verrou,
      () => deleteEnVol.promise,
    );

    expect(scanAutorise(verrou)).toBe(false);
    deleteEnVol.echouer(cause);
    await expect(terminale).resolves.toEqual({ ok: false, cause });
    expect(scanAutorise(verrou)).toBe(true);
  });
});

describe("la reconnaissance du scanner est à usage unique", () => {
  it("ne laisse gagner qu'une entrée parmi caméra, photo et saisie", () => {
    const verrou = { current: false };
    const reconnues = ["caméra", "photo", "manuel"].filter(() =>
      reconnaitreUneSeuleFois(verrou),
    );

    expect(reconnues).toEqual(["caméra"]);
  });
});
