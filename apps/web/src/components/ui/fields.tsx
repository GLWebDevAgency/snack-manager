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
 * « élément » posé sur la carte, bord qui s'éclaircit au survol, accent au
 * focus (le seul emploi d'accent ici — élément actif, DA §3).
 */
const CONTROL =
  "rounded-ctrl border border-white/8 bg-white/5 px-3.5 py-3 text-sm font-medium text-white outline-none transition-colors duration-200 ease-sm placeholder:text-mut/70 hover:border-white/16 focus:border-accent focus:bg-white/8 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-white/8";

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
