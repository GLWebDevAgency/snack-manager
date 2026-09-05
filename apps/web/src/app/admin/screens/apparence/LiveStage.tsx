"use client";

import { useRef } from "react";
import type { ScreenContent, ScreenScenePayload } from "@sm/contracts";
import { cx } from "@/lib/cx";
import { Icon } from "@/components/ui";
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
        "cf-press grid size-8 shrink-0 place-items-center rounded-ctrl border border-line2 text-mut",
        "hover:border-white/25 hover:text-ink disabled:cursor-not-allowed disabled:opacity-30",
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
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const orientation = content?.orientation ?? "landscape";
  const stage = useEmbeddedStage(ref, orientation);
  const total = content?.scenes.length ?? 0;

  return (
    <div className="flex flex-col gap-2.5">
      <div
        ref={ref}
        data-testid="apercu-ecran"
        className="relative mx-auto overflow-hidden rounded-card border border-white/10 bg-black shadow-[0_18px_48px_rgba(0,0,0,0.45)]"
        style={
          orientation === "landscape"
            ? { width: "100%", aspectRatio: "16 / 9" }
            : { height: 460, aspectRatio: "9 / 16" }
        }
      >
        <BoardStage
          content={content}
          current={current}
          leaving={leaving}
          stage={stage}
          embed
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

      <div className="flex items-center gap-2">
        <Transport label="Scène précédente" icon="back" onClick={() => onGo(-1)} disabled={total < 2} />
        <Transport
          label={paused ? "Reprendre la boucle" : "Mettre en pause"}
          icon={paused ? "play" : "pause"}
          onClick={onTogglePause}
          disabled={total < 2}
        />
        <Transport label="Scène suivante" icon="arrow" onClick={() => onGo(1)} disabled={total < 2} />
        <div className="min-w-0 flex-1 truncate text-[13px] text-mut">
          {current ? (
            <>
              <span className="font-semibold text-ink">{current.title}</span>
              {current.subtitle ? ` · ${current.subtitle}` : ""}
              <span className="cf-fig">
                {" "}
                · {index + 1} / {total}
              </span>
              {loading ? " · actualisation…" : ""}
            </>
          ) : loading ? (
            "Chargement…"
          ) : (
            "Aucune scène"
          )}
        </div>
      </div>
    </div>
  );
}
