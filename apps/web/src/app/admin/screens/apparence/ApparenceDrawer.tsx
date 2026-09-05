"use client";

/**
 * LE TIROIR « APPARENCE » — choisir en regardant.
 *
 * Le brouillon est local ; l'aperçu le suit avant tout enregistrement, et il
 * est VIVANT : la vraie boucle, la vraie carte, redemandées comme sur le
 * téléviseur. Une scénographie se choisit sur une tuile qui rend la scène du
 * moment dans cette scénographie — le module lui-même, pas une image, si bien
 * que la tuile et le téléviseur ne peuvent pas diverger. Rien n'est écrit
 * tant que le gérant n'a pas enregistré.
 *
 * API : POST /screens/preview (aperçu) · PATCH /screens/:id (enregistrement)
 */

import { useEffect, useRef, useState } from "react";
import {
  SCREEN_ORIENTATIONS,
  SCREEN_ORIENTATION_LABELS,
  SCREEN_THEMES,
  SCREEN_THEME_LABELS,
  masquePourFond,
  type Brand,
  type ScreenScenePayload,
  type ScreenPreviewService,
  type ScreenTheme,
  type ScreenView,
} from "@sm/contracts";
import { api, type TenantMe } from "@/lib/api";
import { cx } from "@/lib/cx";
import { Btn, Drawer, Modal, useToast } from "@/components/ui";
import { useSceneRotation } from "@/components/board/use-scene-rotation";
import { LiveStage } from "./LiveStage";
import { PresentationControls } from "./PresentationControls";
import { ScenographyGallery } from "./ScenographyGallery";
import { useScreenPreview } from "./use-screen-preview";
import {
  appearanceDraft,
  appearanceOf,
  appearancePatch,
  editAppearance,
  type Appearance,
  type AppearanceEdits,
} from "./appearance-draft";

/** Identité stable : une liste vide neuve à chaque rendu relancerait la rotation. */
const VIDE: ScreenScenePayload[] = [];

const FOND_DESCRIPTIONS: Record<ScreenTheme, string> = {
  brand: "Les couleurs de votre établissement.",
  dark: "Votre logo et votre couleur principale sur fond sombre.",
  light: "Votre logo et votre couleur principale sur fond clair.",
};

/** Les trois pastilles d'un fond — fond, surface, accent — par la même règle que l'écran. */
function Echantillon({ brand, theme }: { brand: Brand | null; theme: ScreenTheme }) {
  if (!brand) return null;
  const p = masquePourFond(brand, theme).palette;
  return (
    <span className="flex shrink-0 items-center -space-x-1 pt-0.5" aria-hidden>
      {[p.ground, p.surface, p.accent].map((c, i) => (
        <span
          key={i}
          className="size-3.5 rounded-full border border-black/30"
          style={{ background: c }}
        />
      ))}
    </span>
  );
}

function Titre({ children }: { children: string }) {
  return (
    <legend className="mb-2.5 text-sm font-bold text-ink">
      {children}
    </legend>
  );
}

const choix = (actif: boolean) =>
  cx(
    "cf-press rounded-card border text-left disabled:cursor-wait",
    actif ? "border-accent bg-accentwash" : "border-line2 hover:border-ink/25",
  );

