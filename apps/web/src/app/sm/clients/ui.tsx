"use client";

/**
 * Pièces d'affichage du poste de pilotage client — liste, fiche et file de
 * signaux les partagent.
 *
 * Rien ici n'est décoratif : chaque composant sert à repérer une information
 * SANS LA LIRE (DA §7) — un score coloré, une tendance fléchée, une barre de
 * comparaison. Les couleurs fonctionnelles gardent leur sens (vert = va bien,
 * ambre = à surveiller, rouge = à appeler) et l'accent laiton reste réservé
 * aux actions primaires et aux totaux (DA §3).
 */

import type { ReactNode } from "react";
import {
  PLAN_LABELS,
  TENANT_ACCOUNT_STATUS_LABELS,
  type CrmClientHealth,
  type TenantAccountStatus,
} from "@sm/contracts";
import { cx } from "@/lib/cx";
import { Icon, type IconName } from "@/components/ui";
import {
  HEALTH_BAR,
  HEALTH_TEXT,
  fmtTrend,
  scoreHealth,
  type ActivityPoint,
} from "./data";

// ─── Santé ───

const SCORE_BORDER: Record<CrmClientHealth, string> = {
  ok: "border-ok/55",
  attention: "border-prep/55",
  risque: "border-alert/70",
};

/**
 * Score de santé en pastille colorée.
 *
 * Le chiffre ET la couleur : la couleur se balaie, le chiffre se dit au
 * téléphone (« vous êtes à 42 sur 100 »). Sans score renvoyé par l'API, on
 * retombe sur le libellé de santé — jamais sur un chiffre inventé.
 */
export function ScorePill({
  score,
  health,
  className,
}: {
  score: number | null;
  health: CrmClientHealth;
  className?: string;
}) {
  const tone = scoreHealth(score) ?? health;
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-pill border-[1.5px] bg-transparent px-[9px] py-[3px] text-[11px] font-extrabold uppercase tracking-[0.04em]",
        SCORE_BORDER[tone],
        HEALTH_TEXT[tone],
        className,
      )}
      title={
        score === null
          ? "Score indisponible — santé déduite de la dernière commande"
          : `Score de santé ${score} sur 100`
      }
    >
      <span
        className={cx(
          "size-[7px] shrink-0 rounded-full",
          HEALTH_BAR[tone],
          // Un client qui décroche clignote : on le repère en balayant.
          tone === "risque" && "animate-pulse",
        )}
        aria-hidden
      />
      <span className="cf-fig">
        {score === null ? "—" : score}
        <span className="sr-only"> sur 100</span>
      </span>
    </span>
  );
}

// ─── Statut de compte ───

const STATUS_STYLE: Record<TenantAccountStatus, string> = {
  // Un compte actif est l'état NORMAL : il se lit sans couleur, sinon la
  // couleur ne veut plus rien dire quand elle apparaît (DA §3).
  active: "border-white/20 bg-white/6 text-mut",
  trial: "border-prep/50 bg-prep/12 text-prept",
  suspended: "border-alert/70 bg-alert/12 text-alertt",
  churned: "border-white/12 bg-transparent text-mut/70",
};

export function AccountPill({
  status,
  className,
}: {
  status: TenantAccountStatus | null;
  className?: string;
}) {
  if (!status) {
    return (
      <span
        className={cx("text-[11px] text-mut/60", className)}
        title="Statut de compte non renvoyé par l'API"
      >
        —
      </span>
    );
  }
  return (
    <span
      className={cx(
        "inline-flex items-center whitespace-nowrap rounded-pill border-[1.5px] px-[9px] py-[3px] text-[10px] font-extrabold uppercase tracking-[0.06em]",
        STATUS_STYLE[status],
        className,
      )}
    >
      {TENANT_ACCOUNT_STATUS_LABELS[status]}
    </span>
  );
}

export function PlanPill({
  plan,
  className,
}: {
  plan: "essentiel" | "complet" | "boost";
  className?: string;
}) {
  return (
    <span
      className={cx(
        "inline-flex items-center whitespace-nowrap rounded-pill border-[1.5px] px-[9px] py-[3px] text-[10px] font-extrabold uppercase tracking-[0.06em]",
        plan === "essentiel"
          ? "border-white/20 bg-white/6 text-mut"
          : "border-accent/50 bg-accent/12 text-accent",
        className,
      )}
    >
      {PLAN_LABELS[plan]}
    </span>
  );
}

// ─── Tendance ───

/**
 * Variation d'une période à l'autre.
 *
 * Le seuil de 5 % n'est pas cosmétique : sur un fast-food, trois commandes de
 * plus une semaine ne veut rien dire, et colorer ce bruit en rouge apprend à
 * l'équipe à ignorer la couleur. En dessous, la valeur reste grise.
 */
