"use client";

import Link from "next/link";
import { useMemo } from "react";
import { Card, Icon, Pill } from "@/components/ui";
import { useMasqueDeCapture } from "@/components/masque/masqueDeCapture";
import { FeuilleDuMasque } from "@/components/masque/FeuilleDuMasque";
import { classesPolices } from "@/components/masque/polices";
import { styleDuMasque } from "@/components/masque/styleDuMasque";
import { cx } from "@/lib/cx";
import {
  ActionCommander,
  EnTeteFidelite,
  SoldeCarte,
  TitreSection,
  TuileRecompense,
} from "./carte-visuelle";
import { dureeEnMs, useCompteAnime } from "./mouvement";
import { phraseDeProgression, progressionVers, type Recompense } from "./paliers";
import { SignatureSnackManager } from "./SignatureSnackManager";

/** Repli de la durée « fête » quand aucun masque n'est demandé par l'URL. */
const FETE_PAR_DEFAUT_MS = 900;

const SOLDE = 24;
const UNITE_SINGULIER = "point fictif";
const UNITE_PLURIEL = "points fictifs";

/*
 * Des récompenses de démonstration, à la FORME du contrat — le composant de
 * tuile est le même que celui du produit, il attend donc les mêmes champs.
 * Les identifiants sont figés : rien ici n'atteint jamais une base.
 */
const RECOMPENSES: Recompense[] = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Boisson offerte",
    description: "À retirer au comptoir avec votre commande",
    costUnits: 8,
    kind: "product",
    valueCents: null,
    productRef: "Boisson 33 cl",
    affordable: true,
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    name: "Menu signature offert",
    description: "Le menu du moment, entièrement offert",
    costUnits: 30,
    kind: "product",
    valueCents: null,
    productRef: "Menu signature",
    affordable: false,
  },
];

const PALIER = RECOMPENSES[1] ?? null;

/**
 * L'APERÇU N'EST PLUS UNE MAQUETTE — c'est la carte, avec d'autres chiffres.
 *
 * Cette page rendait sa PROPRE composition, écrite à la main à côté de celle
 * du produit. Les deux avaient déjà divergé (pastilles de 40 px ici, 44 là,
 * hiérarchies différentes, aucun mouvement des deux côtés), si bien que la
 * matrice de captures — dont c'est l'unique entrée fidélité
 * (`scripts/capture-masque.mjs`) — prouvait les six directions d'un écran qui
 * n'existait nulle part, et qu'un prospect voyait une démonstration qui n'était
 * pas le produit qu'on lui vendait.
 *
 * Les pièces viennent maintenant de `carte-visuelle.tsx`, partagées avec
 * `LoyaltyCardApp` : une divergence n'est plus possible, et la démonstration
 * montre enfin le mouvement (le solde qui monte, la jauge qui le suit) sur
 * chacune des six directions.
 */
