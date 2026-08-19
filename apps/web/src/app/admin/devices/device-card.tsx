"use client";

/**
 * Carte d'un appareil de terrain.
 *
 * Elle répond à une seule question, depuis le bureau : cette caisse encaisse-
 * t-elle en ce moment ? D'où le filet de tête coloré, la pastille et la phrase
 * d'état AVANT toute donnée de configuration — et, tant que l'appareil n'est
 * pas appairé, le code à six caractères posé au milieu de la carte plutôt que
 * caché derrière un bouton.
 */

import { cx } from "@/lib/cx";
import { Btn, Card, Icon, Pill } from "@/components/ui";
import { CodeCountdown, CopyBtn, LastSeenLine, PairingCode, StatusLine } from "./parts";
import { deviceTone, KIND_ICON, KIND_ROLE, TONE_BAR, type DeviceView } from "./types";

export function DeviceCard({
  device,
  now,
  onInstall,
  onRename,
  onRegenerate,
  onDelete,
}: {
  device: DeviceView;
  now: number | null;
  onInstall: () => void;
  onRename: () => void;
  onRegenerate: () => void;
  onDelete: () => void;
}) {
  const tone = deviceTone(device, now);
  const pairing = device.pairing;
  const expired = pairing?.expired ?? false;

  return (
    <Card className="flex flex-col">
      <div className={cx("h-[3px] shrink-0", TONE_BAR[tone])} aria-hidden />

      <div className="flex flex-1 flex-col p-[18px]">
        {/* ── Identité + état ── */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <div
              className="grid size-9 shrink-0 place-items-center rounded-card border border-white/6 bg-[image:var(--cf-elev-gradient)] text-mut"
              aria-hidden
            >
              <Icon name={KIND_ICON[device.kind]} size={18} />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="truncate text-lg font-semibold tracking-[-0.03em] text-ink">
                {device.name}
              </h3>
              <div className="mt-1.5">
                <StatusLine device={device} now={now} />
                <LastSeenLine device={device} />
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onDelete}
            aria-label={`Supprimer l'appareil « ${device.name} »`}
            title="Supprimer cet appareil"
            className="cf-press -mr-1 -mt-1 grid size-8 shrink-0 place-items-center rounded-ctrl text-mut hover:text-alertt"
          >
            <Icon name="trash" size={15} />
          </button>
        </div>

        {/* ── Code d'appairage — seulement tant qu'il sert ── */}
        {!device.paired && pairing && (
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

        {/* ── Nature de l'appareil ── */}
        <div className="mt-3.5 flex flex-wrap items-center gap-2 border-t border-line2 pt-3.5">
          <Pill variant="out">{device.kindLabel}</Pill>
          {/* Pas de `truncate` : « ÉCRAN CUISINE » est une pilule large, et sur
              une carte de grille la phrase se faisait couper en plein mot.
              Mieux vaut une seconde ligne qu'un rôle illisible. */}
          <span className="min-w-0 flex-1 text-[13px] leading-snug text-mut">
            {KIND_ROLE[device.kind]}
          </span>
        </div>

        {/* ── Actions — collées en bas : dans une grille, les cartes d'une même
             rangée s'étirent, et des boutons alignés se cliquent sans viser. ── */}
        <div className="mt-auto flex flex-wrap items-center gap-2 pt-3.5">
          {device.paired ? (
            <>
              <Btn variant="ink" size="sm" icon="edit" onClick={onRename}>
                Renommer
              </Btn>
              <Btn variant="ghost" size="sm" onClick={onRegenerate}>
                Réappairer
              </Btn>
            </>
          ) : (
            <>
              <Btn variant="ink" size="sm" iconRight="arrow" onClick={onInstall}>
                Marche à suivre
              </Btn>
              <Btn variant="ghost" size="sm" icon="edit" onClick={onRename}>
                Renommer
              </Btn>
            </>
          )}
        </div>
      </div>
    </Card>
  );
}
