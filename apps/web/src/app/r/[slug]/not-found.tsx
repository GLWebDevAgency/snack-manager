import { marqueDeRepli } from "@sm/contracts";
import { FeuilleDuMasque } from "@/components/masque/FeuilleDuMasque";
import { classesPolices } from "@/components/masque/polices";
import { styleDuMasque } from "@/components/masque/styleDuMasque";
import { cx } from "@/lib/cx";

/**
 * ═══ LE REPLI NUIT DES SURFACES SANS RESTAURANT — la référence ═══
 *
 * Les 404, les écrans d'erreur et le lien de suivi incomplet des quatre
 * surfaces client sont les SEULES pages du domaine à ne porter aucun masque
 * de restaurant : quand elles s'affichent, il n'y a par définition rien à
 * charger — slug inconnu, service injoignable, jeton perdu en route.
 *
 * Elles rendaient alors les `--cf-*` déclarés dans `globals.css`, c'est-à-dire
 * le noir et le laiton de SNACK MANAGER : un client de la Brasserie tombait
 * sur une page noire au bouton doré, la marque de son FOURNISSEUR de logiciel.
 * Le repli Nuit (`marqueDeRepli`, spec §8) est la seule direction qui ne
 * suppose aucune donnée : elle tient la promesse « aucune surface ne casse »
 * sans usurper l'identité de personne.
 *
 * Deux détails valent d'être dits, parce qu'ils se paient cher s'ils manquent :
 *  · `classesPolices` accompagne toujours `styleDuMasque` — sans les dix-huit
 *    variables `--police-<slug>`, la paire typographique retombe sur Inter ;
 *  · `FeuilleDuMasque` hisse le fond jusqu'à `html`/`body` : sans elle, le
 *    rebond élastique d'iOS découvre le canevas par défaut derrière la page.
 *
 * Les constantes sont calculées AU MODULE : `resoudreMarque()` est une
 * trentaine de mélanges, et cette peau-là ne dépend d'aucune donnée.
 */
const REPLI = marqueDeRepli(null, null);
const MASQUE_DE_REPLI = styleDuMasque(REPLI);

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
    <main
      style={MASQUE_DE_REPLI}
      className={cx(
        classesPolices,
        "font-body grid min-h-dvh place-items-center bg-bg px-6 text-center text-ink",
      )}
    >
      {/* Le masque remonte au document : canevas, rebond iOS, ascenseur
          et contrôles natifs — voir `FeuilleDuMasque`. */}
      <FeuilleDuMasque brand={REPLI} />
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
