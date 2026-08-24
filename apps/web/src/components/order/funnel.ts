"use client";

/**
 * L'ENTONNOIR DU TUNNEL — quatre jalons, émis vers `POST /public/funnel`.
 *
 * Le tunnel était aveugle : impossible de dire s'il convertit ni où il perd
 * les clients (diagnostic quatre casquettes, P2). Quatre jalons anonymes
 * suffisent : visite, panier commencé, coordonnées ouvertes, commande passée.
 * Ni cookie, ni identifiant, ni montant — un slug, une étape, un canal.
 *
 * Discipline d'émission :
 * - UNE fois par étape et par chargement de page (dédupliqué ici) — recharger
 *   la page compte une nouvelle visite, c'est le comportement voulu ;
 * - JAMAIS en démonstration : le visiteur de la vitrine n'est pas un client
 *   du restaurant ;
 * - fire-and-forget, `keepalive` pour survivre à la navigation de fin de
 *   commande — et l'échec est silencieux : un jalon perdu ne vaut pas un log.
 */

import type { FunnelCanal, FunnelStep } from "@sm/contracts";
import { API_URL } from "@/lib/api";

let contexte: { slug: string; canal: FunnelCanal } | null = null;
const emis = new Set<FunnelStep>();

/** Posé par le Storefront au montage — sans lui, aucun jalon ne part. */
export function armeFunnel(slug: string, mode: "site" | "embed", demo: boolean): void {
  if (demo || typeof window === "undefined") {
    contexte = null;
    return;
  }
  // Le canal se déduit de l'entrée : le widget, la page hébergée, ou un
  // domaine propre (l'hôte ne se termine alors pas par le domaine commun).
  const canal: FunnelCanal =
    mode === "embed"
      ? "embed"
      : /snackmanager\.app$|railway\.app$|^localhost$/.test(window.location.hostname)
        ? "page"
        : "domaine";
  contexte = { slug, canal };
  emis.clear();
}

export function jalonFunnel(step: FunnelStep): void {
  if (!contexte || emis.has(step)) return;
  emis.add(step);
  try {
    void fetch(`${API_URL}/public/funnel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug: contexte.slug, step, canal: contexte.canal }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Rien — voir l'en-tête.
  }
}
