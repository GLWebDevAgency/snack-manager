"use client";

/**
 * Carte d'un écran de salle.
 *
 * Elle répond à une seule question, à trois mètres du bureau : cet écran
 * affiche-t-il la carte en ce moment ? D'où le filet de tête coloré, la
 * pastille et la phrase d'état AVANT toute donnée de configuration — et, tant
 * que l'écran n'est pas appairé, le code à six caractères posé au milieu de la
 * carte plutôt que caché derrière un bouton.
 */

import { cx } from "@/lib/cx";
import { Btn, Card, Icon, Pill } from "@/components/ui";
import { CodeCountdown, CopyBtn, LastSeenLine, PairingCode, StatusLine } from "./parts";
import { fmtLoop, loopMs, screenTone, TONE_BAR, type ScreenView } from "./types";

export function ScreenCard({
  screen,
  now,
  onInstall,
  onCompose,
  onRegenerate,
  onDelete,
}: {
  screen: ScreenView;
  now: number | null;
  onInstall: () => void;
  onCompose: () => void;
  onRegenerate: () => void;
  onDelete: () => void;
}) {
  const tone = screenTone(screen, now ?? Date.now());
  const pairing = screen.pairing;
  const expired = pairing?.expired ?? false;

  return (
    <Card className="flex flex-col">
      <div className={cx("h-[3px] shrink-0", TONE_BAR[tone])} aria-hidden />

      <div className="flex flex-1 flex-col p-[18px]">
        {/* ── Identité + état ── */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-lg font-semibold tracking-[-0.03em] text-ink">
              {screen.name}
            </h3>
            <div className="mt-1.5">
              <StatusLine screen={screen} now={now} />
              <LastSeenLine screen={screen} />
            </div>
          </div>
          <button
            type="button"
            onClick={onDelete}
            aria-label={`Supprimer l'écran « ${screen.name} »`}
            title="Supprimer cet écran"
            className="cf-press -mr-1 -mt-1 grid size-8 shrink-0 place-items-center rounded-ctrl text-mut hover:text-alertt"
          >
            <Icon name="trash" size={15} />
          </button>
        </div>

        {/* ── Code d'appairage — seulement tant qu'il sert ── */}
        {!screen.paired && pairing && (
          <div
            // Puits sombre : les tuiles du code valent #1a1a1a et doivent se
            // détacher de leur support (DA §1).
            className={cx(
              "mt-3.5 rounded-card border px-3.5 py-3",
              expired ? "border-alert/35 bg-alert/10" : "border-white/10 bg-black/30",
            )}
          >
            <PairingCode code={pairing.code} size="sm" dimmed={expired} />
            <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
              <CodeCountdown expiresAt={pairing.expiresAt} expired={expired} />
              {expired ? (
                <Btn variant="ghost" size="sm" icon="plus" onClick={onRegenerate}>
                  Générer un nouveau code
                </Btn>
              ) : (
                <CopyBtn value={pairing.code} what="Le code" />
              )}
            </div>
          </div>
        )}

        {/* ── Configuration ── */}
        <div className="mt-3.5 flex flex-wrap items-center gap-2 border-t border-line2 pt-3.5">
          <Pill variant="out">{screen.orientationLabel}</Pill>
          <Pill variant="out">{screen.themeLabel}</Pill>
          <span className="cf-fig text-[13px] text-mut">
            {screen.sceneCount} scène{screen.sceneCount > 1 ? "s" : ""}
            {screen.sceneCount > 0 && ` · boucle de ${fmtLoop(loopMs(screen.playlist))}`}
          </span>
        </div>

        {/* ── Actions ── */}
        <div className="mt-3.5 flex flex-wrap items-center gap-2">
          {screen.paired ? (
            <>
              <Btn variant="ink" size="sm" icon="grid" onClick={onCompose}>
                Composer la boucle
              </Btn>
              <Btn variant="ghost" size="sm" onClick={onRegenerate}>
                Remplacer la clé
              </Btn>
            </>
          ) : (
            <>
              <Btn variant="ink" size="sm" iconRight="arrow" onClick={onInstall}>
                Marche à suivre
              </Btn>
              <Btn variant="ghost" size="sm" icon="grid" onClick={onCompose}>
                Composer la boucle
              </Btn>
            </>
          )}
        </div>
      </div>
    </Card>
  );
}
