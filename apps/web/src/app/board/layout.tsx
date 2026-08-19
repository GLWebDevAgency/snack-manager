import type { Metadata, Viewport } from "next";
import "@/components/board/board.css";

/**
 * « Menu Board » — l'écran de salle.
 *
 * Cette branche du site ne s'adresse pas à un internaute mais à un téléviseur :
 * pas de navigation, pas de défilement, pas de curseur, et surtout aucune
 * indexation — un écran de restaurant n'a rien à faire dans un moteur de
 * recherche.
 */

export const metadata: Metadata = {
  title: "Menu Board",
  description: "L'affichage de salle du restaurant.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Une TV n'a pas de doigts : le pincement n'a aucun sens, et le laisser actif
  // expose l'écran à un zoom accidentel qu'aucun client ne saura défaire.
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#000000",
};

export default function BoardLayout({ children }: { children: React.ReactNode }) {
  return children;
}
