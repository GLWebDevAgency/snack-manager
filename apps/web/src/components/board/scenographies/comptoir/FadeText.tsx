"use client";

import { useEffect, useRef, useState, type ElementType } from "react";

/** « 240ms » → 240, « 0.32s » → 320. Vide ou illisible : la valeur de base du profil « posé ». */
export function dureeMs(brut: string): number {
  const v = brut.trim();
  const n = parseFloat(v);
  if (!Number.isFinite(n)) return 240;
  return /ms$/.test(v) ? n : n * 1000;
}

/**
 * Un texte qui SE FOND quand sa valeur change — jamais un saut.
 *
 * La mise à jour en place (même scène, prix ou nom corrigé) arrive au plus une
 * fois par minute, sous les yeux des clients : l'ancien texte s'efface en
 * `--sm-t-fast`, le nouveau prend sa place, et la ligne ne bouge pas. Le prix,
 * lui, ne passe PAS par ici — le contrat veut qu'il change sans animation.
 */
export function FadeText({
  value,
  as = "span",
  className,
}: {
  value: string;
  as?: ElementType;
  className?: string;
}) {
  const ref = useRef<HTMLElement | null>(null);
  const [shown, setShown] = useState(value);
  // Dérivé de la valeur demandée : A → B → A redevient visible immédiatement,
  // même si le remplacement B a été annulé avant l'expiration du fondu.
  const fading = value !== shown;

  useEffect(() => {
    if (value === shown) return;
    const duree = dureeMs(
      ref.current ? getComputedStyle(ref.current).getPropertyValue("--sm-t-fast") : "",
    );
    const timer = setTimeout(() => {
      setShown(value);
    }, window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : duree);
    return () => clearTimeout(timer);
  }, [value, shown]);

  const Tag = as;
  return (
    <Tag ref={ref} className={className} data-fade={fading ? "1" : "0"}>
      {shown}
    </Tag>
  );
}
