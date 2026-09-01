"use client";

import { useState, type FormEvent } from "react";
import {
  LoyaltyRewardCreateSchema,
  type LoyaltyRewardCreate,
  type LoyaltyRewardKind,
  type LoyaltyRewardView,
} from "@sm/contracts";
import { Btn, Drawer, Field, Input, Select, Textarea, Toggle } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { centsToInput, parseEuroInput, parsePositiveInteger } from "../form-utils";
import { loyaltyApi } from "../data";

type RewardDraft = {
  name: string;
  description: string;
  costUnits: string;
  kind: LoyaltyRewardKind;
  value: string;
  productRef: string;
  active: boolean;
};

function initialDraft(reward: LoyaltyRewardView | null): RewardDraft {
  return reward
    ? {
        name: reward.name,
        description: reward.description,
        costUnits: String(reward.costUnits),
        kind: reward.kind,
        value: reward.valueCents ? centsToInput(reward.valueCents) : "",
        productRef: reward.productRef ?? "",
        active: reward.active,
      }
    : {
        name: "",
        description: "",
        costUnits: "",
        kind: "custom",
        value: "",
        productRef: "",
        active: true,
      };
}
function buildReward(draft: RewardDraft): { body?: LoyaltyRewardCreate; error?: string } {
  const costUnits = parsePositiveInteger(draft.costUnits);
  if (costUnits === null) return { error: "Le coût doit être un nombre entier positif." };
  const valueCents = draft.kind === "fixed_discount" ? parseEuroInput(draft.value) : null;
  if (draft.kind === "fixed_discount" && valueCents === null) {
    return { error: "Indiquez le montant exact de la remise, avec deux décimales maximum." };
  }
  const productRef = draft.kind === "product" ? draft.productRef.trim() || null : null;
  if (draft.kind === "product" && !productRef) return { error: "Indiquez le produit offert." };

  const parsed = LoyaltyRewardCreateSchema.safeParse({
    name: draft.name,
    description: draft.description,
    costUnits,
    kind: draft.kind,
    valueCents,
    productRef,
    active: draft.active,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Vérifiez la récompense." };
  return { body: parsed.data };
}

export function RewardDrawer({
  reward,
  unitPlural,
  onClose,
  onSaved,
}: {
  reward: LoyaltyRewardView | null;
  unitPlural: string;
  onClose: () => void;
  onSaved: (reward: LoyaltyRewardView) => void;
}) {
  const [draft, setDraft] = useState(() => initialDraft(reward));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const formId = `loyalty-reward-${reward?.id ?? "new"}`;

  function patch<K extends keyof RewardDraft>(key: K, value: RewardDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    const built = buildReward(draft);
    if (!built.body) {
      setError(built.error ?? "Vérifiez le formulaire.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const saved = reward
        ? await loyaltyApi.updateReward(reward.id, built.body)
        : await loyaltyApi.createReward(built.body);
      onSaved(saved);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Enregistrement impossible — réessayez.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer
      open
      onClose={() => { if (!saving) onClose(); }}
      title={reward ? "Modifier la récompense" : "Nouvelle récompense"}
      width={470}
      footer={
        <div className="flex items-center justify-end gap-2">
          <Btn variant="ghost" size="sm" disabled={saving} onClick={onClose}>Annuler</Btn>
          <Btn type="submit" form={formId} size="sm" disabled={saving} icon="check">
            {saving ? "Enregistrement…" : reward ? "Enregistrer" : "Créer la récompense"}
          </Btn>
        </div>
      }
    >
      <form id={formId} onSubmit={submit} className="space-y-5 p-[18px]">
        <div className="rounded-card border border-accent/20 bg-accent/8 p-3 text-xs leading-5 text-ink">
          Le client verra exactement ce nom, ce coût et cette description sur sa carte.
        </div>

        <Field label="Nom" htmlFor={`${formId}-name`}>
          <Input id={`${formId}-name`} autoFocus value={draft.name} maxLength={80} onChange={(e) => patch("name", e.target.value)} />
        </Field>
        <Field label="Description" htmlFor={`${formId}-description`} hint={`${draft.description.length}/300 caractères`}>
          <Textarea id={`${formId}-description`} value={draft.description} maxLength={300} onChange={(e) => patch("description", e.target.value)} />
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={`Coût en ${unitPlural}`} htmlFor={`${formId}-cost`}>
            <Input id={`${formId}-cost`} inputMode="numeric" value={draft.costUnits} onChange={(e) => patch("costUnits", e.target.value)} />
          </Field>
          <Field label="Nature" htmlFor={`${formId}-kind`}>
            <Select id={`${formId}-kind`} value={draft.kind} onChange={(e) => patch("kind", e.target.value as LoyaltyRewardKind)}>
              <option value="custom">Avantage personnalisé</option>
              <option value="fixed_discount">Remise fixe</option>
              <option value="product">Produit offert</option>
            </Select>
          </Field>
        </div>

        {draft.kind === "fixed_discount" && (
          <Field label="Montant de la remise (€)" htmlFor={`${formId}-value`} hint="Ex. 5,00">
            <Input id={`${formId}-value`} inputMode="decimal" value={draft.value} onChange={(e) => patch("value", e.target.value)} />
          </Field>
        )}
        {draft.kind === "product" && (
          <Field label="Produit offert" htmlFor={`${formId}-product`} hint="Nom ou référence telle qu'elle apparaît sur votre carte">
            <Input id={`${formId}-product`} value={draft.productRef} maxLength={120} onChange={(e) => patch("productRef", e.target.value)} />
          </Field>
        )}

        <div className="flex items-center justify-between gap-4 rounded-card border border-white/8 bg-[image:var(--cf-elev-gradient)] p-3.5">
          <div>
            <p className="text-sm font-bold text-ink">Récompense active</p>
            <p className="mt-0.5 text-xs text-mut">Visible et utilisable par les clients.</p>
          </div>
          <Toggle label="Récompense active" on={draft.active} onChange={(active) => patch("active", active)} />
        </div>

        {error && <p className="rounded-card border border-alert/35 bg-alert/10 p-3 text-xs text-alertt" role="alert">{error}</p>}
      </form>
    </Drawer>
  );
}
