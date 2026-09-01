"use client";

/**
 * Modale de mouvement de stock — réception (purchase), perte (waste),
 * inventaire (count : la valeur saisie REMPLACE le stock courant).
 * POST /supply/movements ; le serveur enregistre le delta et verrouille la ligne.
 */

import { useState } from "react";
import type { MovementInputType, SupplyIngredient } from "@sm/contracts";
import { api, ApiError } from "@/lib/api";
import { cx } from "@/lib/cx";
import { Btn, Field, Input, Modal, useToast } from "@/components/ui";
import { UNIT_LABELS, fmtQty, parseDecimal } from "./shared";

const META: Record<
  MovementInputType,
  { title: string; qtyLabel: string; hint: string; submit: string }
> = {
  purchase: {
    title: "Réception",
    qtyLabel: "Quantité reçue",
    hint: "Ajoutée au stock courant.",
    submit: "Enregistrer la réception",
  },
  waste: {
    title: "Perte",
    qtyLabel: "Quantité perdue",
    hint: "Retirée du stock courant (casse, péremption…).",
    submit: "Enregistrer la perte",
  },
  count: {
    title: "Inventaire",
    qtyLabel: "Stock compté",
    hint: "Remplace le stock courant par la valeur comptée.",
    submit: "Valider l'inventaire",
  },
};

export function MovementModal({
  ingredient,
  type,
  onClose,
  onDone,
}: {
  ingredient: SupplyIngredient;
  type: MovementInputType;
  onClose: () => void;
  /** Stock recalculé par l'API (currentStock, belowPar). */
  onDone: (currentStock: number, belowPar: boolean) => void;
}) {
  const toast = useToast();
  const meta = META[type];
  const unit = UNIT_LABELS[ingredient.unit];

  const [qtyRaw, setQtyRaw] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const qty = parseDecimal(qtyRaw);
  const preview =
    qty === null
      ? null
      : type === "purchase"
        ? ingredient.currentStock + qty
        : type === "waste"
          ? ingredient.currentStock - qty
          : qty;
  const overWaste =
    type === "waste" && qty !== null && qty > ingredient.currentStock;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (qty === null || (type !== "count" && qty <= 0)) {
      setError(
        type === "count"
          ? "Quantité invalide (0 accepté pour un stock à zéro)."
          : "Quantité strictement positive requise.",
      );
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const res = await api.post<{
        currentStock: number;
        belowPar: boolean;
      }>("/supply/movements", {
        ingredientId: ingredient.id,
        type,
        qty,
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      toast(
        `${meta.title} enregistrée — stock : ${fmtQty(res.currentStock)} ${unit}`,
        { icon: "check" },
      );
      onDone(res.currentStock, res.belowPar);
      onClose();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Enregistrement impossible — réessayez.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      // Pendant l'enregistrement, aucune sortie ne ferme : Échap, le voile et
      // la croix passent tous ici — sinon le POST continue en arrière-plan et
      // une ressaisie doublerait le mouvement.
      onClose={() => {
        if (!saving) onClose();
      }}
      title={`${meta.title} — ${ingredient.name}`}
      footer={
        <>
          <Btn variant="ghost" size="sm" onClick={onClose} disabled={saving}>
            Annuler
          </Btn>
          <Btn type="submit" size="sm" form="sm-movement-form" disabled={saving}>
            {saving ? "Enregistrement…" : meta.submit}
          </Btn>
        </>
      }
    >
      <form id="sm-movement-form" onSubmit={submit} className="flex flex-col gap-4">
        <p className="text-[13px] text-mut tabular-nums">
          Stock courant :{" "}
          <span className="font-bold text-ink">
            {fmtQty(ingredient.currentStock)} {unit}
          </span>
          {ingredient.parLevel > 0 && (
            <> · seuil {fmtQty(ingredient.parLevel)} {unit}</>
          )}
        </p>

        <Field
          label={`${meta.qtyLabel} (${unit})`}
          htmlFor="mv-qty"
          hint={meta.hint}
          error={error}
        >
          <div className="relative">
            <Input
              id="mv-qty"
              inputMode="decimal"
              autoFocus
              value={qtyRaw}
              onChange={(e) => setQtyRaw(e.target.value)}
              placeholder={type === "count" ? "Ex. 12,5" : "Ex. 5"}
              aria-describedby="mv-preview"
              className="pr-12 tabular-nums"
            />
            <span
              aria-hidden
              className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-sm text-mut"
            >
              {unit}
            </span>
          </div>
        </Field>

        <Field label="Note (optionnel)" htmlFor="mv-note">
          <Input
            id="mv-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Ex. BL n° 1234, casse en cuisine…"
            maxLength={300}
          />
        </Field>

        <p id="mv-preview" className="text-[13px] tabular-nums" aria-live="polite">
          {preview !== null && (
            <>
              <span className="text-mut">Nouveau stock : </span>
              <span
                className={cx(
                  "font-bold",
                  preview < 0
                    ? "text-alertt"
                    : preview < ingredient.parLevel
                      ? "text-prept"
                      : "text-okt",
                )}
              >
                {fmtQty(preview)} {unit}
              </span>
              {overWaste && (
                <span className="ml-2 text-prept">
                  La perte dépasse le stock courant.
                </span>
              )}
            </>
          )}
        </p>
      </form>
    </Modal>
  );
}
