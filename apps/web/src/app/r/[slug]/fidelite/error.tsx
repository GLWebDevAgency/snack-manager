"use client";

import { Btn, Icon } from "@/components/ui";

export default function LoyaltyError({ reset }: { reset: () => void }) {
  return (
    <main className="grid min-h-dvh place-items-center bg-bg px-5 py-12 text-ink">
      <section className="w-full max-w-md rounded-wide border border-alert/25 bg-surface p-6 text-center shadow-deep sm:p-8">
        <span className="mx-auto grid size-14 place-items-center rounded-card bg-alert/10 text-alertt">
          <Icon name="close" size={24} />
        </span>
        <h1 className="mt-5 text-2xl font-black tracking-[-0.04em]">
          La carte ne répond pas
        </h1>
        <p className="mt-3 text-sm leading-6 text-mut">
          Votre carte n’a pas été modifiée. Vérifiez la connexion puis relancez le chargement.
        </p>
        <Btn className="mt-6" onClick={reset}>
          Réessayer
        </Btn>
      </section>
    </main>
  );
}
