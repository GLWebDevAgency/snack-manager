"use client";

import { useEffect } from "react";
import { API_URL } from "@/lib/api";

/**
 * Rapporteur d'erreurs du web — vitrine, tunnel de commande, back-offices.
 *
 * Monté UNE fois dans la racine (`app/layout.tsx`), il envoie les erreurs
 * globales et les promesses rejetées au guichet public de l'API, où elles
 * rejoignent le journal /sm/erreurs (diagnostic quatre casquettes, P0).
 * Jusqu'ici, un tunnel qui cassait un samedi soir mourait dans le navigateur
 * du client final.
 *
 * Mêmes règles que le rapporteur des tablettes (`client-core/error-report`) :
 * jamais d'exception sortante, dédoublonné et plafonné par session, aucune
 * donnée métier. Coupé en développement — le terminal du dev est déjà le bon
 * journal, et le guichet n'a pas à recevoir les brouillons.
 */

const MAX_PER_SESSION = 8;

export function ErrorReporter() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;

    const seen = new Set<string>();
    let sent = 0;

    const report = (message: unknown, stack?: string) => {
      const text = String(message ?? "").slice(0, 500);
      if (!text || text === "Script error.") return;
      const key = text.slice(0, 120);
      if (seen.has(key) || sent >= MAX_PER_SESSION) return;
      seen.add(key);
      sent += 1;
      try {
        void fetch(`${API_URL}/public/client-errors`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            source: "web",
            message: text,
            stack: (stack ?? "").slice(0, 6_000),
            url: window.location.pathname,
          }),
          keepalive: true,
        }).catch(() => {});
      } catch {
        // Rien — voir l'en-tête.
      }
    };

    const onError = (event: ErrorEvent) => {
      report(event.message, event.error instanceof Error ? event.error.stack : undefined);
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      const reason: unknown = event.reason;
      report(
        reason instanceof Error ? reason.message : reason,
        reason instanceof Error ? reason.stack : undefined,
      );
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  return null;
}
