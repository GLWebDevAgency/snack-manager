/** Slug inconnu dans une iframe : message court, sans lien de navigation. */
export default function EmbedNotFound() {
  return (
    <main className="grid min-h-dvh place-items-center bg-bg px-6 text-center">
      <div className="max-w-[320px]">
        <h1 className="text-[18px] font-extrabold tracking-[-0.03em] text-ink">
          Commande en ligne indisponible
        </h1>
        <p className="mt-2 text-[14px] leading-relaxed text-mut">
          Ce restaurant n’est pas (ou plus) configuré pour la commande en ligne.
        </p>
      </div>
    </main>
  );
}
