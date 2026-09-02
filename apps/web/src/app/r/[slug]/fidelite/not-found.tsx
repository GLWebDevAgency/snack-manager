import Link from "next/link";
import { Icon } from "@/components/ui";

export default function LoyaltyNotFound() {
  return (
    <main className="grid min-h-dvh place-items-center bg-bg px-5 py-12 text-ink">
      <section className="w-full max-w-md rounded-wide border border-ink/10 bg-surface p-6 text-center shadow-deep sm:p-8">
        <span className="mx-auto grid size-14 place-items-center rounded-card bg-ink/6 text-mut">
          <Icon name="gift" size={24} />
        </span>
        <h1 className="font-display mt-5 text-2xl font-black tracking-[-0.04em]">
          Programme fidélité indisponible
        </h1>
        <p className="mt-3 text-sm leading-6 text-mut">
          Cette adresse n’est pas active ou le restaurant n’a pas encore publié son programme.
        </p>
        <Link
          href="/"
          className="cf-press mt-6 inline-flex min-h-11 items-center justify-center rounded-pill bg-accent px-5 text-sm font-extrabold text-onaccent"
        >
          Retour au restaurant
        </Link>
      </section>
    </main>
  );
}
