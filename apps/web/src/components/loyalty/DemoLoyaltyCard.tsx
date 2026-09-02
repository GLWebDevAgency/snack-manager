"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Card, Icon, Pill } from "@/components/ui";
import { useMasqueDeCapture } from "@/components/masque/masqueDeCapture";
import { styleDuMasque } from "@/components/masque/styleDuMasque";

const rewards = [
  { name: "Boisson offerte", cost: 8, ready: true },
  { name: "Menu signature offert", cost: 30, ready: false },
];

export function DemoLoyaltyCard() {
  /*
   * Cet aperçu ne lit AUCUNE marque : c'est `LoyaltyCardApp` qui porte le
   * masque réel d'un programme, résolu depuis le tenant — cette carte-ci
   * n'est jamais reliée à un vrai restaurant. Le seul besoin d'une marque ici
   * est la matrice de captures (`scripts/capture-masque.mjs`) : `demo` vaut
   * toujours vrai sur cette page, d'où le même levier `?masque=` que la
   * vitrine — voir `useMasqueDeCapture` pour le piège d'hydratation évité.
   */
  const brand = useMasqueDeCapture(true);
  /*
   * MÉMORISÉ — `resoudreMarque()` recalcule une trentaine de mélanges et
   * jusqu'à quatre recherches d'AA par pas de 1/200 (~0,5 ms). Sans ce
   * `useMemo`, la facture était payée à CHAQUE rendu de la racine — donc à
   * chaque frappe dans le tunnel et à chaque tick du suivi — pour un objet
   * identique. Sa référence sert aussi de `style` : la recréer forçait React
   * à repeindre tout le sous-arbre.
   */
  const masque = useMemo(() => (brand ? styleDuMasque(brand) : undefined), [brand]);
  return (
    <div
      style={masque}
      className="min-h-dvh overflow-x-clip bg-bg pb-[max(32px,env(safe-area-inset-bottom))] text-ink"
    >
      <div className="border-b border-prep/30 bg-prep/10 px-4 py-2.5 text-center text-[11px] font-extrabold uppercase tracking-[0.1em] text-prept">
        Démonstration · données entièrement fictives
      </div>
      <header className="border-b border-ink/8 bg-bg/85 px-4 py-3 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[720px] items-center gap-3">
          <span className="grid size-10 place-items-center rounded-card bg-accent text-sm font-black text-onaccent" aria-hidden>CF</span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-extrabold">Le Comptoir — restaurant fictif</p>
            <p className="font-display text-[11px] text-mut">Le Club Démo</p>
          </div>
          <Pill className="border-prep/30 bg-prep/10 text-prept">Simulation</Pill>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[720px] px-4 pt-6">
        <section className="relative overflow-hidden rounded-wide border border-accent/30 bg-[image:var(--cf-card-gradient)] p-5 shadow-deep sm:p-7">
          <div className="absolute -right-16 -top-16 size-56 rounded-full bg-accent/15 blur-3xl" aria-hidden />
          <div className="relative flex items-start justify-between gap-4">
            <div>
              <Pill className="border-ok/30 bg-ok/10 text-okt">Carte fictive active</Pill>
              <h1 className="font-display mt-3 text-xl font-extrabold tracking-[-0.035em]">Bonjour Maya</h1>
            </div>
            <Icon name="gift" size={28} className="text-accentink" />
          </div>
          <div className="relative mt-8">
            <p className="text-[11px] font-bold uppercase tracking-[0.09em] text-mut">Solde de démonstration</p>
            <p className="cf-fig font-display mt-1 text-[clamp(2.75rem,2.3rem+1.8vw,3.25rem)] font-black leading-none tracking-[-0.055em]">24</p>
            <p className="mt-1 text-sm font-bold text-accentink">points fictifs</p>
          </div>
          <div className="relative mt-7">
            <div className="h-2 overflow-hidden rounded-pill bg-ink/10"><div className="h-full w-4/5 rounded-pill bg-accent" /></div>
            <p className="mt-2 text-xs text-mut">Encore 6 points fictifs pour « Menu signature offert »</p>
          </div>
        </section>

        <section className="mt-6">
          <p className="text-[11px] font-bold uppercase tracking-[0.09em] text-accentink">Aperçu client</p>
          <h2 className="font-display mt-1 text-xl font-extrabold tracking-[-0.035em]">Récompenses du moment</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {rewards.map((reward) => (
              <Card key={reward.name} className={reward.ready ? "border-ok/25 p-4" : "p-4 opacity-75"}>
                <div className="flex items-center gap-3">
                  <span className={reward.ready ? "grid size-11 place-items-center rounded-card bg-ok/12 text-okt" : "grid size-11 place-items-center rounded-card bg-ink/6 text-mut"}><Icon name={reward.ready ? "check" : "gift"} size={19} /></span>
                  <div><p className="text-sm font-extrabold">{reward.name}</p><p className="mt-1 text-xs text-mut">{reward.cost} points · {reward.ready ? "palier atteint" : "bientôt disponible"}</p></div>
                </div>
              </Card>
            ))}
          </div>
        </section>

        <Card className="mt-6 border-prep/25 bg-prep/5 p-4">
          <p className="text-sm font-extrabold text-prept">Ce parcours ne crée aucune vraie carte</p>
          <p className="mt-2 text-xs leading-5 text-mut">Le QR scanné sert uniquement à montrer l’expérience sur un second appareil. Aucun client, solde ou avantage n’est enregistré.</p>
          <Link href="/" className="cf-press mt-4 inline-flex min-h-11 items-center rounded-pill border border-ink/10 px-4 py-2.5 text-xs font-bold text-ink hover:bg-ink/5">Découvrir Snack Manager</Link>
        </Card>
      </main>
    </div>
  );
}
