"use client";

import { BoardDisplay } from "@/components/board/board-display";

/**
 * /board/display — l'affichage permanent.
 *
 * C'est l'URL qu'on grave dans la clé HDMI ou dans le navigateur de la Smart
 * TV : elle repart seule après une coupure de courant, sans écran de
 * configuration, puisque le jeton d'appareil est persistant.
 */
export default function BoardDisplayPage() {
  return <BoardDisplay />;
}
