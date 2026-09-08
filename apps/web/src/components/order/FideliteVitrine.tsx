"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Icon } from "@/components/ui";
import { cx } from "@/lib/cx";
import {
  ecrireInstantane,
  lireEtatInstantane,
  oublierInstantane,
} from "../loyalty/carte-locale";
import { loadRememberedCustomerLoyaltyCard } from "../loyalty/customer-api";
import {
  CONSEIL_FIDELITE_APRES_COMMANDE,
  detailSoldeVitrine,
  promesseFidelite,
  provenanceSoldeVitrine,
  soldeVitrineDepuisCache,
  soldeVitrineDepuisReseau,
  type EtatSoldeVitrine,
  type VitrineFidelite,
} from "./fidelite";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * LE CHEMIN DE RETOUR : DE LA VITRINE VERS LA CARTE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ═══ CE QUI A ÉTÉ DÉCIDÉ SUR LE COOKIE, ET POURQUOI ═══
 *
 * L'arbitrage proposé était d'élargir le `Path` du cookie de session de
 * `/r/<slug>/fidelite` à `/r/<slug>`, pour que le composant serveur de la
 * vitrine puisse lire la carte. Il n'a PAS été appliqué, et le solde réel
 * s'affiche quand même. Trois faits :
 *
 * 1. LE CHEMIN N'EXCLUAIT PAS LA VITRINE COMME ON LE CROYAIT. Un cookie est
 *    envoyé selon le chemin de la REQUÊTE, jamais selon celui de la page qui
 *    la déclenche. Depuis `/r/<slug>`, un `fetch` vers
 *    `/r/<slug>/fidelite/card-session` est DANS le chemin du cookie : il part
 *    avec, et il est `same-site`, donc `SameSite=strict` ne le bloque pas
 *    (cette directive ne juge que les requêtes vers un AUTRE site). La vitrine
 *    obtient donc le solde réel sans qu'un octet de secret change de portée.
 *
 * 2. ÉLARGIR AURAIT COÛTÉ SANS RIEN RAPPORTER DE PLUS. Ce cookie contient le
 *    secret QR EN CLAIR : quiconque le détient peut lire la carte. Le porter
 *    sur toute la vitrine — la page la plus servie, la plus mise en cache, la
 *    plus proche de tiers — multiplie les chemins, les proxys et les
 *    gestionnaires qui le transportent, pour une capacité déjà obtenue.
 *
 * 3. `SameSite=strict` L'AURAIT RENDU ABSENT AU PIRE MOMENT. Une arrivée
 *    depuis Google, Instagram ou un lecteur de QR est une navigation de haut
 *    niveau INTER-SITE : le cookie n'est pas envoyé. Le solde n'aurait donc
 *    paru qu'une fois sur deux, selon d'où l'on vient — une incohérence pire
 *    que son absence.
 *
 * Le signal « ce navigateur a une carte ici » vient donc de l'instantané local
 * (`components/loyalty/carte-locale.ts`), qui est porté par l'ORIGINE et non
 * par un chemin, qui ne contient aucun secret, et qui existait déjà pour la
 * consultation hors ligne. Sans instantané (hors purge d'une charge expirée),
 * AUCUNE requête n'est émise : les visiteurs sans carte — l'immense majorité —
 * ne paient rien.
 */

export function FideliteVitrine({
  slug,
  resume,
  className,
}: {
  slug: string;
  resume: VitrineFidelite;
  className?: string;
}) {
  const [etat, setEtat] = useState<EtatSoldeVitrine | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      const lecture = lireEtatInstantane(slug);
      const instantane = lecture.instantane;
      // Aucune carte connue sur cet appareil : on n'appelle rien, et la bande
      // reste une invitation. Une charge expirée, déjà purgée, garde seulement
      // le droit de tenter cette actualisation : son cookie peut vivre 180 j.
      if (!instantane && lecture.etat !== "expire") return;
      if (!controller.signal.aborted) {
        if (instantane) {
          setEtat(
            soldeVitrineDepuisCache(
              instantane.solde,
              resume.uniteSingulier,
              resume.unitePluriel,
              instantane.vuA,
            ),
          );
        }
      }
      try {
        const fraiche = await loadRememberedCustomerLoyaltyCard(
          slug,
          controller.signal,
        );
        if (controller.signal.aborted) return;
        if (fraiche) {
          const ecrit = ecrireInstantane(slug, fraiche.member.balanceUnits);
          setEtat(soldeVitrineDepuisReseau(fraiche, ecrit.vuA));
        } else {
          // Le cookie a expiré ou a été retiré : l'instantané ne doit pas
          // survivre au droit qui le rendait consultable.
          oublierInstantane(slug);
          setEtat(null);
        }
      } catch {
        // La commande reste prioritaire, mais une copie locale affichée doit
        // dire explicitement que sa vérification a échoué.
        setEtat((courant) =>
          courant?.source === "cache"
            ? { ...courant, rafraichissement: "echec" }
            : courant,
        );
      }
    })();
    return () => controller.abort();
  }, [resume.unitePluriel, resume.uniteSingulier, slug]);

  const solde = etat;

  return (
    <section
      aria-labelledby="fidelite-vitrine"
      className={cx("pt-9", className)}
    >
      <div className="relative overflow-hidden rounded-panel border border-accent/20 bg-[image:var(--cf-card-gradient)] p-5 shadow-card sm:p-6">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-12 -top-16 size-48 rounded-full bg-accentwash blur-3xl"
        />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
          <div className="flex min-w-0 items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-card bg-accentwash text-accentink">
              <Icon name="gift" size={19} />
            </span>
            <div className="min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-[0.09em] text-accentink">
                {solde
                  ? solde.source === "reseau"
                    ? "Solde vérifié sur le réseau"
                    : "Solde enregistré hors ligne"
                  : "Programme fidélité"}
              </p>
              <h2
                id="fidelite-vitrine"
                className="font-display mt-1 text-[17px] font-extrabold tracking-[-0.03em] text-ink"
              >
                {solde ? (
                  <>
                    <span className="cf-fig">
                      {solde.solde.toLocaleString("fr-FR")}
                    </span>{" "}
                    {solde.unite}
                  </>
                ) : (
                  resume.programme
                )}
              </h2>
              <p className="mt-1 text-[13px] leading-5 text-mut">
                {solde ? detailSoldeVitrine(solde, resume) : promesseFidelite(resume)}
              </p>
              {solde && (
                <p className="mt-1.5 text-[11px] leading-4 text-mut">
                  {provenanceSoldeVitrine(solde)}
                </p>
              )}
            </div>
          </div>

          {/* 48 px et non 52 : cette bande n'est pas l'appel à l'action de la
              page — commander l'est. Elle reste largement au-dessus des 44 px
              exigés sans venir concurrencer le bouton du héros. */}
          <Link
            href={resume.chemin}
            className="cf-press flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-pill border border-accent/30 bg-accentwash px-5 text-sm font-extrabold text-accentink"
          >
            {solde ? "Ouvrir ma carte" : "Découvrir la fidélité"}
            <Icon name="arrow" size={16} stroke={2.4} />
          </Link>
        </div>
      </div>
    </section>
  );
}

