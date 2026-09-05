import { BrandSchema, marqueDeRepli, type Brand, type ScreenContent } from "@sm/contracts";

/**
 * Le masque que l'écran PEINT.
 *
 * Un cache écrit par une version antérieure n'en porte pas : on replie sur
 * l'accent et le logo plats plutôt que sur un écran noir, le temps du prochain
 * contenu frais — qui arrive dans la minute. Fonction PURE, séparée de l'hôte
 * pour être testée sans `next/font`.
 */
export function masqueDuContenu(content: ScreenContent | null): Brand {
  if (content?.masque && BrandSchema.safeParse(content.masque).success) return content.masque;
  return marqueDeRepli(content?.brand.accent ?? null, content?.brand.logoUrl ?? null);
}
