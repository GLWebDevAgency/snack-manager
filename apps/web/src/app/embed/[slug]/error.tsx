"use client";

/** Panne dans l’iframe : le site hôte du restaurant ne doit pas paraître cassé. */
export default function EmbedError({ reset }: { reset: () => void }) {
  return (
    <main className="grid min-h-dvh place-items-center bg-bg px-6 text-center">
      <div className="max-w-[320px]">
        <h1 className="text-[18px] font-extrabold tracking-[-0.03em] text-ink">
          La carte ne s’est pas chargée
        </h1>
        <p className="mt-2 text-[14px] leading-relaxed text-mut">
          Le service est momentanément injoignable.
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-5 inline-flex items-center justify-center rounded-pill bg-accent px-5 py-2.5 text-[14px] font-extrabold text-onaccent transition-transform duration-200 ease-sm active:scale-[0.97]"
        >
          Réessayer
        </button>
      </div>
    </main>
  );
}
