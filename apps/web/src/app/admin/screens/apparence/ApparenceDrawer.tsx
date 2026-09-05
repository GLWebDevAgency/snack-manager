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

import { useEffect, useMemo, useState } from "react";
import {
  SCENOGRAPHIES,
  SCENOGRAPHY_DESCRIPTIONS,
  SCENOGRAPHY_LABELS,
  SCREEN_ORIENTATIONS,
  SCREEN_ORIENTATION_LABELS,
  SCREEN_THEMES,
  SCREEN_THEME_HINTS,
  SCREEN_THEME_LABELS,
  masquePourFond,
  type Brand,
  type ScreenScenePayload,
  type ScreenTheme,
  type ScreenView,
} from "@sm/contracts";
import { api, type TenantMe } from "@/lib/api";
import { cx } from "@/lib/cx";
import { Btn, Drawer, Modal, useToast } from "@/components/ui";
import { useSceneRotation } from "@/components/board/use-scene-rotation";
import { LiveStage } from "./LiveStage";
import { StillStage } from "./StillStage";
import { useScreenPreview } from "./use-screen-preview";

/** Identité stable : une liste vide neuve à chaque rendu relancerait la rotation. */
const VIDE: ScreenScenePayload[] = [];

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
    <div className="mb-2 text-[11px] font-extrabold uppercase tracking-[0.06em] text-mut">
      {children}
    </div>
  );
}

const choix = (actif: boolean) =>
  cx(
    "cf-press rounded-card border text-left",
    actif ? "border-accent bg-accentwash" : "border-line2 hover:border-white/25",
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
  const base = useMemo(
    () => ({
      orientation: screen.orientation,
      theme: screen.theme,
      scenography: screen.scenography,
    }),
    [screen.orientation, screen.theme, screen.scenography],
  );
  const [draft, setDraft] = useState(base);
  const [saving, setSaving] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [paused, setPaused] = useState(false);
  const [brand, setBrand] = useState<Brand | null>(null);

  const dirty =
    draft.orientation !== base.orientation ||
    draft.theme !== base.theme ||
    draft.scenography !== base.scenography;

  const { content, error, loading } = useScreenPreview({ screenId: screen.id, ...draft });
  const scenes = content?.scenes ?? VIDE;
  const { current, leaving, index, go } = useSceneRotation(scenes, { paused });

  // Le masque de BASE, pour les échantillons de fond : le contenu d'aperçu
  // porte déjà la variante, et la base ne s'en déduit pas.
  useEffect(() => {
    let alive = true;
    api
      .get<TenantMe>("/tenants/me")
      .then((me) => {
        if (alive) setBrand(me.brand);
      })
      .catch(() => {
        /* sans masque, les fonds gardent leur libellé et perdent leur échantillon */
      });
    return () => {
      alive = false;
    };
  }, []);

  async function save() {
    if (!dirty || saving) return;
    setSaving(true);
    try {
      const updated = await api.patch<ScreenView>(`/screens/${screen.id}`, draft);
      onSaved(updated);
      toast("Apparence enregistrée — l'écran suit dans la minute", { icon: "check" });
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Enregistrement impossible — réessayez");
    } finally {
      setSaving(false);
    }
  }

  const requestClose = () => (dirty ? setConfirmClose(true) : onClose());

  return (
    <Drawer
      open
      onClose={requestClose}
      title={`Apparence — ${screen.name}`}
      width={640}
      footer={
        <div className="flex items-center justify-between gap-3">
          <span className="min-w-0 truncate text-[13px] text-mut">
            {dirty ? "Modifications non enregistrées" : "Apparence à jour"}
          </span>
          <div className="flex shrink-0 items-center gap-2">
            <Btn variant="ghost" size="sm" onClick={requestClose}>
              Fermer
            </Btn>
            <Btn
              variant="primary"
              size="sm"
              icon="check"
              disabled={!dirty || saving}
              onClick={() => void save()}
            >
              {saving ? "Enregistrement…" : "Enregistrer l'apparence"}
            </Btn>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-5 p-[18px]">
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
        />

        {/* ── Scénographie : des tuiles vivantes ── */}
        <section>
          <Titre>Scénographie</Titre>
          <div className="grid grid-cols-2 gap-3">
            {SCENOGRAPHIES.map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={draft.scenography === s}
                onClick={() => setDraft((d) => ({ ...d, scenography: s }))}
                className={cx(choix(draft.scenography === s), "flex flex-col gap-2 p-2")}
              >
                {content && current ? (
                  <StillStage content={content} scene={current} scenography={s} />
                ) : (
                  <div className="aspect-video w-full rounded-ctrl bg-black/40" />
                )}
                <div className="px-1 pb-1">
                  <div className="text-sm font-bold text-ink">{SCENOGRAPHY_LABELS[s]}</div>
                  <div className="text-xs leading-snug text-mut">{SCENOGRAPHY_DESCRIPTIONS[s]}</div>
                </div>
              </button>
            ))}
          </div>
        </section>

        {/* ── Fond ── */}
        <section>
          <Titre>Fond</Titre>
          <div className="grid gap-2 sm:grid-cols-3">
            {SCREEN_THEMES.map((t) => (
              <button
                key={t}
                type="button"
                aria-pressed={draft.theme === t}
                onClick={() => setDraft((d) => ({ ...d, theme: t }))}
                className={cx(choix(draft.theme === t), "flex items-start gap-2.5 px-3 py-2.5")}
              >
                <Echantillon brand={brand} theme={t} />
                <span className="min-w-0">
                  <span className="block text-sm font-bold text-ink">{SCREEN_THEME_LABELS[t]}</span>
                  <span className="block text-xs leading-snug text-mut">{SCREEN_THEME_HINTS[t]}</span>
                </span>
              </button>
            ))}
          </div>
        </section>

        {/* ── Orientation ── */}
        <section>
          <Titre>Orientation</Titre>
          <div className="grid grid-cols-2 gap-2">
            {SCREEN_ORIENTATIONS.map((o) => (
              <button
                key={o}
                type="button"
                aria-pressed={draft.orientation === o}
                onClick={() => setDraft((d) => ({ ...d, orientation: o }))}
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
        </section>
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
              variant="ink"
              style={{ background: "var(--cf-red)" }}
              onClick={() => {
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
          L&apos;apparence n&apos;a pas été enregistrée&nbsp;: «&nbsp;{screen.name}&nbsp;» garde
          la sienne.
        </p>
      </Modal>
    </Drawer>
  );
}
