import { describe, expect, it, vi } from "vitest";

/*
 * Le client d'API est DOUBLÉ, comme dans les autres tests de ce dépôt qui
 * touchent un module en `@/…` : aucun alias n'est déclaré à vitest, et le
 * résoudre pour de vrai ferait entrer tout le mode démonstration dans un test
 * de décodage de jeton. Chaque cas ci-dessous passe son jeton explicitement —
 * `getToken` n'est jamais appelé.
 */
vi.mock("@/lib/api", () => ({ getToken: () => null }));

import { roleAdmin, sessionAdmin } from "./session";

/**
 * Fabrique un jeton comme l'API en émet : trois parties, la charge utile en
 * base64url SANS remplissage (c'est la norme JWT, et c'est exactement ce que
 * `atob` refuse tel quel).
 */
const jeton = (claims: Record<string, unknown>): string =>
  [
    "en-tete",
    btoa(JSON.stringify(claims)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""),
    "signature",
  ].join(".");

const DANS_UNE_HEURE = Math.floor(Date.now() / 1000) + 3_600;
const HIER = Math.floor(Date.now() / 1000) - 86_400;

describe("la session du back-office restaurateur", () => {
  it("lit le rôle du propriétaire et le genre de sa session", () => {
    // Le patron se connecte à l'e-mail et au mot de passe, depuis son
    // téléphone : c'est la seule session `user` de cette surface.
    const token = jeton({ sub: "u1", tenantId: "t1", role: "owner", kind: "user", exp: DANS_UNE_HEURE });
    expect(sessionAdmin(token)).toEqual({ role: "owner", genre: "user" });
  });

  it("lit les trois rôles d’équipe ouverts au code sur une tablette", () => {
    // Ce sont EUX que la barre montrait comme un propriétaire : « Encaissement
    // en ligne » s'affichait sur le comptoir et rendait un 403 au clic.
    for (const role of ["gerant", "caisse", "cuisine"] as const) {
      const token = jeton({ sub: "s1", tenantId: "t1", role, kind: "staff", exp: DANS_UNE_HEURE });
      expect(sessionAdmin(token)).toEqual({ role, genre: "staff" });
    }
  });

  it("déduit le genre du rôle quand le jeton ne le porte pas", () => {
    // Les jetons émis avant le champ `kind` n'ont pas à perdre leur barre :
    // `owner` est un compte e-mail, les trois autres n'existent que derrière
    // un code sur tablette appairée.
    expect(sessionAdmin(jeton({ role: "owner" }))).toEqual({ role: "owner", genre: "user" });
    expect(sessionAdmin(jeton({ role: "caisse" }))).toEqual({ role: "caisse", genre: "staff" });
  });

  it("ignore un genre inconnu plutôt que de le recopier", () => {
    expect(sessionAdmin(jeton({ role: "cuisine", kind: "robot" }))).toEqual({
      role: "cuisine",
      genre: "staff",
    });
  });

  it("rend null sans jeton — l’appelant décide, il ne plante pas", () => {
    expect(sessionAdmin(null)).toBeNull();
    expect(sessionAdmin("")).toBeNull();
    expect(roleAdmin(null)).toBeNull();
  });

  it("rend null sur un jeton expiré", () => {
    // Un jeton périmé désigne toujours un rôle. S'y fier peindrait une barre
    // pour une session qui n'existe plus, et chaque entrée mènerait à un 401.
    expect(sessionAdmin(jeton({ role: "owner", kind: "user", exp: HIER }))).toBeNull();
  });

  it("accepte un jeton sans date de fin — l’échéance est l’affaire du serveur", () => {
    expect(roleAdmin(jeton({ role: "gerant", kind: "staff" }))).toBe("gerant");
  });

  it("rend null sur le jeton de l’équipe Snack Manager", () => {
    // `sm_admin` travaille sur `/sm`, avec son propre emplacement de jeton. S'il
    // s'en trouve un ici, ce n'est pas une session de restaurateur.
    expect(sessionAdmin(jeton({ role: "sm_admin", kind: "user", exp: DANS_UNE_HEURE }))).toBeNull();
  });

  it("rend null sur un rôle inconnu ou absent", () => {
    expect(sessionAdmin(jeton({ role: "chef-etoile" }))).toBeNull();
    expect(sessionAdmin(jeton({ sub: "u1" }))).toBeNull();
    expect(sessionAdmin(jeton({ role: 42 }))).toBeNull();
  });

  it("ne jette JAMAIS sur un jeton malformé — un rendu blanc ferme le back-office", () => {
    // Chacun de ces cas s'est vu ou peut se voir : stockage tronqué, jeton
    // recopié à la main, valeur d'une autre application sur la même origine.
    const malformes = [
      "pas-un-jeton",
      "a.b",
      "a..c",
      "a.$$$non-base64$$$.c",
      // Du base64 valide qui n'est pas du JSON.
      `a.${btoa("bonjour")}.c`,
      // Du JSON valide qui n'est pas un objet.
      `a.${btoa("[1,2,3]")}.c`,
      `a.${btoa("null")}.c`,
      `a.${btoa('"owner"')}.c`,
    ];
    for (const token of malformes) {
      expect(() => sessionAdmin(token), `« ${token} » ne doit pas jeter`).not.toThrow();
      expect(sessionAdmin(token), `« ${token} » n’est pas une session`).toBeNull();
    }
  });

  it("raccourcit vers le rôle seul", () => {
    expect(roleAdmin(jeton({ role: "owner", kind: "user", exp: DANS_UNE_HEURE }))).toBe("owner");
  });
});
