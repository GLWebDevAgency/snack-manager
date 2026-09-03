"use client";

import type {
  InputHTMLAttributes,
  LabelHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { cx } from "@/lib/cx";

/**
 * Style commun des contrôles de saisie (spec backoffice §4.5) : niveau
 * « élément » posé sur la carte, bord qui s'affirme au survol, accent au
 * focus (le seul emploi d'accent ici — élément actif, DA §3).
 *
 * ── LE BORD D'UN CHAMP EST LA LIMITE D'UN CONTRÔLE, PAS UNE DÉCORATION ──
 *
 * Il était posé à 8 % d'encre : 1,14 à 1,26:1 sur les six directions, et
 * 1,17 sur la marque grise — WCAG 1.4.11 en exige 3. On ne voyait pas où
 * commençait le champ ; seul le fond légèrement creusé le suggérait.
 * `border-linefirm` est ce même filet, ramené à 3:1 par le résolveur sur
 * chaque fond où un champ se pose. Le survol monte d'un cran sur `mut`,
 * l'encre atténuée (≥ 4,5:1) — une opacité de plus aurait ré-inventé le
 * défaut qu'on vient de fermer.
 */
const CONTROL =
  "rounded-ctrl border border-linefirm bg-ink/5 px-3.5 py-3 text-sm font-medium text-ink outline-none transition-colors duration-fast ease-sm placeholder:text-mut hover:border-mut focus:border-focus focus:bg-ink/8 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-linefirm";

/**
 * Largeur par défaut `w-full`, SAUF si l'appelant pose déjà une largeur.
 *
 * Tailwind tranche les conflits par l'ordre dans la feuille, pas par l'ordre
 * des classes : `w-full` l'emportait sur `w-[280px]`, ce qui écrasait toutes
 * les largeurs demandées (barres d'outils Ingrédients / Mouvements /
 * Fournisseurs étalées sur trois lignes). On ne l'ajoute donc que si besoin.
 * `min-w-0` n'est pas une largeur — d'où l'ancre de début de mot.
 */
const widthClass = (className?: string) =>
  /(^|\s)!?w-/.test(className ?? "") ? undefined : "w-full";

export function Label({
  className,
  ...rest
}: LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cx(
        "block text-xs font-bold uppercase tracking-[0.04em] text-mut",
        className,
      )}
      {...rest}
    />
  );
}

/** Colonne label + contrôle (gap 6px). */
export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
  className,
}: {
  label: string;
  htmlFor?: string;
  /** Aide courte affichée sous le contrôle. */
  hint?: ReactNode;
  /** Message d'erreur (rouge fonctionnel). */
  error?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("flex flex-col gap-1.5", className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error ? (
        <p className="text-xs text-alertt" role="alert">
          {error}
        </p>
      ) : (
        hint && <p className="text-xs text-mut">{hint}</p>
      )}
    </div>
  );
}

export function Input({
  className,
  ...rest
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cx(CONTROL, widthClass(className), className)}
      {...rest}
    />
  );
}

export function Textarea({
  className,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cx(CONTROL, "min-h-20", widthClass(className), className)}
      {...rest}
    />
  );
}

export function Select({
  className,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement>) {
  // .cf-select : chevron gris intégré (globals.css)
  return (
    <select
      className={cx(CONTROL, "cf-select", widthClass(className), className)}
      {...rest}
    />
  );
}
