import type { ReactNode } from "react";
import { LoyaltyNavigation } from "./LoyaltyNavigation";

export default function LoyaltyLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <section>
      <div className="px-4 pt-4 md:px-[26px] md:pt-[22px]">
        <div className="mb-4 flex items-start gap-3">
          <div
            aria-hidden
            className="grid size-10 shrink-0 place-items-center rounded-card border border-white/8 bg-[image:var(--cf-elev-gradient)] text-xl"
          >
            ✦
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-extrabold tracking-[-0.035em] text-ink md:text-2xl">
              Fidélité clients
            </h1>
            <p className="mt-0.5 text-[13px] text-mut">
              Une carte autonome au comptoir, même sans commande en ligne.
            </p>
          </div>
        </div>
        <LoyaltyNavigation />
      </div>
      {children}
    </section>
  );
}
