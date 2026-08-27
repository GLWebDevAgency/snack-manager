"use client";

/**
 * Panneau de création / édition d'ingrédient (Drawer 400px) :
 * nom, catégorie, unité, coût/unité, seuil, stockage, allergènes multi-select,
 * marques (édition seule — POST/PATCH/DELETE marques) et suppression douce.
 */

import { useState } from "react";
import {
  ALLERGENS,
  ALLERGEN_LABELS,
  BASE_UNITS,
  INGREDIENT_CATEGORIES,
  STORAGE_MODES,
  type Allergen,
  type BaseUnit,
  type IngredientCategory,
  type StorageMode,
  type SupplyBrand,
  type SupplyIngredient,
} from "@sm/contracts";
import { api, ApiError } from "@/lib/api";
import { cx } from "@/lib/cx";
import {
  Btn,
  Chip,
  Drawer,
  Field,
  Icon,
  IconBtn,
  Input,
  Modal,
  Select,
  useToast,
} from "@/components/ui";
import {
  CATEGORY_LABELS,
  DangerBtn,
  STORAGE_LABELS,
  UNIT_LABELS,
  centsToInput,
  parseDecimal,
  parseEurosToCents,
  supplementDepuisSaisie,
} from "./shared";

type Draft = {
  name: string;
  category: IngredientCategory;
  unit: BaseUnit;
  costEuros: string;
  parLevel: string;
  initialStock: string;
  storage: StorageMode;
  allergens: Allergen[];
  /**
   * Les trois champs qui font d'un ingrédient un SUPPLÉMENT PAYANT à la caisse.
   *
   * Tout le back-end existait — colonnes, contrats, projection vers le menu,
   * tests — et aucun formulaire ne les posait. Un gérant ne pouvait ni créer,
   * ni voir, ni corriger un supplément : le cheddar à 1 € se saisissait par
   * script ou n'existait pas.
   */
  removable: boolean;
  /**
   * Chaîne VIDE = pas de supplément (`null` côté API). « 0 » = supplément
   * gratuit proposé. La distinction n'est pas cosmétique : `0` fait apparaître
   * le choix à la caisse, `null` le retire du catalogue.
   */
  supplementEuros: string;
  /** Libellé caisse — prime sur le nom d'inventaire. Vide = on garde le nom. */
  displayName: string;
};

type FieldErrors = Partial<Record<"name" | "cost" | "par" | "stock", string>>;

function draftFrom(ing: SupplyIngredient | null): Draft {
  return ing
    ? {
        name: ing.name,
        category: ing.category,
        unit: ing.unit,
        costEuros: centsToInput(ing.costPerUnitCents),
        parLevel: String(ing.parLevel).replace(".", ","),
        initialStock: "",
        storage: ing.storage,
        allergens: [...ing.allergens],
        removable: ing.removable,
        // `centsToInput` n'est PAS réutilisable ici : il rendrait « 0,00 »
        // pour un supplément absent, transformant « désactivé » en « gratuit ».
        supplementEuros:
          ing.supplementPriceCents == null ? "" : centsToInput(ing.supplementPriceCents),
        displayName: ing.displayName ?? "",
      }
    : {
        name: "",
        category: "autre",
        unit: "kg",
        costEuros: "",
        parLevel: "",
        initialStock: "",
        storage: "sec",
        allergens: [],
        // Le défaut de `removable` dépend de la catégorie côté serveur
        // (`isRemovableByDefault`) : on ne le devine pas ici, on laisse
        // l'API trancher tant que le gérant n'y touche pas.
        removable: false,
        supplementEuros: "",
        displayName: "",
      };
}

