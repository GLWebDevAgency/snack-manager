"use client";

import { useId } from "react";
import { SCREEN_PRESENTATION_DEFAULT, type ScreenPresentation } from "@sm/contracts";
import { Btn, Field, Select } from "@/components/ui";

const HERITAGE = "Identité de l’établissement";

/** Des choix bornés de composition ; les couleurs et les logos restent ceux de la marque. */
export function PresentationControls({ value, onChange, disabled = false }: {
  value: ScreenPresentation;
  onChange: (value: ScreenPresentation) => void;
  disabled?: boolean;
}) {
  const id = useId();
  const custom = Object.entries(SCREEN_PRESENTATION_DEFAULT).some(([key, item]) =>
    value[key as keyof ScreenPresentation] !== item,
  );
  return (
    <fieldset disabled={disabled} className="flex min-w-0 flex-col gap-4">
      <legend className="mb-2 text-sm font-bold text-ink">Personnalisation</legend>
      <p className="text-xs leading-relaxed text-mut">Ces modèles reprennent automatiquement l’identité de votre établissement. Les réglages recommandés préservent une présentation cohérente sur tous vos supports.</p>
      <Field label="Arrondis" htmlFor={`${id}-corners`}>
        <Select id={`${id}-corners`} value={value.corners} onChange={(event) => onChange({ ...value, corners: event.target.value as ScreenPresentation["corners"] })}>
          <option value="brand">{HERITAGE}</option>
          <option value="square">Angles droits</option>
          <option value="soft">Coins adoucis</option>
          <option value="round">Arrondis généreux</option>
        </Select>
      </Field>
      <Field label="Taille des prix" htmlFor={`${id}-prices`}>
        <Select id={`${id}-prices`} value={value.priceScale} onChange={(event) => onChange({ ...value, priceScale: event.target.value as ScreenPresentation["priceScale"] })}>
          <option value="compact">Discrète</option>
          <option value="balanced">Équilibrée</option>
          <option value="large">Grande</option>
        </Select>
      </Field>
      <Field label="Intensité du mouvement" htmlFor={`${id}-motion`} hint="La préférence de mouvement réduit de l’appareil reste respectée.">
        <Select id={`${id}-motion`} value={value.motion} onChange={(event) => onChange({ ...value, motion: event.target.value as ScreenPresentation["motion"] })}>
          <option value="brand">{HERITAGE}</option>
          <option value="subtle">Discrète</option>
          <option value="expressive">Expressive</option>
          <option value="off">Sans animation</option>
        </Select>
      </Field>
      <Btn variant="ghost" size="sm" disabled={disabled || !custom} onClick={() => onChange({ ...SCREEN_PRESENTATION_DEFAULT })}>
        Réinitialiser la personnalisation
      </Btn>
    </fieldset>
  );
}
