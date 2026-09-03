import { describe, expect, it } from "vitest";
import { detailCapacites, type CapaciteEffective } from "@sm/contracts";
import { gestePour } from "./capacites";

/**
 * LE PANNEAU « ACCÈS ET OPTIONS » — un seul bouton par ligne, et c'est le bon.
 *
 * Ces tests portent sur la seule règle que le panneau ajoute : quel geste
 * chaque ligne appelle. Le calcul des capacités, lui, est vérifié dans le
 * contrat — le front ne le rejoue pas, il l'affiche.
 *
 * Les DEUX CAS DU DÉPLOIEMENT sont épinglés nommément : le pilote en formule
 * Complet qui fait tourner la fidélité vendue en Boost, et le client sans
 * formule qui doit éditer sa carte. Ils doivent être à un clic, sans choix de
 * geste à faire.
 */

const de = (souscription: Parameters<typeof detailCapacites>[0], capacite: string) =>
  detailCapacites(souscription).find((c) => c.capacite === capacite) as CapaciteEffective;

describe("le geste qu’une ligne de capacité appelle", () => {
  it("propose d’ACCORDER la fidélité au pilote en formule Complet", () => {
    const loyalty = de({ plan: "complet" }, "loyalty");
    expect(loyalty.acquise).toBe(false);
    expect(loyalty.origine).toBeNull();
    expect(gestePour(loyalty)).toBe("accordee");
  });

  it("propose d’ACCORDER l’éditeur de carte à un client sans formule", () => {
    // Un client Atelier seul n'a aucune colonne dans la grille : rien ne lui a
    // été promis, donc rien ne lui est ouvert — et il tient pourtant sa carte
    // chez nous.
    const menu = de({ plan: null }, "menu");
    expect(menu.acquise).toBe(false);
    expect(gestePour(menu)).toBe("accordee");
  });

  it("propose de RETIRER ce que la formule comprend", () => {
    expect(gestePour(de({ plan: "complet" }, "stocks"))).toBe("retiree");
  });

  it("propose de RETIRER une option souscrite — c’est cesser de la facturer", () => {
    const online = de({ plan: "essentiel", onlineOrdering: true }, "online");
    expect(online.origine).toBe("option");
    expect(gestePour(online)).toBe("retiree");
  });

  it("propose de LEVER dès qu’une dérogation existe, dans les deux sens", () => {
    // On ne neutralise pas une exception en empilant l'exception inverse : on
    // l'efface, et la formule reprend la main.
    const accordee = de(
      {
        plan: "complet",
        derogationsCapacite: [
          { capacite: "loyalty", sens: "accordee", motif: "pilote", auteur: "sm", le: "2026-09-02" },
        ],
      },
      "loyalty",
    );
    expect(accordee.acquise).toBe(true);
    expect(gestePour(accordee)).toBe("levee");

    const retiree = de(
      {
        plan: "boost",
        derogationsCapacite: [
          { capacite: "online", sens: "retiree", motif: "litige", auteur: "sm", le: "2026-09-02" },
        ],
      },
      "online",
    );
    expect(retiree.acquise).toBe(false);
    expect(gestePour(retiree)).toBe("levee");
  });

  it("propose de LEVER une dérogation devenue sans effet", () => {
    // Une capacité comprise dans la formule et accordée en plus par un geste
    // ancien : la ligne existe, elle doit pouvoir se nettoyer depuis l'écran.
    const loyalty = de(
      {
        plan: "boost",
        derogationsCapacite: [
          { capacite: "loyalty", sens: "accordee", motif: "geste", auteur: "sm", le: "2026-09-02" },
        ],
      },
      "loyalty",
    );
    expect(loyalty.origine).toBe("formule");
    expect(gestePour(loyalty)).toBe("levee");
  });
});
