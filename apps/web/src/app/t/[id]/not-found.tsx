/** Identifiant de commande inconnu ou périmé. */
export default function TrackingNotFound() {
  return (
    <main className="grid min-h-dvh place-items-center bg-bg px-6 text-center">
      <div className="max-w-[360px]">
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-mut">
          Erreur 404
        </p>
        <h1 className="mt-2 text-[24px] font-extrabold tracking-[-0.035em] text-ink">
          Commande introuvable
        </h1>
        <p className="mt-3 text-[15px] leading-relaxed text-mut">
          Ce lien de suivi n’est plus valide. Présentez votre numéro de retrait
          au comptoir, il reste la référence.
        </p>
      </div>
    </main>
  );
}
