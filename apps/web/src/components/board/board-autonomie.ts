"use client";

import { useEffect } from "react";
import type { ScreenContent } from "@sm/contracts";

/**
 * L'AUTONOMIE DE L'ÉCRAN — ce que l'affichage demande au service worker.
 *
 * Le worker (`app/board/sw.js/route.ts`) tient la coquille et les photos sur
 * l'appareil. L'affichage, lui, sait DEUX choses que le worker ignore : quand
 * un contenu frais arrive, et quelles images il montre. Il les lui dit.
 */

const CHEMIN_WORKER = "/board/sw.js";
const PORTEE = "/board";

/** Une adresse qu'on peut mettre en cache : absolue http(s), ou relative à notre origine. */
function adresseCacheable(url: string | null | undefined): url is string {
  if (!url) return false;
  return /^https?:\/\//.test(url) || url.startsWith("/");
}

/**
 * Tout ce que la boucle affiche, une fois chacun : les photos de toutes les
 * scènes, le logo de l'en-tête, les quatre emplacements du masque. C'est la
 * liste que le worker précache — et la liste au-delà de laquelle il purge.
 */
export function mediasDuContenu(content: ScreenContent | null): string[] {
  if (!content) return [];
  const vus = new Set<string>();
  const ajouter = (url: string | null | undefined) => {
    if (adresseCacheable(url)) vus.add(url);
  };
  for (const scene of content.scenes) {
    for (const product of scene.products) ajouter(product.photoUrl);
  }
  ajouter(content.brand.logoUrl);
  const logo = content.masque?.logo;
  if (logo) {
    ajouter(logo.mark.light);
    ajouter(logo.mark.dark);
    ajouter(logo.lockup.light);
    ajouter(logo.lockup.dark);
  }
  return [...vus];
}

/** Enregistre le worker au montage de l'affichage ; silencieux si l'appareil ne sait pas. */
export function useServiceWorkerEcran(): void {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    void navigator.serviceWorker.register(CHEMIN_WORKER, { scope: PORTEE }).catch(() => {
      // Sans worker, l'écran fonctionne comme avant : le contenu est en
      // mémoire locale, seule la coquille redemande le réseau au démarrage.
    });
  }, []);
}

/**
 * Commande le précache des médias de la boucle. Les adresses relatives sont
 * rendues absolues ici : le worker n'accepte que des adresses complètes.
 */
export function precacherMedias(urls: readonly string[]): void {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  if (urls.length === 0) return;
  const absolues = urls.map((u) => (u.startsWith("/") ? `${window.location.origin}${u}` : u));
  const message = { type: "sm-board:precache", urls: absolues };
  const controller = navigator.serviceWorker.controller;
  if (controller) {
    controller.postMessage(message);
    return;
  }
  // Premier chargement : le worker vient de s'installer et ne contrôle pas
  // encore la page. On attend qu'il soit prêt plutôt que de perdre la liste.
  void navigator.serviceWorker.ready
    .then((registration) => registration.active?.postMessage(message))
    .catch(() => undefined);
}