export function ApparenceDrawer({
  screen,
  onClose,
  onSaved,
}: {
  screen: ScreenView;
  onClose: () => void;
  onSaved: (updated: ScreenView) => void;
}) {
  const toast = useToast();
  const base = appearanceOf(screen);
  const [edits, setEdits] = useState<AppearanceEdits>({});
  const draft = appearanceDraft(base, edits);
  const patch = appearancePatch(base, edits);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const [paused, setPaused] = useState(false);
  const [previewService, setPreviewService] = useState<ScreenPreviewService | undefined>();
  const [brand, setBrand] = useState<Brand | null>(null);
  const [controls, setControls] = useState<"models" | "custom">("models");

  const dirty = Object.keys(patch).length > 0;

  const { content, error, loading, stale, retry } = useScreenPreview({
    screenId: screen.id, ...draft, service: previewService,
  });
  const previewReady = !!content && !loading && !stale && !error;
  const scenes = content?.scenes ?? VIDE;
  const { current, leaving, index, go } = useSceneRotation(scenes, { paused });

  // Le masque de BASE, pour les échantillons de fond : le contenu d'aperçu
  // porte déjà la variante, et la base ne s'en déduit pas.
  useEffect(() => {
    const controller = new AbortController();
    api
      .get<TenantMe>("/tenants/me", { signal: controller.signal })
      .then((me) => {
        if (!controller.signal.aborted) setBrand(me.brand);
      })
      .catch(() => {
        /* sans masque, les fonds gardent leur libellé et perdent leur échantillon */
      });
    return () => {
      controller.abort();
    };
  }, []);

  function choose<K extends keyof Appearance>(key: K, value: Appearance[K]) {
    if (savingRef.current) return;
    setEdits((previous) => editAppearance(base, previous, key, value));
    setSaveError(null);
  }

  async function save() {
    if (!dirty || savingRef.current || !previewReady) return;
    // La garde agit immédiatement, avant même le rendu des contrôles désactivés.
    savingRef.current = true;
    setSaving(true);
    setSaveError(null);
    try {
      const updated = await api.patch<ScreenView>(`/screens/${screen.id}`, patch);
      onSaved(updated);
      toast("Apparence enregistrée", { icon: "check" });
      onClose();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Enregistrement impossible. Réessayez.");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  const requestClose = () => {
    if (savingRef.current) return;
    if (dirty) setConfirmClose(true);
    else onClose();
  };

  return (
    <Drawer
      open
      onClose={requestClose}
      title={`Apparence — ${screen.name}`}
      width={1120}
      footer={
        <div className="flex flex-col gap-3">
          {saveError ? (
            <p role="alert" className="text-sm text-alertt">
              {saveError} Vos choix restent disponibles dans cet aperçu.
            </p>
          ) : null}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p role="status" className="text-[13px] text-mut">
              {saving
                ? "Enregistrement en cours…"
                : dirty
                  ? !previewReady
                    ? "Vérifiez l’aperçu avant d’enregistrer."
                    : "Vos changements sont prêts à être enregistrés."
                  : "Réglages enregistrés de cet écran"}
            </p>
            <div className="flex shrink-0 items-center gap-2">
              <Btn variant="ghost" size="sm" disabled={saving} onClick={requestClose}>
                {dirty ? "Annuler" : "Fermer"}
              </Btn>
              <Btn
                variant="primary"
                size="sm"
                icon="check"
                disabled={!dirty || saving || !previewReady}
                onClick={() => void save()}
                className="flex-1 sm:flex-initial"
              >
                {saving ? "Enregistrement…" : "Enregistrer l'apparence"}
              </Btn>
            </div>
          </div>
        </div>
      }
    >
      <div className="grid items-start gap-6 p-[18px] lg:grid-cols-[minmax(0,1.65fr)_minmax(300px,1fr)] lg:gap-8 lg:p-6">
        <div className="min-w-0 lg:sticky lg:top-0">
          <div className="mb-4">
            <h3 className="text-lg font-semibold tracking-tight text-ink">Aperçu de votre carte</h3>
            <p className="mt-1 text-sm leading-relaxed text-mut">
              Ces modèles reprennent automatiquement l’identité de votre établissement. Les réglages recommandés préservent une présentation cohérente sur tous vos supports.
            </p>
          </div>
          <fieldset disabled={saving} className="mb-4">
            <legend className="mb-2 text-[13px] font-semibold text-ink">Service affiché</legend>
            <div className="inline-flex gap-1 rounded-ctrl border border-line2 bg-surface2 p-1">
              {([
                { value: undefined, label: "Maintenant" },
                { value: "lunch", label: "Midi" },
                { value: "dinner", label: "Soir" },
              ] as const).map(({ value, label }) => (
                <button
                  key={label}
                  type="button"
                  aria-pressed={previewService === value}
                  onClick={() => {
                    if (!savingRef.current) setPreviewService(value);
                  }}
                  className={cx(
                    "cf-press min-h-10 rounded-ctrl px-3 text-[13px] font-semibold disabled:cursor-wait",
                    previewService === value ? "bg-btn text-onfill shadow-soft" : "text-mut hover:text-ink",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </fieldset>
          <LiveStage
            content={content}
            current={current}
            leaving={leaving}
            index={index}
            paused={paused}
            onTogglePause={() => setPaused((p) => !p)}
            onGo={go}
            loading={loading}
            error={error}
            stale={stale}
            onRetry={retry}
            previewService={previewService}
          />
        </div>

        <div className="flex min-w-0 flex-col gap-6" aria-busy={saving}>
        <div className="flex gap-1 rounded-ctrl border border-line2 bg-surface2 p-1" role="group" aria-label="Réglages du menu">
          {([{ key: "models", label: "Modèles" }, { key: "custom", label: "Personnaliser" }] as const).map(({ key, label }) => (
            <button key={key} type="button" aria-pressed={controls === key} onClick={() => setControls(key)}
              className={cx("cf-press min-h-11 flex-1 rounded-ctrl px-3 text-sm font-semibold", controls === key ? "bg-btn text-onfill shadow-soft" : "text-mut hover:text-ink")}>
              {label}
            </button>
          ))}
        </div>
        {controls === "models" ? (
          <ScenographyGallery value={draft.scenography} content={content} onChange={(value) => choose("scenography", value)} disabled={saving} />
        ) : <>
        <PresentationControls value={draft.presentation} onChange={(value) => choose("presentation", value)} disabled={saving} />

        {/* ── Fond ── */}
        <fieldset disabled={saving}>
          <Titre>Fond</Titre>
          <div className="grid gap-2">
            {SCREEN_THEMES.map((t) => (
              <button
                key={t}
                type="button"
                aria-pressed={draft.theme === t}
                onClick={() => choose("theme", t)}
                className={cx(choix(draft.theme === t), "flex items-start gap-2.5 px-3 py-2.5")}
              >
                <Echantillon brand={brand} theme={t} />
                <span className="min-w-0">
                  <span className="block text-sm font-bold text-ink">{SCREEN_THEME_LABELS[t]}</span>
                  <span className="block text-xs leading-snug text-mut">{FOND_DESCRIPTIONS[t]}</span>
                </span>
              </button>
            ))}
          </div>
        </fieldset>

        {/* ── Orientation ── */}
        <fieldset disabled={saving}>
          <Titre>Orientation</Titre>
          <div className="grid grid-cols-2 gap-2">
            {SCREEN_ORIENTATIONS.map((o) => (
              <button
                key={o}
                type="button"
                aria-pressed={draft.orientation === o}
                onClick={() => choose("orientation", o)}
                className={cx(
                  choix(draft.orientation === o),
                  "px-3 py-2.5 text-sm font-bold",
                  draft.orientation === o ? "text-ink" : "text-mut",
                )}
              >
                {SCREEN_ORIENTATION_LABELS[o]}
              </button>
            ))}
          </div>
        </fieldset>
        </>}
        </div>
      </div>

      <Modal
        open={confirmClose}
        onClose={() => setConfirmClose(false)}
        title="Abandonner les modifications ?"
        destructive
        width={420}
        footer={
          <>
            <Btn variant="ghost" onClick={() => setConfirmClose(false)}>
              Reprendre
            </Btn>
            <Btn
              variant="danger"
              onClick={() => {
                if (savingRef.current) return;
                setConfirmClose(false);
                onClose();
              }}
            >
              Abandonner
            </Btn>
          </>
        }
      >
        <p className="leading-relaxed">
          Les changements de cet aperçu seront abandonnés.
        </p>
      </Modal>
    </Drawer>
  );
}