export function Trend({
  pct,
  className,
  suffix,
}: {
  pct: number | null;
  className?: string;
  suffix?: string;
}) {
  if (pct === null) {
    return (
      <span className={cx("text-[11px] text-mut/60", className)}>
        pas d&apos;historique
      </span>
    );
  }
  const strong = Math.abs(pct) >= 5;
  return (
    <span
      className={cx(
        "cf-fig inline-flex items-center gap-1 text-[11px] font-bold",
        !strong ? "text-mut" : pct > 0 ? "text-okt" : "text-alertt",
        className,
      )}
    >
      {strong && <span aria-hidden>{pct > 0 ? "▲" : "▼"}</span>}
      <span className="sr-only">{pct > 0 ? "En hausse :" : "En baisse :"}</span>
      {fmtTrend(pct)}
      {suffix && <span className="font-semibold text-mut">{suffix}</span>}
    </span>
  );
}

// ─── Jauges ───

/**
 * Jauge horizontale d'un critère de score. Baseline zéro, remplissage
 * proportionnel, couleur fonctionnelle — pas de dégradé, pas d'ombre.
 */
export function Meter({
  value,
  tone,
  className,
}: {
  /** 0–100. */
  value: number;
  tone: CrmClientHealth;
  className?: string;
}) {
  return (
    <div
      className={cx("h-[6px] overflow-hidden rounded-pill bg-white/10", className)}
      aria-hidden
    >
      <div
        className={cx("h-full rounded-pill transition-[width] duration-300 ease-sm", HEALTH_BAR[tone])}
        style={{ width: `${Math.max(2, Math.min(100, value))}%` }}
      />
    </div>
  );
}

/**
 * Barres d'activité comparées à la période précédente.
 *
 * La période précédente est un FILET en retrait derrière la barre courante,
 * jamais une seconde barre côte à côte : ce qu'on lit, c'est « au-dessus ou
 * en dessous de la dernière fois », pas deux séries à comparer une à une.
 * Baseline zéro toujours (DA — graphiques sobres).
 */
export function ActivityBars({
  points,
  height = 96,
  label,
}: {
  points: ActivityPoint[];
  height?: number;
  label: string;
}) {
  if (points.length === 0) {
    return (
      <div
        className="grid place-items-center text-[13px] text-mut"
        style={{ height }}
      >
        Aucune donnée sur la période
      </div>
    );
  }

  const max = Math.max(
    1,
    ...points.map((p) => Math.max(p.value, p.previous ?? 0)),
  );
  // Au-delà d'une trentaine de barres, un libellé sur deux suffit à situer la
  // période sans transformer l'axe en pâté gris.
  const step = Math.ceil(points.length / 12);

  return (
    <div>
      <div
        role="img"
        aria-label={label}
        className="flex items-end gap-[3px] border-b border-line2"
        style={{ height }}
      >
        {points.map((p, i) => (
          <div key={`${p.label}-${i}`} className="relative flex-1" title={`${p.label} · ${p.value}`}>
            {p.previous !== null && p.previous > 0 && (
              <span
                className="absolute inset-x-0 border-t border-dashed border-white/30"
                style={{ bottom: `${(p.previous / max) * (height - 8)}px` }}
                aria-hidden
              />
            )}
            <div
              className="w-full rounded-t-[3px] bg-accent/85"
              style={{
                height: Math.max(p.value > 0 ? 3 : 0, (p.value / max) * (height - 8)),
              }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex gap-[3px]">
        {points.map((p, i) => (
          <div
            key={`l-${p.label}-${i}`}
            className="min-w-0 flex-1 truncate text-center text-[10px] text-mut"
          >
            {i % step === 0 ? p.label : ""}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── États dégradés ───

/**
 * Section dont la route n'a pas répondu.
 *
 * Au téléphone, « pas encore branché » et « rien à signaler » ne se confondent
 * pas : dire « votre stock est bon » alors que le service d'analyse est à
 * l'arrêt, c'est mentir à un client. D'où un état explicite, jamais un vide.
 */
export function Unavailable({
  title = "Donnée indisponible",
  hint,
  icon = "bell",
}: {
  title?: string;
  hint?: ReactNode;
  icon?: IconName;
}) {
  return (
    <div className="flex items-start gap-2.5 rounded-card border border-dashed border-white/12 bg-white/3 p-3">
      <Icon name={icon} size={16} className="mt-px shrink-0 text-mut" />
      <div className="min-w-0">
        <div className="text-[13px] font-bold text-mut">{title}</div>
        {hint && <div className="mt-0.5 text-xs text-mut/80">{hint}</div>}
      </div>
    </div>
  );
}

/**
 * Intitulé de section — repris du CRM existant plutôt que redéfini ici : deux
 * eyebrows dans la même coquille finiraient par diverger d'un pixel.
 */
export { Eyebrow } from "../parts";
