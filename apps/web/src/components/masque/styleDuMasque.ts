import type { CSSProperties } from "react";
import { resoudreMarque, type Brand } from "@sm/contracts";

/**
 * Le masque en `style` inline sur la RACINE d'une surface client. Tailwind v4
 * (`@theme inline`) résout `var(--cf-*)` à l'usage : tout le sous-arbre
 * change de peau, l'admin — où ce style n'est jamais posé — reste intact.
 * `colorScheme` fait suivre les contrôles natifs et les ascenseurs.
 */
export function styleDuMasque(brand: Brand): CSSProperties {
  const { vars, colorScheme } = resoudreMarque(brand);
  return { ...vars, colorScheme } as CSSProperties;
}
