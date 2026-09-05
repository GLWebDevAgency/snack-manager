"use client";

import { createContext, useContext, type ReactNode } from "react";
import Link from "next/link";
import type { Capacite } from "@sm/contracts";
import { Icon } from "@/components/ui";
import { accesPage, navActive, type ContexteNav } from "./navigation";

const AccessContext = createContext<readonly Capacite[]>([]);
export const useAdminCapabilities = () => useContext(AccessContext);

/** Le contenu non souscrit n'est jamais monté, même par une URL directe. */
export function AdminAccess({ pathname, context, pending, failed, demo, children }: {
  pathname: string; context: ContexteNav; pending: boolean; failed: boolean;
  demo: boolean; children: ReactNode;
}) {
  const access = context.suspendu && pathname === "/admin" && context.role !== "owner" && context.role !== "comptable"
    ? "forbidden" : accesPage(pathname, context);
  if (!demo && pending && pathname !== "/admin/abonnement") {
    return <div role="status" className="p-8 text-sm text-mut">
      {failed ? <>Impossible de vérifier votre accès. <button className="underline text-ink" onClick={() => window.location.reload()}>Réessayer</button></> : "Chargement de votre espace…"}
    </div>;
  }
  if (access === "forbidden") return <div role="alert" className="p-8 text-mut">Votre rôle ne permet pas d’ouvrir cette page. Contactez le propriétaire de l’établissement.</div>;
  if (!demo && access === "locked") {
    const item = navActive(pathname);
    return <section className="flex min-h-[65dvh] items-center justify-center p-6">
      <div className="w-full max-w-lg rounded-3xl border border-line bg-surface p-7 md:p-10">
        <span className="inline-flex items-center gap-2 rounded-full border border-line px-3 py-1.5 text-xs font-semibold text-mut"><Icon name="lock" size={14} /> Module complémentaire</span>
        <h2 className="mt-5 text-2xl font-bold tracking-tight text-ink">{item?.label ?? "Un nouvel outil pour votre restaurant"}</h2>
        <p className="mt-3 text-sm leading-relaxed text-mut">Cette fonction n’est pas comprise dans votre offre actuelle. Ajoutez uniquement les outils utiles à votre activité, ou découvrez nos formules pour gérer davantage depuis le même espace.</p>
        <p className="mt-3 text-sm text-mut">Vos services actuels restent disponibles. Aucun changement ni paiement sans votre accord.</p>
        <div className="mt-7 flex flex-wrap gap-3">
          <Link href="/offres" target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center rounded-xl bg-accent px-5 text-sm font-semibold text-onaccent transition-opacity hover:opacity-85 motion-reduce:transition-none">Découvrir les offres<span className="sr-only"> (nouvel onglet)</span></Link>
          <Link href="/contact" target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center rounded-xl border border-line px-5 text-sm font-semibold text-ink">Parlons de vos besoins<span className="sr-only"> (nouvel onglet)</span></Link>
        </div>
      </div>
    </section>;
  }
  return <AccessContext value={context.capacites ?? []}>{children}</AccessContext>;
}
