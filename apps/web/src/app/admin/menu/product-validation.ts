import { normalizeLegacyOptionGroup, ProductUpdateSchema, type ProductUpdate } from "@sm/contracts";
import type { OptionGroup, Variant } from "./types";

type ProductValidationContext = {
  optionGroups?: readonly OptionGroup[];
  variants?: readonly Variant[];
};

/** Même normalisation pour le brouillon ET sa référence : aucun PATCH artificiel. */
export function normaliserGroupesEdition(groups: readonly OptionGroup[]): OptionGroup[] {
  return groups.map((group) => normalizeLegacyOptionGroup(group) as OptionGroup);
}

/** Changer explicitement de type ne doit pas garder l'ancien maximum de « Plusieurs ». */
export function passerTypeChoix(group: OptionGroup, type: OptionGroup["type"]): OptionGroup {
  return type === "single"
    ? { ...group, type, min: Math.min(group.min ?? 0, 1), max: 1 }
    : { ...group, type };
}

const record = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null ? value as Record<string, unknown> : null;

function messageIssue(value: unknown, context: ProductValidationContext): string {
  const issue = record(value);
  const path = Array.isArray(issue?.path)
    ? issue.path.map(String)
    : typeof issue?.path === "string" ? issue.path.split(".") : [];
  const [section, index, field, choiceIndex, choiceField] = path;

  if (section === "optionGroups") {
    const group = context.optionGroups?.[Number(index)];
    const label = group?.name?.trim() ? `Groupe « ${group.name.trim()} »` : `Groupe ${Number(index) + 1 || 1}`;
    if (field === "choices" && choiceIndex !== undefined) {
      const choice = group?.choices?.[Number(choiceIndex)];
      const name = choice?.name?.trim() ? `choix « ${choice.name.trim()} »` : `choix ${Number(choiceIndex) + 1}`;
      const detail = choiceField === "name" ? "renseignez le nom du choix."
        : choiceField === "priceDelta" ? "le supplément doit être un montant exprimé au centime."
        : "vérifiez les informations de ce choix.";
      return `${label} · ${name} : ${detail}`;
    }
    if (field === "name") return `${label} : renseignez l’intitulé du groupe.`;
    if (field === "choices") return `${label} : ajoutez au moins un choix nommé.`;
    if (field === "type") return `${label} : sélectionnez « Un seul » ou « Plusieurs ».`;
    if (field === "min") {
      const max = group?.max ?? (group?.type === "single" ? 1 : undefined);
      return max !== undefined && group && group.min > max
        ? `${label} : le minimum (${group.min}) dépasse le maximum (${max}).`
        : `${label} : le minimum doit être un nombre entier positif ou nul.`;
    }
    if (field === "max") {
      if (group?.type === "single" && group.max !== undefined && group.max > 1) {
        return `${label} : un seul choix est autorisé (maximum : 1).`;
      }
      if (group?.max !== undefined && group.max > (group.choices?.length ?? 0)) {
        return `${label} : le maximum (${group.max}) dépasse le nombre de choix (${group.choices?.length ?? 0}).`;
      }
      return `${label} : le maximum doit être un nombre entier supérieur à zéro.`;
    }
    if (field === "perVariant") {
      return `${label} : les règles par taille sont invalides. Contactez l’assistance pour les vérifier sans les supprimer.`;
    }
    return `${label} : vérifiez le nom et les limites de choix.`;
  }

  if (section === "variants") {
    const variant = context.variants?.[Number(index)];
    const label = variant?.name?.trim() ? `Taille « ${variant.name.trim()} »` : `Taille ${Number(index) + 1 || 1}`;
    return `${label} : ${field === "price"
      ? "le prix doit être positif ou nul, exprimé au centime."
      : "renseignez le nom de la taille."}`;
  }

  const fields: Record<string, string> = {
    name: "Renseignez le nom du produit.",
    categoryId: "Sélectionnez une catégorie valide.",
    price: "Le prix du produit doit être positif ou nul, exprimé au centime.",
    description: "Vérifiez la description du produit.",
    tags: "Vérifiez les étiquettes du produit.",
  };
  return fields[section] ?? "Vérifiez les informations du produit, puis réessayez.";
}

function messagesIssues(issues: readonly unknown[], context: ProductValidationContext): string {
  return [...new Set(issues.map((issue) => messageIssue(issue, context)))].join("\n");
}

export function validerModificationProduit(patch: Record<string, unknown>):
  | { success: true; data: ProductUpdate }
  | { success: false; message: string } {
  const result = ProductUpdateSchema.safeParse(patch);
  return result.success
    ? { success: true, data: result.data }
    : { success: false, message: messagesIssues(result.error.issues, patch as ProductValidationContext) };
}

/** Même vocabulaire pour la prévalidation et le détail `issues` renvoyé par l'API. */
export function erreurEnregistrementProduit(error: unknown, context: ProductValidationContext): string {
  const body = record(record(error)?.body);
  if (Array.isArray(body?.issues) && body.issues.length > 0) {
    return messagesIssues(body.issues, context);
  }
  const message = error instanceof Error ? error.message : "";
  if (/validation failed/i.test(message)) {
    return "Vérifiez les noms, les prix et les limites de choix du produit, puis réessayez.";
  }
  return message || "Impossible d’enregistrer le produit. Réessayez dans un instant.";
}
