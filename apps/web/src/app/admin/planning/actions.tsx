"use client";

/**
 * Les trois gestes qui entourent la grille : dupliquer, publier, transmettre.
 *
 * ─── CE QUI SORT VERS L'ÉQUIPE NE CONTIENT AUCUN MONTANT ───
 *
 * Le planning transmis est lu par les salariés. Les coûts horaires et la masse
 * salariale sont des données de gestion — l'API les réserve déjà au compte
 * propriétaire, et le partage doit tenir la même ligne. Les deux fabricants de
 * sortie (texte et image) travaillent donc à partir des seuls services PUBLIÉS
 * et n'ont jamais accès à un `costCents` : ce n'est pas un oubli, c'est la
 * règle, et elle est écrite à l'écran pour que le gérant le sache.
 *
 * Pas de module de notifications : un patron de snack envoie son planning par
 * messagerie. On lui donne donc exactement ça — un texte prêt à coller et une
 * image prête à envoyer.
 */

import { useMemo, useRef, useState } from "react";
import type { PlanningService, PlanningWeek } from "@sm/contracts";
import { PLANNING_SERVICE_LABELS } from "@sm/contracts";
import { api, ApiError } from "@/lib/api";
import { Btn, Icon, Modal, useToast } from "@/components/ui";
import { fmtRange, longDayLabel, weekTitle } from "./data";

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// ─── Ce que l'équipe reçoit ───

type PublicLine = { service: PlanningService; entries: { name: string; time: string; note: string }[] };
type PublicDay = { date: string; label: string; lines: PublicLine[] };

/**
 * Vue publique de la semaine : uniquement les services PUBLIÉS, sans montant.
 * Un jour sans rien de publié reste dans la liste — « personne le lundi » est
 * une information pour l'équipe, pas un trou à escamoter.
 */
function buildPublicWeek(week: PlanningWeek): PublicDay[] {
  return week.days.map((day) => ({
    date: day.date,
    label: capitalize(longDayLabel(day.date)),
    lines: day.services
      .map((block) => ({
        service: block.service,
        entries: block.shifts
          .filter((s) => s.status === "publie")
          .sort((a, b) => a.start.localeCompare(b.start) || a.staffName.localeCompare(b.staffName))
          .map((s) => ({ name: s.staffName, time: fmtRange(s.start, s.end), note: s.note })),
      }))
      .filter((l) => l.entries.length > 0),
  }));
}

/** Texte prêt à coller dans une messagerie. */
function buildShareText(week: PlanningWeek, tenantName: string): string {
  const days = buildPublicWeek(week);
  const out: string[] = [
    `${tenantName} — ${weekTitle(week.week, week.weekEnd)}`,
    "",
  ];
  for (const day of days) {
    out.push(day.label.toUpperCase());
    if (day.lines.length === 0) {
      out.push("  Aucun service prévu");
    } else {
      for (const line of day.lines) {
        const people = line.entries
          .map((e) => `${e.name} ${e.time}${e.note ? ` (${e.note})` : ""}`)
          .join(" · ");
        out.push(`  ${PLANNING_SERVICE_LABELS[line.service]} : ${people}`);
      }
    }
    out.push("");
  }
  out.push("Planning établi avec Snack Manager");
  return out.join("\n");
}

// ─── L'image ───

const IMG = {
  width: 820,
  pad: 36,
  dayGap: 14,
  lineH: 30,
  headH: 40,
};

/**
 * Rend le planning publié en PNG, sur le noir stratifié de la charte.
 *
 * Une image se transfère, se garde dans la galerie et s'affiche sans réseau —
 * là où un lien mourrait avec la session. C'est la forme qui survit le mieux
 * dans une conversation de groupe.
 */