export function DemoLoyaltyCard() {
  /*
   * Cet aperçu ne lit AUCUNE marque de restaurant : c'est `LoyaltyCardApp` qui
   * porte le masque réel d'un programme, résolu depuis le tenant — cette
   * carte-ci n'est jamais reliée à un vrai établissement. Le seul besoin d'une
   * marque ici est la matrice de captures (`scripts/capture-masque.mjs`) :
   * `demo` vaut toujours vrai sur cette page, d'où le même levier `?masque=`
   * que la vitrine — voir `useMasqueDeCapture` pour le piège d'hydratation
   * évité.
   */
  const brand = useMasqueDeCapture(true);
  /*
   * MÉMORISÉ — `resoudreMarque()` recalcule une trentaine de mélanges et
   * jusqu'à quatre recherches d'AA par pas de 1/200 (~0,5 ms). Sa référence
   * sert aussi de `style` : la recréer forçait React à repeindre tout le
   * sous-arbre à chaque image de la montée du solde.
   */
  const masque = useMemo(() => (brand ? styleDuMasque(brand) : undefined), [brand]);
  const dureeFete = useMemo(
    () =>
      dureeEnMs(
        (masque as Record<string, unknown> | undefined)?.["--sm-t-slow"],
        FETE_PAR_DEFAUT_MS,
      ),
    [masque],
  );
  const soldeAffiche = useCompteAnime(SOLDE, dureeFete);

  return (
    <div
      style={masque}
      className={cx(
        /*
         * `classesPolices` ET `font-body` — les deux, comme sur toutes les
         * autres racines client. Sans les dix-huit classes de next/font, les
         * variables `--police-<slug>` n'existent pas dans ce sous-arbre :
         * `--cf-font-display` retombait sur son repli et cet aperçu se peignait
         * en Inter, quelle que soit la paire du masque. La matrice de captures
         * (`?masque=`) partait d'ici : elle prouvait donc les couleurs, jamais
         * la typographie.
         */
        classesPolices,
        "font-body min-h-dvh overflow-x-clip bg-bg pb-[max(32px,env(safe-area-inset-bottom))] text-ink",
      )}
    >
      {/* Le masque remonte au document : canevas, rebond iOS, ascenseur
          et contrôles natifs — voir `FeuilleDuMasque`. */}
      {brand && <FeuilleDuMasque brand={brand} />}
      <div className="border-b border-prep/30 bg-prep/10 px-4 py-2.5 text-center text-[11px] font-extrabold uppercase tracking-[0.1em] text-prept">
        Démonstration · données entièrement fictives
      </div>

      <EnTeteFidelite
        nom="Le Comptoir — restaurant fictif"
        programme="Le Club Démo"
        logoUrl={null}
        aside={<Pill className="border-prep/30 bg-prep/10 text-prept">Simulation</Pill>}
      />

      <main className="mx-auto w-full max-w-[1080px] px-4 pt-6">
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] lg:gap-8">
          <div className="lg:sticky lg:top-24">
            <SoldeCarte
              alias="Maya"
              soldeAffiche={soldeAffiche}
              soldeReel={SOLDE}
              uniteSingulier={UNITE_SINGULIER}
              unitePluriel={UNITE_PLURIEL}
              palier={PALIER}
              progression={progressionVers(soldeAffiche, PALIER)}
              phrase={phraseDeProgression(SOLDE, PALIER, UNITE_SINGULIER, UNITE_PLURIEL)}
              fete={false}
              /*
               * « Commander » mène à la VITRINE de démonstration, pas à la page
               * marketing : c'est le trajet réel du produit, et c'est
               * précisément ce que la démonstration doit montrer — les deux
               * surfaces se répondent.
               */
              action={<ActionCommander href="/r/demo?demo=1" nomRestaurant="Le Comptoir" />}
            />
          </div>

          <div>
            <section>
              <TitreSection
                sur="Aperçu client"
                note="Le QR scanné sert uniquement à montrer l’expérience sur un second appareil. Aucun client, solde ou avantage n’est enregistré."
              >
                Récompenses du moment
              </TitreSection>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                {RECOMPENSES.map((recompense) => (
                  <TuileRecompense
                    key={recompense.id}
                    nom={recompense.name}
                    detail={recompense.description}
                    cout={recompense.costUnits}
                    uniteSingulier={UNITE_SINGULIER}
                    unitePluriel={UNITE_PLURIEL}
                    acquise={recompense.affordable}
                  />
                ))}
              </div>
            </section>

            <Card className="mt-10 border-prep/25 bg-prep/5 p-5 shadow-card">
              <p className="text-sm font-extrabold text-prept">
                Ce parcours ne crée aucune vraie carte
              </p>
              <p className="mt-3 text-xs leading-5 text-mut">
                Chez un vrai restaurant, ce même écran affiche le solde réel du
                client, son historique et le QR à présenter en caisse.
              </p>
              <Link
                href="/"
                className="cf-press mt-4 inline-flex min-h-11 items-center gap-2 rounded-pill border border-ink/10 px-4 py-2.5 text-xs font-bold text-ink hover:bg-ink/5"
              >
                Découvrir Snack Manager
                <Icon name="arrow" size={14} stroke={2.4} />
              </Link>
            </Card>
          </div>
        </div>
      </main>

      {/* Même signature que la vraie carte : la démonstration ne doit pas
          montrer un produit sans son auteur. */}
      {/* Le masque de capture peut être absent : la signature attend, comme
          la feuille du masque juste au-dessus. */}
      {brand && <SignatureSnackManager brand={brand} />}
    </div>
  );
}
