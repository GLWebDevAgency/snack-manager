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
  const [fading, setFading] = useState(false);

  useEffect(() => {
    if (value === shown) return;
    const duree = dureeMs(
      ref.current ? getComputedStyle(ref.current).getPropertyValue("--sm-t-fast") : "",
    );
    // eslint-disable-next-line react-hooks/set-state-in-effect -- le fondu est un ENCHAÎNEMENT dans le temps (effacer, puis remplacer) : il ne se dérive pas du rendu, il se joue après lui.
    setFading(true);
    const timer = setTimeout(() => {
      setShown(value);
      setFading(false);
    }, duree);
    return () => clearTimeout(timer);
  }, [value, shown]);

  const Tag = as;
  return (
    <Tag ref={ref} className={className} data-fade={fading ? "1" : "0"}>
      {shown}
    </Tag>
  );
}
