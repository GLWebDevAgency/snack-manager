"use client";

/**
 * ENCAISSEMENT EN LIGNE — l'écran où le restaurateur branche SON compte.
 *
 * Une seule idée à faire passer, et elle vaut mieux que dix explications :
 * **l'argent de vos clients arrive chez vous, pas chez nous.** Tout le reste
 * de la page en découle — l'état, le bouton, et la clause du bas.
 *
 * Trois principes d'écran :
 *
 * 1. L'ÉTAT SE LIT AVANT DE LIRE. La pastille et sa couleur disent en un coup
 *    d'œil si les commandes en ligne sont encaissables ; la phrase en dessous
 *    dit quoi faire. Un gérant qui ouvre cette page entre deux services n'a
 *    pas le temps de déchiffrer.
 *
 * 2. LE LIEN STRIPE SE DEMANDE À CHAQUE CLIC. Ces liens expirent en quelques
 *    minutes : un lien mis en cache enverrait le restaurateur sur une page
 *    morte, et il croirait le service cassé.
 *
 * 3. AU RETOUR DE STRIPE, ON RESYNCHRONISE. Le webhook fait le même travail,
 *    mais il peut arriver quelques secondes plus tard : sans cette relecture,
 *    le gérant revient sur un écran qui dit encore « inscription à terminer »
 *    alors qu'il vient de la terminer — et il recommence.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { EncaissementFiche } from "@sm/contracts";
import { api } from "@/lib/api";
import { cx } from "@/lib/cx";
import { Btn, Card, EmptyState, Skeleton, useToast } from "@/components/ui";

export default function EncaissementPage() {
  const toast = useToast();
  const [fiche, setFiche] = useState<EncaissementFiche | null>(null);
  const [erreur, setErreur] = useState(false);
  const [busy, setBusy] = useState(false);

  const charger = useCallback(async (resynchroniser = false) => {
    // Au retour de Stripe on relit les drapeaux À LA SOURCE ; à l'ouverture
    // ordinaire, la fiche stockée suffit et coûte un appel de moins.
    const route = resynchroniser ? "/encaissement/me/synchroniser" : "/encaissement/me";
    return resynchroniser
      ? api.post<EncaissementFiche>(route)
      : api.get<EncaissementFiche>(route);
  }, []);

  const premierChargement = useRef(true);
  useEffect(() => {
    let annule = false;
    // Stripe renvoie sur cette page sans paramètre distinctif : on
    // resynchronise donc au premier affichage, c'est le seul moment où le
    // retour d'inscription est possible.
    const retourDeStripe = premierChargement.current;
    premierChargement.current = false;
    charger(retourDeStripe)
      .then((f) => {
        if (!annule) setFiche(f);
      })
      .catch(() => {
        if (!annule) setErreur(true);
      });
    return () => {
      annule = true;
    };
  }, [charger]);

  async function raccorder() {
    if (busy) return;
    setBusy(true);
    try {
      const lien = await api.post<{ url: string }>("/encaissement/me/raccordement");
      // Même onglet : le parcours Stripe se termine par un retour ici, et une
      // fenêtre surgissante serait bloquée sur la moitié des navigateurs.
      window.location.href = lien.url;
    } catch (e) {
      setBusy(false);
      toast(e instanceof Error ? e.message : "Raccordement impossible — réessayez");
    }
  }

  if (erreur) {
    return (
      <EmptyState
        icon="gear"
        title="Encaissement indisponible"
        hint="Impossible de lire l'état de votre encaissement en ligne. Réessayez dans un instant."
      />
    );
  }

  if (!fiche) {
    return (
      <div className="flex flex-col gap-3 p-[26px] max-md:p-4">
        <Skeleton className="h-32" />
        <Skeleton className="h-24" />
      </div>
    );
  }

  const actif = fiche.etat === "actif";

  return (
    <div className="mx-auto flex min-w-0 max-w-[760px] flex-col gap-4 p-[26px] max-md:p-4">
      <header>
        <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-mut">Commande en ligne</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-[-0.04em] text-ink">Encaissement en ligne</h1>
        <p className="mt-2 text-sm leading-relaxed text-mut">Votre compte Stripe et vos paiements en ligne.</p>
      </header>
      <Card className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3 max-md:flex-col">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className={cx(
                  "size-2.5 shrink-0 rounded-full",
                  actif ? "bg-ok" : fiche.etat === "restreint" ? "bg-prep" : "bg-white/25",
                )}
              />
              <h2 className="text-[17px] font-bold text-ink">{fiche.etatLabel}</h2>
            </div>
            {fiche.raison && (
              <p className="mt-2 max-w-[52ch] text-[13.5px] leading-[1.5] text-mut">
                {fiche.raison}
              </p>
            )}
            {actif && (
              <p className="mt-2 max-w-[52ch] text-[13.5px] leading-[1.5] text-mut">
                Vos clients peuvent régler leurs commandes en ligne. L&apos;argent arrive
                directement sur votre compte, sans passer par nous.
              </p>
            )}
          </div>

          {fiche.disponible ? (
            !actif && (
              <Btn variant="primary" size="sm" className="min-h-11 w-full sm:w-auto" disabled={busy} aria-busy={busy} onClick={() => void raccorder()}>
                {busy
                  ? "Ouverture…"
                  : fiche.etat === "absent"
                    ? "Raccorder mon compte"
                    : "Reprendre l'inscription"}
              </Btn>
            )
          ) : (
            <span className="shrink-0 text-[12.5px] text-mut">Bientôt disponible</span>
          )}
        </div>
      </Card>

      {/* La clause qui rend la promesse vérifiable — et qui dit aussi la
          contrepartie honnête des charges directes : les litiges sont débités
          du compte du restaurateur, puisque c'est lui qui a encaissé. */}
      <Card className="p-4 sm:p-5">
        <h3 className="text-[15px] font-bold text-ink">Ce que ça veut dire, précisément</h3>
        <ul className="mt-3 flex flex-col gap-2.5 text-[13.5px] leading-[1.5] text-mut">
          <li>
            <strong className="text-ink">L&apos;argent va chez vous.</strong> Chaque commande
            payée en ligne est encaissée sur votre compte Stripe, à vos conditions. Nous ne le
            touchons jamais.
          </li>
          <li>
            <strong className="text-ink">Zéro commission de notre part.</strong> Nous ne prenons
            rien sur vos ventes — ni en ligne, ni au comptoir. Seuls s&apos;appliquent les frais
            de votre prestataire de paiement.
          </li>
          <li>
            <strong className="text-ink">Vos documents restent chez Stripe.</strong> Pièce
            d&apos;identité, coordonnées bancaires : vous les donnez à Stripe, jamais à nous.
          </li>
          <li>
            <strong className="text-ink">En contrepartie, les litiges sont pour vous.</strong> Un
            client qui conteste un paiement le conteste auprès de votre banque — c&apos;est la
            règle quand l&apos;argent arrive directement chez vous.
          </li>
        </ul>
      </Card>

      {!actif && (
        <p className="text-[12.5px] leading-[1.5] text-mut">
          Sans raccordement, vos clients commandent en ligne et règlent au comptoir au retrait.
          Rien n&apos;est bloqué — vous encaissez comme aujourd&apos;hui.
        </p>
      )}
    </div>
  );
}
