import Link from "next/link";

/** Slug inconnu — page franche, pas un écran d’erreur technique. */
export default function RestaurantNotFound() {
  return (
    <main className="grid min-h-dvh place-items-center bg-bg px-6 text-center">
      <div className="max-w-[380px]">
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-mut">
          Erreur 404
        </p>
        <h1 className="mt-2 text-[26px] font-extrabold tracking-[-0.035em] text-ink">
          Ce restaurant n’existe pas
        </h1>
        <p className="mt-3 text-[15px] leading-relaxed text-mut">
          L’adresse est peut-être erronée, ou l’établissement n’utilise plus la
          commande en ligne.
        </p>
        <Link
          href="/"
          className="mt-6 inline-flex items-center justify-center rounded-pill border border-white/12 bg-surface2 px-5 py-3 text-[14px] font-bold text-ink transition-transform duration-200 ease-sm active:scale-[0.97]"
        >
          Retour à l’accueil
        </Link>
      </div>
    </main>
  );
}