export function IngredientDrawer({
  initial,
  onClose,
  onSaved,
  onDeleted,
}: {
  /** null = création ; sinon édition. */
  initial: SupplyIngredient | null;
  onClose: () => void;
  /** Ingrédient créé/mis à jour (fusionné dans la liste par le parent). */
  onSaved: (ing: SupplyIngredient) => void;
  onDeleted: (id: string) => void;
}) {
  const toast = useToast();
  // Après création, le panneau bascule en édition (gestion des marques).
  const [current, setCurrent] = useState<SupplyIngredient | null>(initial);
  const [draft, setDraft] = useState<Draft>(() => draftFrom(initial));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const isEdit = current !== null;
  const unit = UNIT_LABELS[draft.unit];

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const toggleAllergen = (a: Allergen) =>
    set(
      "allergens",
      draft.allergens.includes(a)
        ? draft.allergens.filter((x) => x !== a)
        : [...draft.allergens, a],
    );

  function validate(): {
    costPerUnitCents: number;
    parLevel: number;
    initialStock: number;
  } | null {
    const next: FieldErrors = {};
    if (!draft.name.trim()) next.name = "Le nom est requis.";
    const cost = draft.costEuros.trim() ? parseEurosToCents(draft.costEuros) : 0;
    if (cost === null) next.cost = "Montant invalide (ex. 12,50).";
    const par = draft.parLevel.trim() ? parseDecimal(draft.parLevel) : 0;
    if (par === null) next.par = "Quantité invalide.";
    const stock = draft.initialStock.trim()
      ? parseDecimal(draft.initialStock)
      : 0;
    if (stock === null) next.stock = "Quantité invalide.";
    setErrors(next);
    if (Object.keys(next).length) return null;
    return {
      costPerUnitCents: cost ?? 0,
      parLevel: par ?? 0,
      initialStock: stock ?? 0,
    };
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const parsed = validate();
    if (!parsed) return;
    setSaving(true);
    try {
      if (isEdit && current) {
        const updated = await api.patch<SupplyIngredient>(
          `/supply/ingredients/${current.id}`,
          {
            name: draft.name.trim(),
            category: draft.category,
            unit: draft.unit,
            allergens: draft.allergens,
            costPerUnitCents: parsed.costPerUnitCents,
            parLevel: parsed.parLevel,
            storage: draft.storage,
            removable: draft.removable,
            supplementPriceCents: supplementDepuisSaisie(draft.supplementEuros),
            displayName: draft.displayName.trim() || null,
          },
        );
        setCurrent(updated);
        onSaved(updated);
        toast("Ingrédient mis à jour", { icon: "check" });
        onClose();
      } else {
        const created = await api.post<SupplyIngredient>("/supply/ingredients", {
          name: draft.name.trim(),
          category: draft.category,
          unit: draft.unit,
          allergens: draft.allergens,
          costPerUnitCents: parsed.costPerUnitCents,
          currentStock: parsed.initialStock,
          parLevel: parsed.parLevel,
          storage: draft.storage,
          removable: draft.removable,
          supplementPriceCents: supplementDepuisSaisie(draft.supplementEuros),
          displayName: draft.displayName.trim() || null,
        });
        setCurrent(created);
        setDraft(draftFrom(created));
        onSaved(created);
        toast(`« ${created.name} » créé — ajoutez ses marques si besoin`, {
          icon: "check",
        });
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setErrors({ name: err.message });
      } else {
        toast(
          err instanceof ApiError ? err.message : "Enregistrement impossible",
        );
      }
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!current) return;
    setDeleting(true);
    try {
      await api.del(`/supply/ingredients/${current.id}`);
      toast(`« ${current.name} » supprimé`, { icon: "check" });
      onDeleted(current.id);
      onClose();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Suppression impossible");
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  return (
    <>
      <Drawer
        open
        onClose={onClose}
        title={isEdit ? "Modifier l'ingrédient" : "Nouvel ingrédient"}
        footer={
          <div className="flex items-center gap-2">
            {isEdit && (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="cf-press mr-auto rounded-pill px-2 py-1 text-[13px] font-semibold text-alertt hover:bg-alert/12 hover:text-alert"
              >
                Supprimer
              </button>
            )}
            <Btn variant="ghost" size="sm" onClick={onClose} className="ml-auto">
              Annuler
            </Btn>
            <Btn type="submit" size="sm" form="sm-ingredient-form" disabled={saving}>
              {saving ? "Enregistrement…" : "Enregistrer"}
            </Btn>
          </div>
        }
      >
        <form
          id="sm-ingredient-form"
          onSubmit={save}
          className="flex flex-col gap-4 px-[18px] py-4"
        >
          <Field label="Nom" htmlFor="ing-name" error={errors.name}>
            <Input
              id="ing-name"
              value={draft.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="Ex. Steak haché 45 g"
              maxLength={120}
              autoFocus={!isEdit}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Catégorie" htmlFor="ing-cat">
              <Select
                id="ing-cat"
                value={draft.category}
                onChange={(e) =>
                  set("category", e.target.value as IngredientCategory)
                }
              >
                {INGREDIENT_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABELS[c]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label="Unité de base"
              htmlFor="ing-unit"
              hint="Coût et stock s'expriment dans cette unité."
            >
              <Select
                id="ing-unit"
                value={draft.unit}
                onChange={(e) => set("unit", e.target.value as BaseUnit)}
              >
                {BASE_UNITS.map((u) => (
                  <option key={u} value={u}>
                    {UNIT_LABELS[u]}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field
              label={`Coût (€ / ${unit})`}
              htmlFor="ing-cost"
              error={errors.cost}
            >
              <Input
                id="ing-cost"
                inputMode="decimal"
                value={draft.costEuros}
                onChange={(e) => set("costEuros", e.target.value)}
                placeholder="Ex. 9,80"
                className="tabular-nums"
              />
            </Field>
            <Field
              label={`Seuil d'alerte (${unit})`}
              htmlFor="ing-par"
              error={errors.par}
              hint="Alerte « à commander » sous ce niveau."
            >
              <Input
                id="ing-par"
                inputMode="decimal"
                value={draft.parLevel}
                onChange={(e) => set("parLevel", e.target.value)}
                placeholder="Ex. 5"
                className="tabular-nums"
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Stockage" htmlFor="ing-storage">
              <Select
                id="ing-storage"
                value={draft.storage}
                onChange={(e) => set("storage", e.target.value as StorageMode)}
              >
                {STORAGE_MODES.map((s) => (
                  <option key={s} value={s}>
                    {STORAGE_LABELS[s]}
                  </option>
                ))}
              </Select>
            </Field>
          {/*
            ── À LA CAISSE ──────────────────────────────────────────────────
            Ces trois champs ne pilotent pas l'inventaire : ils décident de ce
            que le comptoir peut vendre en plus. Ils vivaient dans les colonnes,
            les contrats et la projection du menu — sans aucun formulaire pour
            les poser.
          */}
          <div className="mt-5 border-t border-white/6 pt-4">
            <div className="text-sm font-bold text-ink">À la caisse</div>
            <p className="mt-1 text-[12.5px] text-mut">
              Le supplément n&apos;apparaît que sur les plats dont la recette
              contient un pain, un féculent, une viande, un poisson ou un
              fromage — et jamais sur un plat qui contient déjà cet ingrédient.
            </p>

            <div className="mt-3 grid grid-cols-2 gap-3">
              <Field
                label="Prix en supplément"
                htmlFor="ing-supplement"
                hint="Vide = pas proposé. 0 = proposé, offert."
              >
                <Input
                  id="ing-supplement"
                  inputMode="decimal"
                  value={draft.supplementEuros}
                  onChange={(e) => set("supplementEuros", e.target.value)}
                  placeholder="Ex. 1,00"
                  className="tabular-nums"
                />
              </Field>
              <Field
                label="Nom à la caisse"
                htmlFor="ing-display"
                hint="Vide = le nom d’inventaire."
              >
                <Input
                  id="ing-display"
                  value={draft.displayName}
                  onChange={(e) => set("displayName", e.target.value)}
                  placeholder="Ex. Cheddar"
                  maxLength={60}
                />
              </Field>
            </div>

            <label className="mt-3 flex items-start gap-3 text-[13px]">
              <input
                type="checkbox"
                checked={draft.removable}
                onChange={(e) => set("removable", e.target.checked)}
                className="mt-0.5 size-4 shrink-0 accent-[var(--cf-accent)]"
              />
              <span className="min-w-0 text-mut">
                <span className="font-semibold text-ink">Retirable</span> — le
                client peut demander « sans » sur les plats qui en contiennent.
              </span>
            </label>
          </div>

            {!isEdit && (
              <Field
                label={`Stock initial (${unit})`}
                htmlFor="ing-stock"
                error={errors.stock}
                hint="Ensuite piloté par les mouvements."
              >
                <Input
                  id="ing-stock"
                  inputMode="decimal"
                  value={draft.initialStock}
                  onChange={(e) => set("initialStock", e.target.value)}
                  placeholder="Ex. 10"
                  className="tabular-nums"
                />
              </Field>
            )}
          </div>

          <fieldset>
            <legend className="mb-2 block text-xs font-bold uppercase tracking-[0.04em] text-mut">
              Allergènes (INCO)
            </legend>
            <div className="flex flex-wrap gap-1.5">
              {ALLERGENS.map((a) => (
                <Chip
                  key={a}
                  on={draft.allergens.includes(a)}
                  onClick={() => toggleAllergen(a)}
                >
                  {ALLERGEN_LABELS[a]}
                </Chip>
              ))}
            </div>
          </fieldset>

          {isEdit && current ? (
            <BrandsEditor
              ingredient={current}
              onChanged={(brands) => {
                const next = { ...current, brands };
                setCurrent(next);
                onSaved(next);
              }}
            />
          ) : (
            <p className="rounded-card border border-white/6 bg-[image:var(--cf-elev-gradient)] px-3.5 py-3 text-[13px] text-mut">
              Enregistrez l’ingrédient pour gérer ses marques.
            </p>
          )}
        </form>
      </Drawer>

      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={`Supprimer « ${current?.name ?? "" } » ?`}
        destructive
        footer={
          <>
            <Btn variant="ghost" onClick={() => setConfirmDelete(false)}>
              Annuler
            </Btn>
            <DangerBtn onClick={remove} disabled={deleting}>
              {deleting ? "Suppression…" : "Supprimer"}
            </DangerBtn>
          </>
        }
      >
        <p className="text-mut">
          L’ingrédient sera retiré des listes. Les recettes et l’historique de
          prix le conservent (suppression douce).
        </p>
      </Modal>
    </>
  );
}

/** Marques de l'ingrédient : ajout, préférée (étoile unique), suppression. */
function BrandsEditor({
  ingredient,
  onChanged,
}: {
  ingredient: SupplyIngredient;
  onChanged: (brands: SupplyBrand[]) => void;
}) {
  const toast = useToast();
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const brands = ingredient.brands;

  async function add() {
    const name = newName.trim();
    if (!name || busy) return;
    setBusy(true);
    try {
      // Première marque : préférée d'office.
      const brand = await api.post<SupplyBrand>(
        `/supply/ingredients/${ingredient.id}/brands`,
        { name, preferred: brands.length === 0 },
      );
      onChanged([...brands, brand]);
      setNewName("");
      toast("Marque ajoutée", { icon: "check" });
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Ajout impossible");
    } finally {
      setBusy(false);
    }
  }

  async function setPreferred(brand: SupplyBrand) {
    if (busy) return;
    setBusy(true);
    try {
      const next = !brand.preferred;
      await api.patch(`/supply/brands/${brand.id}`, { preferred: next });
      // Le serveur dé-préfère les autres quand preferred passe à true.
      onChanged(
        brands.map((b) =>
          b.id === brand.id
            ? { ...b, preferred: next }
            : { ...b, preferred: next ? false : b.preferred },
        ),
      );
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Modification impossible");
    } finally {
      setBusy(false);
    }
  }

  async function remove(brand: SupplyBrand) {
    if (busy) return;
    setBusy(true);
    try {
      await api.del(`/supply/brands/${brand.id}`);
      onChanged(brands.filter((b) => b.id !== brand.id));
      toast("Marque supprimée", { icon: "check" });
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Suppression impossible");
    } finally {
      setBusy(false);
    }
  }

  return (
    <fieldset>
      <legend className="mb-2 block text-xs font-bold uppercase tracking-[0.04em] text-mut">
        Marques
      </legend>
      {brands.length === 0 && (
        <p className="mb-2 text-[13px] text-mut">
          Aucune marque — ajoutez la référence habituelle.
        </p>
      )}
      <ul className="mb-2 flex flex-col gap-1.5">
        {brands.map((b) => (
          <li
            key={b.id}
            className="flex items-center gap-2 rounded-card border border-white/6 bg-[image:var(--cf-elev-gradient)] px-3 py-2"
          >
            <button
              type="button"
              onClick={() => setPreferred(b)}
              disabled={busy}
              aria-pressed={b.preferred}
              aria-label={
                b.preferred
                  ? `${b.name} : marque préférée — cliquer pour retirer`
                  : `Définir ${b.name} comme marque préférée`
              }
              title={b.preferred ? "Marque préférée" : "Définir comme préférée"}
              className={cx(
                "cf-press shrink-0",
                b.preferred ? "text-gold" : "text-mut hover:text-white",
              )}
            >
              <Icon
                name="star"
                size={15}
                fill={b.preferred ? "currentColor" : "none"}
              />
            </button>
            <span
              className="min-w-0 flex-1 truncate text-sm text-ink"
              title={b.notes ?? undefined}
            >
              {b.name}
            </span>
            <IconBtn
              icon="close"
              label={`Supprimer la marque ${b.name}`}
              size={26}
              iconSize={12}
              disabled={busy}
              onClick={() => remove(b)}
            />
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <Input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Nouvelle marque…"
          maxLength={120}
          aria-label="Nom de la nouvelle marque"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void add();
            }
          }}
        />
        <Btn
          variant="ghost"
          size="sm"
          icon="plus"
          disabled={!newName.trim() || busy}
          onClick={() => void add()}
        >
          Ajouter
        </Btn>
      </div>
    </fieldset>
  );
}