function drawPlanningImage(
  week: PlanningWeek,
  tenantName: string,
  accent: string,
): HTMLCanvasElement {
  const days = buildPublicWeek(week);

  // Passe de mesure : la hauteur dépend du nombre de lignes réellement publiées.
  let body = 0;
  for (const day of days) {
    const lines = Math.max(1, day.lines.length);
    body += IMG.headH + lines * IMG.lineH + IMG.dayGap;
  }
  const headerH = 132;
  const footerH = 64;
  const height = headerH + body + footerH;

  const dpr = Math.min(2, typeof window === "undefined" ? 1 : window.devicePixelRatio || 1);
  const canvas = document.createElement("canvas");
  canvas.width = IMG.width * dpr;
  canvas.height = height * dpr;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  ctx.scale(dpr, dpr);

  const font = (weight: number, size: number) =>
    `${weight} ${size}px Inter, system-ui, -apple-system, sans-serif`;

  // Fond noir + carte #111, comme une carte du back-office.
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, IMG.width, height);
  roundRect(ctx, 16, 16, IMG.width - 32, height - 32, 20);
  ctx.fillStyle = "#111";
  ctx.fill();

  // En-tête
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = accent;
  ctx.font = font(700, 13);
  ctx.fillText(tenantName.toUpperCase(), IMG.pad, 62);
  ctx.fillStyle = "#fff";
  ctx.font = font(800, 30);
  ctx.fillText(capitalize(weekTitle(week.week, week.weekEnd)), IMG.pad, 100);
  ctx.fillStyle = "#999";
  ctx.font = font(500, 14);
  ctx.fillText("Planning de l'équipe", IMG.pad, 122);

  let y = headerH;
  for (const day of days) {
    const lines = Math.max(1, day.lines.length);
    const blockH = IMG.headH + lines * IMG.lineH;

    // Bandeau du jour — niveau « élément » #1a1a1a.
    roundRect(ctx, IMG.pad - 10, y, IMG.width - 2 * (IMG.pad - 10), blockH, 12);
    ctx.fillStyle = "#1a1a1a";
    ctx.fill();

    ctx.fillStyle = "#fff";
    ctx.font = font(800, 16);
    ctx.fillText(day.label, IMG.pad, y + 26);

    let ly = y + IMG.headH + 12;
    if (day.lines.length === 0) {
      ctx.fillStyle = "#999";
      ctx.font = font(500, 14);
      ctx.fillText("Aucun service prévu", IMG.pad, ly);
    } else {
      for (const line of day.lines) {
        ctx.fillStyle = accent;
        ctx.font = font(700, 12);
        const tag = PLANNING_SERVICE_LABELS[line.service].toUpperCase();
        ctx.fillText(tag, IMG.pad, ly);
        const tagW = Math.max(46, ctx.measureText(tag).width + 14);

        ctx.fillStyle = "#fff";
        ctx.font = font(600, 14);
        const text = line.entries
          .map((e) => `${e.name} ${e.time}${e.note ? ` (${e.note})` : ""}`)
          .join("   ·   ");
        fitText(ctx, text, IMG.pad + tagW, ly, IMG.width - IMG.pad * 2 - tagW);
        ly += IMG.lineH;
      }
    }
    y += blockH + IMG.dayGap;
  }

  ctx.fillStyle = "#666";
  ctx.font = font(500, 12);
  ctx.fillText("Planning établi avec Snack Manager", IMG.pad, height - 34);

  return canvas;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Tronque proprement plutôt que de laisser un nom déborder de la carte. */
function fitText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
) {
  if (ctx.measureText(text).width <= maxWidth) {
    ctx.fillText(text, x, y);
    return;
  }
  let cut = text;
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > maxWidth) cut = cut.slice(0, -1);
  ctx.fillText(`${cut}…`, x, y);
}

// ─── Modale publier / transmettre ───

type PublishShareProps = {
  week: PlanningWeek;
  tenantName: string;
  accent: string;
  /** « publish » demande d'abord confirmation ; « share » ouvre direct le partage. */
  initialStep: "publish" | "share";
  onClose: () => void;
  onPublished: () => Promise<void>;
};

