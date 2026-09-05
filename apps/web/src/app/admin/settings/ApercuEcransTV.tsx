"use client";

import { useId, useState } from "react";
import { SCENOGRAPHY_DEFAULT, SCENOGRAPHY_FAMILIES, SCENOGRAPHY_LABELS, SCREEN_PRESENTATION_DEFAULT, type Brand, type Scenography, type ScreenOrientation, type ScreenPreviewService, type ScreenScenePayload } from "@sm/contracts";
import { Field, Select } from "@/components/ui";
import { useSceneRotation } from "@/components/board/use-scene-rotation";
import { isDemoActive, withDemoParam } from "@/lib/demo/mode";
import { LiveStage } from "../screens/apparence/LiveStage";
import { PresentationControls } from "../screens/apparence/PresentationControls";
import { useScreenPreview } from "../screens/apparence/use-screen-preview";

const EMPTY_SCENES: ScreenScenePayload[] = [];

/** La marque est envoyée uniquement à l'aperçu : aucun écran ni aucune identité n'est enregistré ici. */
export function ApercuEcransTV({ brand }: { brand: Brand }) {
  const id = useId();
  const [scenography, setScenography] = useState<Scenography>(SCENOGRAPHY_DEFAULT);
  const [orientation, setOrientation] = useState<ScreenOrientation>("landscape");
  const [service, setService] = useState<ScreenPreviewService | undefined>("lunch");
  const [presentation, setPresentation] = useState({ ...SCREEN_PRESENTATION_DEFAULT });
  const [paused, setPaused] = useState(false);
  const { content, loading, stale, error, retry } = useScreenPreview({
    screenId: null, scenography, orientation, theme: "brand", presentation, service, brandDraft: brand,
  });
  const { current, leaving, index, go } = useSceneRotation(content?.scenes ?? EMPTY_SCENES, { paused });
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <p className="rounded-ctrl border border-line2 bg-surface2 px-3 py-2.5 text-xs leading-relaxed text-mut">
        Aperçu uniquement. Votre carte réelle reprend l’identité en cours d’édition. Ces essais ne changent aucun écran.
      </p>
      <Field label="Modèle" htmlFor={`${id}-model`}>
        <Select id={`${id}-model`} value={scenography} onChange={(event) => setScenography(event.target.value as Scenography)}>
          {SCENOGRAPHY_FAMILIES.map((family) => <optgroup key={family.id} label={family.label}>
            {family.scenographies.map((key) => <option key={key} value={key}>{SCENOGRAPHY_LABELS[key]}</option>)}
          </optgroup>)}
        </Select>
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Format" htmlFor={`${id}-orientation`}>
          <Select id={`${id}-orientation`} value={orientation} onChange={(event) => setOrientation(event.target.value as ScreenOrientation)}>
            <option value="landscape">Paysage</option><option value="portrait">Portrait</option>
          </Select>
        </Field>
        <Field label="Service" htmlFor={`${id}-service`}>
          <Select id={`${id}-service`} value={service ?? "now"} onChange={(event) => setService(event.target.value === "now" ? undefined : event.target.value as ScreenPreviewService)}>
            <option value="now">Maintenant</option><option value="lunch">Midi</option><option value="dinner">Soir</option>
          </Select>
        </Field>
      </div>
      <LiveStage content={content} current={current} leaving={leaving} index={index} paused={paused}
        onTogglePause={() => setPaused((value) => !value)} onGo={go} loading={loading} stale={stale}
        error={error} onRetry={retry} previewService={service} />
      <details className="rounded-ctrl border border-line2 p-3">
        <summary className="cursor-pointer text-sm font-semibold text-ink">Essayer une personnalisation</summary>
        <div className="pt-4"><PresentationControls value={presentation} onChange={setPresentation} /></div>
      </details>
      <p className="text-xs leading-relaxed text-mut">Enregistrez votre identité pour l’appliquer à tous vos supports. Le modèle et les réglages de chaque téléviseur se choisissent dans les écrans de salle.</p>
      <a href="/admin/screens" target="_blank" rel="noopener noreferrer"
        onClick={(event) => { if (isDemoActive()) event.currentTarget.href = withDemoParam("/admin/screens"); }}
        className="cf-press flex min-h-11 items-center justify-center rounded-ctrl border border-linefirm px-3 py-2 text-sm font-semibold text-ink hover:bg-surface2">
        Gérer les écrans de salle ↗<span className="sr-only"> (nouvel onglet)</span>
      </a>
    </div>
  );
}
