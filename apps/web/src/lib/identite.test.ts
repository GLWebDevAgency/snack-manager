import { describe, expect, it, vi } from "vitest";

/*
 * Le client d'API est DOUBLÉ : ces cas ne testent que la dérivation du nom et
 * de l'initiale, et charger `./api` ferait entrer tout le mode démonstration
 * dans un test de trois fonctions pures. Aucun d'eux n'appelle le réseau.
 */
vi.mock("./api", () => ({ api: { get: async () => null } }));

import type { AuthMe } from "@sm/contracts";
import { initialeDe, libelleRole, nomAffichable } from "./identite";

const personne = (patch: Partial<AuthMe> = {}): AuthMe => ({
  id: "u1",
  nom: "Camille Fournier",
  role: "owner",
  genre: "user",
  email: "camille@le-comptoir.fr",
  tenantId: "t1",
  ...patch,
});

describe("le nom affiché dans le pied de barre", () => {
  it("rend le nom de la personne connectée", () => {
    expect(nomAffichable(personne())).toBe("Camille Fournier");
  });

  it("rend `null` tant qu’on ne sait pas — jamais un nom de repli", () => {
    // C'est l'état d'attente ET l'état d'échec : les deux coques y affichent
    // un tiret discret. « Le Gérant » écrit en dur, lui, était affirmé comme
    // un fait à quelqu'un qui n'est pas cette personne.
    expect(nomAffichable(null)).toBeNull();
    expect(nomAffichable(undefined)).toBeNull();
  });

  it("traite un nom vide ou blanc comme une absence", () => {
    // `name` vaut `''` par défaut dans le schéma des comptes : un compte créé
    // par script peut n'en porter aucun, et une ligne vide sous la pastille
    // ressemblerait à un défaut d'affichage.
    expect(nomAffichable(personne({ nom: "" }))).toBeNull();
    expect(nomAffichable(personne({ nom: "   " }))).toBeNull();
  });

  it("retire les espaces autour du nom", () => {
    expect(nomAffichable(personne({ nom: "  Sofia  " }))).toBe("Sofia");
  });
});

describe("l’initiale de la pastille", () => {
  it("se dérive du nom, en capitale", () => {
    expect(initialeDe(personne({ nom: "camille fournier" }))).toBe("C");
    expect(initialeDe(personne({ nom: "Sofia" }))).toBe("S");
  });

  it("garde les accents plutôt que de les aplatir", () => {
    // « Élodie » est un prénom de l'équipe : sa pastille doit lui ressembler.
    expect(initialeDe(personne({ nom: "Élodie" }))).toBe("É");
  });

  it("saute ce qui n’est ni lettre ni chiffre", () => {
    // Un nom qui commence par une ponctuation donnerait une pastille muette.
    expect(initialeDe(personne({ nom: "« Chef »" }))).toBe("C");
    expect(initialeDe(personne({ nom: " Karim" }))).toBe("K");
  });

  it("rend `null` quand il n’y a rien à dériver", () => {
    // AUCUNE lettre de repli : « M » et « A » étaient précisément les deux
    // pastilles écrites en dur qu'on retire. Une lettre par défaut dessinerait
    // la pastille de quelqu'un qui n'existe pas.
    expect(initialeDe(null)).toBeNull();
    expect(initialeDe(personne({ nom: "" }))).toBeNull();
    expect(initialeDe(personne({ nom: "—" }))).toBeNull();
  });
});

describe("le rôle en toutes lettres", () => {
  it("nomme les rôles du restaurant et celui de l’équipe Snack Manager", () => {
    expect(libelleRole("owner")).toBe("Propriétaire");
    expect(libelleRole("gerant")).toBe("Gérant");
    expect(libelleRole("caisse")).toBe("Caisse");
    expect(libelleRole("cuisine")).toBe("Cuisine");
    expect(libelleRole("sm_admin")).toBe("Équipe Snack Manager");
  });

  it("se tait sur un rôle inconnu plutôt que d’afficher du jargon", () => {
    // Le chantier « plusieurs comptes par restaurant » ajoutera des rôles plus
    // fins. Tant que personne n'est passé les nommer ici, la ligne reste vide :
    // `responsable_salle` sous un nom propre ne veut rien dire pour qui le lit.
    expect(libelleRole("responsable_salle")).toBeNull();
    expect(libelleRole(null)).toBeNull();
    expect(libelleRole(undefined)).toBeNull();
  });
});