export function PublishShareModal({
  week,
  tenantName,
  accent,
  initialStep,
  onClose,
  onPublished,
}: PublishShareProps) {
  const toast = useToast();
  const [step, setStep] = useState(initialStep);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const textRef = useRef<HTMLTextAreaElement>(null);

  const text = useMemo(() => buildShareText(week, tenantName), [week, tenantName]);
  const publishedCount = week.counts.publie;

  async function publish() {
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ published: number; message: string }>(
        "/planning/week/publish",
        { week: week.week },
      );
      toast(res.message, { icon: "check" });
      await onPublished();
      setStep("share");
    } catch (e) {
      setError(
        e instanceof ApiError || e instanceof Error
          ? e.message
          : "Publication impossible — réessayez",
      );
    } finally {
      setBusy(false);
    }
  }

  async function copyText() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast("Planning copié — collez-le dans votre messagerie", { icon: "check" });
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      // Presse-papiers refusé (contexte non sécurisé, permission) : on
      // sélectionne le texte pour que la copie manuelle reste à un geste.
      textRef.current?.focus();
      textRef.current?.select();
      toast("Copie automatique refusée — le texte est sélectionné");
    }
  }

  function downloadImage() {
    const canvas = drawPlanningImage(week, tenantName, accent);
    canvas.toBlob((blob) => {
      if (!blob) {
        toast("Image indisponible — utilisez le texte");
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `planning-${week.week}.png`;
      a.click();
      URL.revokeObjectURL(url);
      toast("Image enregistrée", { icon: "check" });
    }, "image/png");
  }

  if (step === "publish") {
    const drafts = week.counts.brouillon;
    return (
      <Modal
        open
        onClose={onClose}
        width={520}
        title="Publier la semaine"
        footer={
          <>
            <Btn variant="ghost" size="sm" onClick={onClose} disabled={busy}>
              Annuler
            </Btn>
            <Btn size="sm" onClick={() => void publish()} disabled={busy || drafts === 0}>
              {busy ? "Publication…" : `Publier ${drafts} service${drafts > 1 ? "s" : ""}`}
            </Btn>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <p className="text-[13.5px] leading-snug text-ink">
            {drafts === 0 ? (
              <>
                Tout est déjà publié sur cette semaine —{" "}
                <strong className="cf-fig font-extrabold">{publishedCount}</strong> service
                {publishedCount > 1 ? "s" : ""} visible{publishedCount > 1 ? "s" : ""} par
                l&apos;équipe.
              </>
            ) : (
              <>
                <strong className="cf-fig font-extrabold">{drafts}</strong> service
                {drafts > 1 ? "s" : ""} en brouillon {drafts > 1 ? "passeront" : "passera"} en
                publié. C&apos;est le seul geste qui rend le planning visible par votre équipe.
              </>
            )}
          </p>
          <p className="rounded-ctrl border border-white/8 bg-[image:var(--cf-elev-gradient)] p-3 text-[12.5px] text-mut">
            Après publication, vous pourrez transmettre le planning à votre équipe : un texte
            à coller dans votre messagerie, ou une image à envoyer.
          </p>
          {drafts === 0 && (
            <Btn variant="ghost" size="sm" icon="phone" onClick={() => setStep("share")}>
              Transmettre le planning publié
            </Btn>
          )}
          {error && (
            <p className="text-[13px] font-semibold text-alertt" role="alert">
              {error}
            </p>
          )}
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      width={560}
      title="Transmettre à l'équipe"
      footer={
        <Btn variant="ghost" size="sm" onClick={onClose}>
          Fermer
        </Btn>
      }
    >
      <div className="flex flex-col gap-3">
        {publishedCount === 0 ? (
          <p className="text-[13.5px] text-mut">
            Aucun service publié sur cette semaine — publiez d&apos;abord le brouillon.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              <Btn size="sm" icon={copied ? "check" : "phone"} onClick={() => void copyText()}>
                {copied ? "Copié" : "Copier pour la messagerie"}
              </Btn>
              <Btn variant="ghost" size="sm" icon="print" onClick={downloadImage}>
                Télécharger l&apos;image
              </Btn>
            </div>

            <label className="sr-only" htmlFor="share-text">
              Planning au format texte
            </label>
            <textarea
              id="share-text"
              ref={textRef}
              readOnly
              value={text}
              rows={12}
              className="cf-scroll w-full resize-none rounded-ctrl border border-white/8 bg-white/5 p-3 font-mono text-[12px] leading-relaxed text-ink outline-none focus:border-accent"
            />

            <p className="flex items-start gap-2 text-[12.5px] text-mut">
              <Icon name="euro" size={14} className="mt-0.5 shrink-0" aria-hidden />
              <span>
                Ni coût horaire ni masse salariale ne figurent dans ce qui est transmis : le
                planning envoyé ne porte que les noms, les horaires et vos notes.
              </span>
            </p>
            {week.counts.brouillon > 0 && (
              <p className="text-[12.5px] text-prept">
                {week.counts.brouillon} service{week.counts.brouillon > 1 ? "s" : ""} encore en
                brouillon {week.counts.brouillon > 1 ? "ne sont" : "n'est"} pas dans cet envoi.
              </p>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

// ─── Modale duplication ───

type DuplicateProps = {
  fromIso: string;
  fromEndIso: string;
  toIso: string;
  toEndIso: string;
  /** Nombre de services déjà posés sur la semaine cible. */
  existing: number;
  onClose: () => void;
  onDone: () => Promise<void>;
};

/**
 * Dupliquer la semaine précédente : le geste du dimanche soir.
 *
 * La copie arrive TOUJOURS en brouillon — c'est l'API qui le garantit — et le
 * remplacement d'une semaine déjà remplie ne part jamais tout seul : l'API
 * répond 409 tant qu'on ne l'a pas demandé explicitement, et cet écran ne
 * force la main qu'après un second geste du gérant.
 */
export function DuplicateModal({
  fromIso,
  fromEndIso,
  toIso,
  toEndIso,
  existing,
  onClose,
  onDone,
}: DuplicateProps) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [needsReplace, setNeedsReplace] = useState(existing > 0);
  const [error, setError] = useState<string | null>(null);

  async function run(replace: boolean) {
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ copied: number; message: string }>(
        "/planning/week/duplicate",
        { from: fromIso, to: toIso, replace },
      );
      toast(res.message, { icon: "check" });
      onClose();
      await onDone();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setNeedsReplace(true);
        setError(e.message);
      } else {
        setError(e instanceof Error ? e.message : "Duplication impossible — réessayez");
      }
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      width={520}
      title="Dupliquer une semaine"
      destructive={needsReplace}
      footer={
        <>
          <Btn variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            Annuler
          </Btn>
          <Btn
            size="sm"
            className={needsReplace ? "text-alertt" : undefined}
            variant={needsReplace ? "ink" : "primary"}
            onClick={() => void run(needsReplace)}
            disabled={busy}
          >
            {busy
              ? "Copie…"
              : needsReplace
                ? "Remplacer et copier"
                : "Copier en brouillon"}
          </Btn>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-[13.5px] leading-snug text-ink">
          Copier les services de la{" "}
          <strong className="font-bold">{weekTitle(fromIso, fromEndIso).toLowerCase()}</strong>{" "}
          vers la{" "}
          <strong className="font-bold">{weekTitle(toIso, toEndIso).toLowerCase()}</strong>.
        </p>
        <p className="rounded-ctrl border border-white/8 bg-[image:var(--cf-elev-gradient)] p-3 text-[12.5px] text-mut">
          La copie arrive en <strong className="text-ink">brouillon</strong> : relisez, ajustez,
          puis publiez. Votre équipe ne voit rien avant.
        </p>
        {needsReplace && (
          <p className="text-[13px] font-semibold text-alertt" role="alert">
            {error ??
              `Cette semaine contient déjà ${existing} service${existing > 1 ? "s" : ""} — ils seront écrasés.`}
          </p>
        )}
        {error && !needsReplace && (
          <p className="text-[13px] font-semibold text-alertt" role="alert">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