/**
 * LE RAPPEL DE LA CONFIRMATION — sans inventer un rattachement rétroactif.
 *
 * ═══ CE QU'ON NE PEUT PAS PROMETTRE, ET POURQUOI ═══
 *
 * Une commande en ligne ne porte AUCUNE carte : `CreatePublicOrderSchema`
 * (contrats) n'a pas de champ membre, et c'est le processeur de la caisse qui
 * crédite, à partir du `loyaltyMemberId` qu'un ticket de comptoir attache.
 * Écrire ici « vous venez de gagner N points » serait donc faux.
 *
 * Le QR ne peut pas être ajouté après coup à la commande stricte déjà créée.
 * La confirmation renvoie donc vers le programme, son solde éventuel et ses
 * récompenses, sans promettre que cet achat sera crédité.
 */
export function FideliteApresCommande({
  resume,
}: {
  resume: VitrineFidelite;
}) {
  return (
    <Link
      href={resume.chemin}
      className="cf-press-row flex items-center gap-3 rounded-panel border border-accent/20 bg-accentwash px-4 py-3.5 text-left"
    >
      <span className="grid size-10 shrink-0 place-items-center rounded-card bg-accent text-onaccent">
        <Icon name="gift" size={19} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-extrabold text-ink">
          {resume.programme}
        </span>
        <span className="block text-[13px] leading-snug text-mut">
          {CONSEIL_FIDELITE_APRES_COMMANDE}
        </span>
      </span>
      <Icon name="arrow" size={16} stroke={2.4} className="shrink-0 text-accentink" />
    </Link>
  );
}
