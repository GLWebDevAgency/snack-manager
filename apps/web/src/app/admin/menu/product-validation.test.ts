import { describe, expect, it } from "vitest";
import type { OptionGroup } from "./types";
import {
  erreurEnregistrementProduit,
  normaliserGroupesEdition,
  passerTypeChoix,
  validerModificationProduit,
} from "./product-validation";

const fromage = (): OptionGroup => ({
  key: "fromage",
  name: "Fromage",
  type: "single",
  min: 1,
  choices: ["Bleue", "Reblochon", "Raclette", "Camembert", "Cheddar"].map((name) => ({
    key: name.toLowerCase(), name, priceDelta: 0,
  })),
});

describe("le formulaire de groupes d’options", () => {
  it("réédite Pain/Sauces historiques et ajoute Fromage inclus sans changer le produit", () => {
    const pain = { ...fromage(), key: "pain", name: "Pain", max: null, perVariant: null };
    const sauces = { ...fromage(), key: "sauces", name: "Sauces", type: "multi", min: 0, max: null, perVariant: null };
    const source = [pain, sauces] as unknown as OptionGroup[];
    const before = JSON.stringify(source);
    const groups = normaliserGroupesEdition(source);
    expect(groups[0]).not.toHaveProperty("max");
    expect(groups[0]).not.toHaveProperty("perVariant");
    const result = validerModificationProduit({ optionGroups: [...groups, fromage()] });
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.message);
    expect(result.data.optionGroups?.[2]).toMatchObject({ min: 1, max: 1 });
    expect(result.data.optionGroups?.[2]?.choices.every((choice) => choice.priceDelta === 0)).toBe(true);
    expect(result.data).not.toHaveProperty("price");
    expect(result.data).not.toHaveProperty("variants");
    expect(JSON.stringify(source)).toBe(before);
  });

  it("conserve les règles par taille, leurs zéros et les clés historiques", () => {
    const perVariant = { classique: { min: 0, max: 0 }, fromage: { min: 1, max: 1, priceDelta: 0 } };
    const source = [{ ...fromage(), perVariant }];
    expect(normaliserGroupesEdition(source)).toEqual(source);
    expect(validerModificationProduit({ optionGroups: source }).success).toBe(true);
  });

  it("la normalisation est idempotente et la validation conserve un PATCH différentiel", () => {
    const source = [{ ...fromage(), max: null, perVariant: null }] as unknown as OptionGroup[];
    const normalized = normaliserGroupesEdition(source);
    expect(normaliserGroupesEdition(normalized)).toEqual(normalized);
    expect(validerModificationProduit({ description: "Recette maison" }))
      .toEqual({ success: true, data: { description: "Recette maison" } });
  });

  it("ne transforme pas une vraie limite invalide en absence de limite", () => {
    const groups = normaliserGroupesEdition([{ ...fromage(), max: 0 }]);
    expect(groups[0].max).toBe(0);
    const result = validerModificationProduit({ optionGroups: groups });
    expect(result.success).toBe(false);
    if (result.success) throw new Error("Le maximum zéro doit être refusé");
    expect(result.message).toContain("Groupe « Fromage »");
    expect(result.message).toContain("maximum");
    expect(result.message).not.toMatch(/Validation failed|Invalid input|Too small/);
  });

  it("nomme précisément le groupe et le choix incomplet avant envoi", () => {
    const group = fromage();
    group.choices[1].name = "";
    const result = validerModificationProduit({ optionGroups: [group] });
    expect(result.success).toBe(false);
    if (result.success) throw new Error("Le nom est requis");
    expect(result.message).toBe("Groupe « Fromage » · choix 2 : renseignez le nom du choix.");
  });

  it("explique minimum/maximum incohérents sans perdre le nom du groupe", () => {
    const result = validerModificationProduit({ optionGroups: [{ ...fromage(), min: 2, max: 1 }] });
    expect(result.success).toBe(false);
    if (result.success) throw new Error("Le minimum doit être refusé");
    expect(result.message).toContain("Groupe « Fromage » : le minimum (2) dépasse le maximum (1).");
  });

  it("traduit les issues API, y compris leur chemin sous forme de chaîne", () => {
    const error = Object.assign(new Error("Validation failed"), {
      body: { message: "Validation failed", issues: [
        { path: "optionGroups.0.choices.2.name", message: "Too small: expected string to have >=1 characters" },
      ] },
    });
    const group = fromage();
    group.choices[2].name = "";
    expect(erreurEnregistrementProduit(error, { optionGroups: [group] }))
      .toBe("Groupe « Fromage » · choix 3 : renseignez le nom du choix.");
  });

  it("donne une consigne française même si une ancienne API n’envoie pas d’issues", () => {
    expect(erreurEnregistrementProduit(new Error("Validation failed"), {}))
      .toBe("Vérifiez les noms, les prix et les limites de choix du produit, puis réessayez.");
    expect(erreurEnregistrementProduit(new Error("Connexion interrompue"), {}))
      .toBe("Connexion interrompue");
  });

  it("le passage à un seul choix pose 1 explicitement et préserve les règles par taille", () => {
    const perVariant = { xl: { min: 1, max: 1, priceDelta: 50 } };
    const group = { ...fromage(), type: "multi" as const, min: 2, max: 3, perVariant };
    const single = passerTypeChoix(group, "single");
    expect(single).toMatchObject({ type: "single", min: 1, max: 1, perVariant });
    expect(group).toMatchObject({ type: "multi", min: 2, max: 3 });
  });

  it("une taille incomplète reste une erreur lisible, sans remise à zéro du prix", () => {
    const result = validerModificationProduit({ variants: [{ key: "xl", name: "XL", price: -1 }] });
    expect(result).toEqual({
      success: false,
      message: "Taille « XL » : le prix doit être positif ou nul, exprimé au centime.",
    });
  });

  it("ne supprime pas une règle par taille invalide pour contourner la validation", () => {
    const groups = [{ ...fromage(), perVariant: { xl: { min: -1 } } }];
    expect(normaliserGroupesEdition(groups)).toEqual(groups);
    const result = validerModificationProduit({ optionGroups: groups });
    expect(result.success).toBe(false);
    if (result.success) throw new Error("La règle doit être refusée");
    expect(result.message).toContain("Groupe « Fromage » : les règles par taille sont invalides.");
  });
});
