"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { marqueDeRepli } from "@sm/contracts";
import { Icon } from "@/components/ui";
import { FeuilleDuMasque } from "@/components/masque/FeuilleDuMasque";
import { classesPolices } from "@/components/masque/polices";
import { styleDuMasque } from "@/components/masque/styleDuMasque";
import { cx } from "@/lib/cx";
import { retourDepuisCheminFidelite } from "./retour";

/*
 * Programme introuvable : aucun masque à charger. C'est le REPLI NUIT plutôt
 * que la marque grise de Snack Manager — le pourquoi complet est dans
 * `app/r/[slug]/not-found.tsx`.
 */
const REPLI = marqueDeRepli(null, null);
const MASQUE_DE_REPLI = styleDuMasque(REPLI);

/**
 * ═══ « RETOUR AU RESTAURANT » RENVOYAIT AU SITE DE SNACK MANAGER ═══
 *
 * Le bouton portait `href="/"` — la racine MARKETING de l'éditeur. Quelqu'un
 * dont le programme vient d'être suspendu, ou qui ouvre une PWA installée dont
 * le tenant a changé de slug, atterrissait sur la page commerciale du
 * prestataire de son restaurant. Sur le domaine personnalisé d'un client
 * (réécrit par `src/proxy.ts`), c'était même la seule chose visible de sa
 * marque : une page qui n'est pas la sienne.
 *
 * ═══ POURQUOI CE FICHIER EST DEVENU UN COMPOSANT CLIENT ═══
 *
 * Le slug est dans l'ADRESSE, mais Next ne passe aucun `params` à un
 * `not-found.tsx` : c'est une frontière, pas une route. `usePathname()` est le
 * seul accès au chemin demandé, et il n'existe que côté client. Le coût est
 * connu et petit — quelques kilo-octets sur une page d'erreur — et le gain est
 * que le client reste chez son restaurant.
 *
 * L'alternative — rendre l'erreur depuis `page.tsx`, qui connaît le slug —
 * aurait coûté le STATUT 404 : une adresse morte répondrait 200, et les
 * moteurs indexeraient une page d'indisponibilité comme une page valide.
 */
export default function LoyaltyNotFound() {
  const retour = retourDepuisCheminFidelite(usePathname());
  return (
    <main
      style={MASQUE_DE_REPLI}
      className={cx(
        classesPolices,
        "font-body grid min-h-dvh place-items-center bg-bg px-5 py-12 text-ink",
      )}
    >
      {/* Le masque remonte au document : canevas, rebond iOS, ascenseur
          et contrôles natifs — voir `FeuilleDuMasque`. */}
      <FeuilleDuMasque brand={REPLI} />
      <section className="w-full max-w-md rounded-wide border border-ink/10 bg-surface p-6 text-center shadow-deep sm:p-8">
        <span className="mx-auto grid size-14 place-items-center rounded-card bg-ink/6 text-mut">
          <Icon name="gift" size={24} />
        </span>
        <h1 className="font-display mt-6 text-2xl font-black tracking-[-0.04em]">
          Programme fidélité indisponible
        </h1>
        <p className="mt-3 text-sm leading-6 text-mut">
          Cette adresse n’est pas active ou le restaurant n’a pas encore publié son
          programme.
        </p>
        <Link
          href={retour.href}
          className="cf-press mt-6 inline-flex min-h-11 items-center justify-center gap-2 rounded-pill bg-accent px-5 text-sm font-extrabold text-onaccent"
        >
          {retour.libelle}
          <Icon name="arrow" size={16} stroke={2.4} />
        </Link>
      </section>
    </main>
  );
}
