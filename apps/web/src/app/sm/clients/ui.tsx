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
  SEVERITY_BORDER,
  SIGNAL_SEVERITY_LABELS,
  fmtTrend,
  scoreHealth,
  type SignalSeverity,
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
  pending = false,
  verdict,
}: {
  score: number | null;
  health: CrmClientHealth;
  className?: string;
  /**
   * La fiche de santé est en route. On montre la pastille de santé DÉDUITE
   * (elle est déjà juste au balayage) avec le chiffre en attente, plutôt qu'un
   * tiret qui se transformerait en 88 sous les yeux de l'équipe.
   */
  pending?: boolean;
  /** « Client solide », « Client fragile — à rappeler »… tel que l'API le rédige. */
  verdict?: string;
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
        score !== null
          ? `Score de santé ${score} sur 100${verdict ? ` — ${verdict}` : ""}`
          : pending
            ? "Score en cours de lecture…"
            : "Score non chargé — santé déduite de la dernière commande encaissée"
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
        {score !== null ? (
          <>
            {score}
            <span className="sr-only"> sur 100</span>
          </>
        ) : pending ? (
          <span className="inline-block h-[9px] w-[18px] animate-pulse rounded-xs bg-current opacity-30" />
        ) : (
          "—"
        )}
      </span>
    </span>
  );
}

// ─── Gravité d'un signal ───

const SEVERITY_DOT: Record<SignalSeverity, string> = {
  critique: "bg-alert animate-pulse",
  attention: "bg-prep",
  info: "bg-white/40",
};

/**
 * Bande de gravité de la file de travail.
 *
 * Même pastille en tête d'un groupe de signaux, sur une ligne de client et
 * dans les gestes du jour : trois écrans qui parlent de la même chose doivent
 * la dessiner pareil, sinon « critique » finit par vouloir dire deux choses.
 */
export function SeverityPill({
  severity,
  label,
  className,
}: {
  severity: SignalSeverity;
  /** Remplace le libellé de gravité (« 3 à rappeler », « Impayé »…). */
  label?: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-pill border-[1.5px] px-[9px] py-[3px] text-[10px] font-extrabold uppercase tracking-[0.06em]",
        SEVERITY_BORDER[severity],
        className,
      )}
    >
      <span
        className={cx("size-[7px] shrink-0 rounded-full", SEVERITY_DOT[severity])}
        aria-hidden
      />
      {label ?? SIGNAL_SEVERITY_LABELS[severity]}
    </span>
  );
}

/**
 * LE MARQUEUR « À RAPPELER » — le seul aplat rouge plein de la liste.
 *
 * Il ne se lit pas, il se voit : c'est la seule chose de la ligne qui reste
 * repérable à un mètre de l'écran, en balayant la colonne des noms. Réservé
 * aux clients qui portent un signal critique ou un accès coupé — s'il
 * s'allumait pour une baisse de 12 %, personne ne le regarderait plus.
 */
export function CallBackFlag({
  reason,
  className,
}: {
  /** Ce qui l'a déclenché, dit en trois mots — sert d'infobulle. */
  reason?: string;
  className?: string;
}) {
  return (
    <span
      className={cx(
        "inline-flex shrink-0 items-center gap-1 rounded-pill bg-alert px-2 py-px text-[10px] font-extrabold uppercase tracking-[0.06em] text-white",
        className,
      )}
      title={reason}
    >
      <Icon name="phone" size={11} />
      À rappeler
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

/*
 * `ActivityBars` (barres jour par jour) a été SUPPRIMÉ avec la publication du
 * contrat `/health` : la route ne rend AUCUNE série journalière
 * (`CrmTenantActivity` porte deux fenêtres comparées, rien de plus), et un
 * graphique qui attend une donnée jamais envoyée est un bloc vide déguisé en
 * graphique — c'est ce que l'audit a constaté. S'il revient, ce sera par le
 * contrat, pas par une devinette d'écran.
 */

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
