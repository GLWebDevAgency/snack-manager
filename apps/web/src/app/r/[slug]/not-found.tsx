/**
 * Slug inconnu — page franche, pas un écran d’erreur technique.
 *
 * ═══ IL N’Y A PLUS DE BOUTON « RETOUR À L’ACCUEIL », ET C’EST DÉLIBÉRÉ ═══
 *
 * Il pointait vers `/`, ce qui était faux des deux côtés de la frontière.
 *
 * Sur `snackmanager.fr`, `/` est notre VITRINE COMMERCIALE : quelqu’un qui
 * cherchait la carte d’un restaurant se retrouvait sur la page de vente de son
 * fournisseur de logiciel.
 *
 * Sur le domaine d’un restaurant, c’était pire — une BOUCLE. `/` y est réécrit
 * vers `/r/<slug>` ; si le tenant a disparu, cette page revient, son bouton
 * renvoie sur `/`, qui réécrit à nouveau. Le visiteur tourne entre deux 404
 * sans jamais rien lire d’utile.
 *
 * Il n’existe aucune destination juste ici : le restaurant cherché n’existe
 * pas, et le nôtre n’est pas ce qu’on venait voir. Une page qui le dit
 * clairement vaut mieux qu’une porte qui ne mène nulle part.
 */
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
        <p className="mt-6 text-[13.5px] leading-relaxed text-mut">
          Vérifiez l’adresse auprès du restaurant — elle figure en général sur
          sa vitrine, son ticket ou sa page de réseau social.
        </p>
      </div>
    </main>
  );
}
