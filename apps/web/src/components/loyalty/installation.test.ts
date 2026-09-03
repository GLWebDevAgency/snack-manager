import { describe, expect, it } from "vitest";
import {
  contexteInstallation,
  dejaInstallee,
  estIOS,
  modeInstallation,
} from "./installation";

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const IPAD_OS =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";
const MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const ANDROID =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36";

describe("le repérage d'iOS", () => {
  it("reconnaît l'iPhone", () => {
    expect(estIOS(IPHONE, true)).toBe(true);
  });

  it("reconnaît l'iPad, qui se présente comme un Macintosh depuis iPadOS 13", () => {
    expect(estIOS(IPAD_OS, true)).toBe(true);
  });

  it("ne prend pas un Mac pour un iPad : c'est le tactile qui les sépare", () => {
    expect(estIOS(IPAD_OS, false)).toBe(false);
    expect(estIOS(MAC, false)).toBe(false);
  });

  it("laisse Android à son API native", () => {
    expect(estIOS(ANDROID, true)).toBe(false);
  });
});

describe("déjà installée", () => {
  it("croit le standard comme l'ancien drapeau iOS", () => {
    expect(dejaInstallee(true, undefined)).toBe(true);
    expect(dejaInstallee(false, true)).toBe(true);
    expect(dejaInstallee(false, false)).toBe(false);
    // `navigator.standalone` n'existe pas ailleurs : `undefined` n'est pas oui.
    expect(dejaInstallee(false, undefined)).toBe(false);
    expect(dejaInstallee(false, "true")).toBe(false);
  });
});

describe("ce que le navigateur permet", () => {
  it("range l'application déjà posée sur l'écran d'accueil", () => {
    expect(
      contexteInstallation({
        ua: IPHONE,
        tactile: true,
        affichageAutonome: false,
        standaloneIOS: true,
      }),
    ).toBe("autonome");
  });

  it("range Safari iOS à part — il n'a aucune API d'installation", () => {
    expect(
      contexteInstallation({
        ua: IPHONE,
        tactile: true,
        affichageAutonome: false,
        standaloneIOS: false,
      }),
    ).toBe("ios");
  });

  it("ne promet rien sur un navigateur qui ne dit rien", () => {
    expect(
      contexteInstallation({
        ua: MAC,
        tactile: false,
        affichageAutonome: false,
        standaloneIOS: undefined,
      }),
    ).toBe("rien");
  });
});

describe("la décision finale", () => {
  it("préfère toujours l'invitation native au mode d'emploi", () => {
    expect(
      modeInstallation({ contexte: "ios", inviteNative: true, ecartee: false }),
    ).toBe("invite");
  });

  it("explique le geste quand aucune API n'existe — le trou iOS", () => {
    expect(
      modeInstallation({ contexte: "ios", inviteNative: false, ecartee: false }),
    ).toBe("ios");
  });

  it("ne propose rien à qui a déjà installé", () => {
    expect(
      modeInstallation({ contexte: "autonome", inviteNative: true, ecartee: false }),
    ).toBe("aucune");
  });

  it("ne propose rien à qui vient de dire non", () => {
    for (const contexte of ["ios", "rien", "autonome"] as const) {
      expect(modeInstallation({ contexte, inviteNative: true, ecartee: true })).toBe(
        "aucune",
      );
    }
  });

  it("ne propose rien là où l'installation n'existe pas", () => {
    expect(
      modeInstallation({ contexte: "rien", inviteNative: false, ecartee: false }),
    ).toBe("aucune");
  });
});
