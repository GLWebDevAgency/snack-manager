"use client";

import type {
  InputHTMLAttributes,
  LabelHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { cx } from "@/lib/cx";

/** Style commun des contrôles de saisie (spec backoffice §4.5). */
const CONTROL =
  "w-full rounded-ctrl border border-white/6 bg-white/5 px-3.5 py-3 text-sm text-white outline-none transition-colors duration-200 ease-sm placeholder:text-mut/75 focus:border-accent disabled:cursor-not-allowed disabled:opacity-40";

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
  return <input className={cx(CONTROL, className)} {...rest} />;
}

export function Textarea({
  className,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cx(CONTROL, "min-h-20", className)} {...rest} />;
}

export function Select({
  className,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement>) {
  // .cf-select : chevron gris intégré (globals.css)
  return <select className={cx(CONTROL, "cf-select", className)} {...rest} />;
}
