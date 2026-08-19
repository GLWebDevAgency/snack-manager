"use client";

import { PairingScreen } from "@/components/board/pairing-screen";

/**
 * /board — l'écran qu'on voit une seule fois dans la vie d'un téléviseur.
 *
 * Tout est côté client : la page lit le jeton d'appareil en mémoire locale et,
 * s'il existe déjà, file directement sur la carte sans rien afficher.
 */
export default function BoardPairingPage() {
  return <PairingScreen />;
}
