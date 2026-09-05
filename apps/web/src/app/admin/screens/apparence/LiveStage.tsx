"use client";

import { useRef } from "react";
import type { ScreenContent, ScreenPreviewService, ScreenScenePayload } from "@sm/contracts";
import { cx } from "@/lib/cx";
import { Btn, Icon } from "@/components/ui";
import { BoardStage } from "@/components/board/board-stage";
import { useEmbeddedStage } from "@/components/board/use-stage";
import "@/components/board/board.css";
import "@/components/board/scenographies/comptoir/comptoir.css";

function Transport({
  label,
  icon,
  onClick,
  disabled,
}: {
  label: string;
  icon: "back" | "arrow" | "play" | "pause";
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cx(
        "cf-press grid size-11 shrink-0 place-items-center rounded-ctrl border border-line2 text-ink",
        "hover:border-ink/25 hover:bg-surface2 disabled:cursor-not-allowed disabled:opacity-30",
      )}
    >
      <Icon name={icon} size={14} />
    </button>
  );
}

/**
 * LE TÉLÉVISEUR MINIATURE — le même hôte que la salle, dans un cadre au ratio
 * de l'orientation. Sous lui, la barre de transport : le gérant regarde une
 * scène précise, revient, met en pause. La boucle reste celle du contenu.
 */
export function LiveStage({
  content,
  current,
  leaving,
  index,
  paused,
  onTogglePause,
  onGo,
  loading,
  error,
  stale,
  onRetry,
  previewService,
}: {
  content: ScreenContent | null;
  current: ScreenScenePayload | null;
  leaving: ScreenScenePayload | null;
  index: number;
  paused: boolean;
  onTogglePause: () => void;
  onGo: (delta: number) => void;
  loading: boolean;
  error: string | null;
  stale: boolean;
  onRetry: () => void;
  previewService?: ScreenPreviewService;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const orientation = content?.orientation ?? "landscape";
  const stage = useEmbeddedStage(ref, orientation);
  const total = content?.scenes.length ?? 0;

  return (
    <div className="flex flex-col gap-3">
      <div
        ref={ref}
        data-testid="apercu-ecran"
        className="relative mx-auto overflow-hidden rounded-card border border-line bg-bg shadow-card"
        style={
          orientation === "landscape"
            ? { width: "100%", aspectRatio: "16 / 9" }
            : { width: "min(100%, 282px)", aspectRatio: "9 / 16" }
        }
      >
        <BoardStage
          content={content}
          current={current}
          leaving={leaving}
          stage={stage}
          embed
          paused={paused}
          fallback={
            <div className="bd-layer" data-phase="in">
              <div className="bd-plate">
                <div className="bd-plate-kicker">Aperçu</div>
                <div className="bd-plate-title">
                  {error ? "Aperçu indisponible" : "Chargement de la carte"}
                </div>
                <div className="bd-plate-line">{error ?? "La boucle de cet écran arrive."}</div>
              </div>
            </div>
          }
        />
      </div>

      <div role={error ? "alert" : "status"} className="min-h-5 text-[13px] leading-relaxed">
        {error ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-ctrl border border-alert/25 bg-alert/5 px-3 py-2.5">
            <div className="min-w-0 flex-1 text-alertt">
              <p className="font-semibold">Impossible d’actualiser l’aperçu</p>
              <p className="mt-0.5">{content ? "Le dernier aperçu reste affiché. " : ""}{error}</p>
            </div>
            <Btn variant="ghost" size="sm" onClick={onRetry} disabled={loading}>
              {loading ? "Nouvel essai…" : "Réessayer"}
            </Btn>
          </div>
        ) : loading || stale ? (
          <p className="text-mut">
            {content ? "Actualisation de l’aperçu…" : "Chargement de votre carte…"}
          </p>
        ) : (
          <p className="flex items-center gap-1.5 text-mut">
            <Icon name="check" size={13} /> Aperçu à jour
          </p>
        )}
      </div>

      <div className="flex items-center gap-2" role="group" aria-label="Lecture de l’aperçu">
        <Transport label="Scène précédente" icon="back" onClick={() => onGo(-1)} disabled={total < 2} />
        <Transport
          label={paused ? "Reprendre la boucle" : "Mettre en pause"}
          icon={paused ? "play" : "pause"}
          onClick={onTogglePause}
          disabled={!current}
        />
        <Transport label="Scène suivante" icon="arrow" onClick={() => onGo(1)} disabled={total < 2} />
        <div className="min-w-0 flex-1 pl-1 text-[13px] text-mut">
          {current ? (
            <>
              <span className="block truncate font-semibold text-ink">{current.title}</span>
              <span className="cf-fig block">
                {index + 1} / {total} · {paused ? "En pause" : "Lecture"}
              </span>
            </>
          ) : loading ? (
            "Chargement…"
          ) : (
            "Aucune scène"
          )}
        </div>
      </div>
      {previewService ? (
        <p className="rounded-ctrl bg-surface2 px-3 py-2.5 text-[13px] leading-relaxed text-mut">
          Simulation du service {previewService === "lunch" ? "du midi" : "du soir"}.
          {" "}Les horaires de votre écran restent inchangés.
        </p>
      ) : content && !content.open ? (
        <p className="rounded-ctrl bg-surface2 px-3 py-2.5 text-[13px] leading-relaxed text-mut">
          Votre établissement est fermé à cette heure. Choisissez Midi ou Soir pour préparer votre menu.
        </p>
      ) : null}
    </div>
  );
}
