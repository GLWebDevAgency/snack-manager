import { describe, expect, it } from "vitest";
import { STAFF_ROLES, USER_ROLES, type AuditEntryView } from "@sm/contracts";
import { ROLES_NOMMES, phraseDuGeste, signatureDeLAuteur } from "./journal";

/**
 * LES PHRASES DU REGISTRE — les seules que le gérant lira au litige.
 *
 * Le panneau ne savait raconter que trois gestes ; le produit en écrit
 * dix-huit. Une action dont le `meta` n'est pas traduit s'affiche muette :
 * libellé, date, et rien entre les deux. C'est ce trou que ces tests ferment,
 * ligne par ligne.
 */

const ligne = (over: Partial<AuditEntryView>): AuditEntryView => ({
  _id: "l1",
  at: "2026-09-02T10:00:00.000Z",
  action: "price.change",
  actionLabel: "Changement de prix",
  staffName: "",
  author: null,
  meta: {},
  ...over,
});

describe("l’auteur affiché", () => {
  it("dit le nom, le rôle et le moyen — les trois questions d’un coup", () => {
    const vue = signatureDeLAuteur(
      ligne({ author: { id: "u1", name: "Karim Belkacem", role: "owner", means: "password" } }),
    );
    expect(vue).toBe("par Karim Belkacem (propriétaire, depuis le back-office)");
  });

  it("distingue un code tapé au comptoir d’un mot de passe", () => {
    const vue = signatureDeLAuteur(
      ligne({ author: { id: "s1", name: "Sarah", role: "caisse", means: "pin" } }),
    );
    expect(vue).toBe("par Sarah (caisse, au code, sur tablette)");
  });

  /**
   * AUCUN RÔLE NE S'AFFICHE EN CLÉ BRUTE.
   *
   * Le registre existe pour NOMMER qui a fait quoi. Un rôle ajouté au produit
   * sans libellé ici y écrirait « cogerant » — au moment précis, et au seul
   * endroit, où la phrase doit se lire par un contrôleur.
   */
  it("nomme en français chacun des rôles du produit", () => {
    for (const role of [...USER_ROLES, ...STAFF_ROLES]) {
      expect(ROLES_NOMMES, role).toContain(role);
    }
  });

  it("distingue le cogérant du gérant, deux portes différentes", () => {
    // `cogerant` est un compte à mot de passe, `gerant` un code sur tablette.
    // Le moyen les sépare déjà dans la phrase ; le mot ne doit pas les
    // confondre.
    expect(
      signatureDeLAuteur(
        ligne({ author: { id: "u2", name: "Sarah", role: "cogerant", means: "password" } }),
      ),
    ).toBe("par Sarah (cogérant, depuis le back-office)");
    expect(
      signatureDeLAuteur(
        ligne({ author: { id: "s2", name: "Sarah", role: "gerant", means: "pin" } }),
      ),
    ).toBe("par Sarah (gérant, au code, sur tablette)");
  });

  it("retombe sur le nom d’équipier des lignes d’avant l’auteur", () => {
    // Elles existent : le registre est append-only, il ne se réécrit pas pour
    // rattraper une évolution de forme. Elles ne doivent pas s'afficher
    // anonymes pour autant.
    expect(signatureDeLAuteur(ligne({ staffName: "Sarah" }))).toBe("par Sarah");
    expect(signatureDeLAuteur(ligne({}))).toBe("");
  });
});

describe("la phrase du geste", () => {
  it("dit un prix en euros, jamais en centimes", () => {
    const vue = phraseDuGeste(
      ligne({ meta: { name: "Tacos Poulet", fromCents: 950, toCents: 890 } }),
    );
    expect(vue).toBe("Tacos Poulet : 9,50 € → 8,90 €");
  });

  it("nomme un supplément et sait dire « gratuit » plutôt qu’un tiret", () => {
    const vue = phraseDuGeste(
      ligne({ meta: { name: "Cheddar", supplement: true, fromCents: null, toCents: 100 } }),
    );
    expect(vue).toBe("supplément Cheddar : gratuit → 1,00 €");
  });

  it("raconte un mouvement de stock avec le solde d’avant et d’après", () => {
    const vue = phraseDuGeste(
      ligne({
        action: "stock.movement",
        meta: {
          name: "Merguez",
          unit: "kg",
          type: "waste",
          qty: -3,
          de: 12,
          vers: 9,
          note: "Coupure de courant",
        },
      }),
    );
    expect(vue).toBe("Merguez — perte de -3 kg (12 kg → 9 kg) — Coupure de courant");
  });

  it("donne l’AMPLEUR d’une rupture d’ingrédient — c’est ce qu’on cherche", () => {
    const vue = phraseDuGeste(
      ligne({
        action: "ingredient.out",
        meta: { name: "Cheddar", isOut: true, productsUpdated: 7 },
      }),
    );
    expect(vue).toBe("Cheddar en rupture — 7 produits concernés");
  });

  it("dit une pause de la commande en ligne en toutes lettres", () => {
    // C'est le seul réglage qui FERME la vente : « onlineOrderingPaused » sur
    // l'écran d'un gérant ne veut rien dire.
    expect(
      phraseDuGeste(
        ligne({ action: "tenant.settings", meta: { reglages: ["onlineOrderingPaused"], onlineOrderingPaused: true } }),
      ),
    ).toBe("commande en ligne mise en pause");
    expect(
      phraseDuGeste(
        ligne({ action: "tenant.settings", meta: { reglages: ["onlineOrderingPaused"], onlineOrderingPaused: false } }),
      ),
    ).toBe("commande en ligne rouverte");
  });

  it("raconte une catégorie supprimée et ce qu’elle emporte", () => {
    expect(
      phraseDuGeste(ligne({ action: "category.delete", meta: { name: "Sandwichs", detached: 12 } })),
    ).toBe("Sandwichs — 12 produits détachés");
  });

  it("nomme les champs modifiés d’une identité de facturation, jamais leurs valeurs en vrac", () => {
    const vue = phraseDuGeste(
      ligne({
        action: "tenant.billing_identity",
        meta: {
          avant: { siret: "00000000000000", legalName: "Chez Lima" },
          apres: { siret: "73282932000074", legalName: "Chez Lima" },
        },
      }),
    );
    expect(vue).toBe("champs modifiés : siret");
  });

  it("reste muette sans mentir sur une action qu’elle ne connaît pas", () => {
    // Le libellé et la date restent affichés : une phrase inventée serait pire
    // qu'une phrase absente dans un registre à valeur probante.
    expect(phraseDuGeste(ligne({ action: "order.refund", meta: {} }))).toBe("");
  });
});
