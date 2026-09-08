import { describe, expect, it } from "vitest";
import { retourDepuisCheminFidelite } from "./retour";

describe("où renvoyer quand le programme fidélité n'existe pas", () => {
  it("ramène au RESTAURANT, et non au site de l'éditeur", () => {
    // Le bouton portait `href="/"` : sur le domaine personnalisé d'un client,
    // la seule chose visible de sa marque devenait la page commerciale de son
    // prestataire.
    expect(retourDepuisCheminFidelite("/r/classfood/fidelite")).toEqual({
      href: "/r/classfood",
      libelle: "Voir le menu du restaurant",
    });
  });

  it("suit aussi les sous-chemins de l'application installée", () => {
    expect(retourDepuisCheminFidelite("/r/le-comptoir/fidelite/card-qr").href).toBe(
      "/r/le-comptoir",
    );
  });

  it("refuse tout ce qui n'est pas un slug — un chemin est une entrée utilisateur", () => {
    for (const chemin of [
      null,
      "",
      "/",
      "/fidelite",
      "/r//fidelite",
      "/r/UNSLUG/fidelite",
      "/r/-mauvais/fidelite",
      "/r/mauvais-/fidelite",
      "/r/a".concat("b".repeat(60), "/fidelite"),
    ]) {
      expect(retourDepuisCheminFidelite(chemin), String(chemin)).toEqual({
        href: "/",
        libelle: "Retour à l’accueil",
      });
    }
  });

  it("ne peut pas fabriquer une redirection vers un autre site", () => {
    // Un slug ne contient ni barre oblique ni deux-points : le motif du
    // contrat interdit par construction `//evil.example` ou `https:`.
    expect(retourDepuisCheminFidelite("/r/https:/fidelite").href).toBe("/");
    expect(retourDepuisCheminFidelite("//evil.example/fidelite").href).toBe("/");
  });
});
