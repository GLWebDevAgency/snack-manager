"use client";

import { useEffect } from "react";

/**
 * Panne côté service (API injoignable, 5xx). La vitrine d’un restaurant ne doit
 * jamais afficher une trace technique : message clair, numéro de secours
 * impossible à donner ici, et une reprise en un appui.
 */
export default function RestaurantError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[/r] chargement du restaurant impossible", error);
  }, [error]);

  return (
    <main className="grid min-h-dvh place-items-center bg-bg px-6 text-center">
      <div className="max-w-[380px]">
        <h1 className="text-[24px] font-extrabold tracking-[-0.035em] text-ink">
          La carte ne s’est pas chargée
        </h1>
        <p className="mt-3 text-[15px] leading-relaxed text-mut">
          Le service est momentanément injoignable. Le restaurant, lui, est
          toujours ouvert&nbsp;: réessayez dans un instant.
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-6 inline-flex items-center justify-center rounded-pill bg-accent px-5 py-3 text-[14px] font-extrabold text-onaccent transition-transform duration-200 ease-sm active:scale-[0.97]"
        >
          Réessayer
        </button>
        {error.digest && (
          <p className="mt-4 text-[12px] text-mut tabular-nums">
            Référence : {error.digest}
          </p>
        )}
      </div>
    </main>
  );
}
