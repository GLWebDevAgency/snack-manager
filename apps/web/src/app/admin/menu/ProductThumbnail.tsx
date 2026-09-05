import type { MediaVue } from "@sm/contracts";
import { cadrageCss, photoPointDe, photoUrlDe } from "@sm/contracts";
import { cx } from "@/lib/cx";
import { Icon } from "@/components/ui";
import type { Product } from "./types";

/**
 * LA VIGNETTE D'UNE LIGNE — et le trou, quand il n'y en a pas.
 *
 * La liste ne montrait aucune photo, alors que c'est ici que le gérant voit sa
 * carte en entier : ce qui manque doit se lire d'un coup d'œil, sans ouvrir
 * une fiche. D'où la case en pointillés plutôt qu'un vide — un trou dessiné se
 * remarque, une absence ne se remarque pas.
 *
 * `alt=""` : la vignette est DÉCORATIVE ici. Le nom du plat la suit
 * immédiatement, et un texte alternatif ferait annoncer « Kebab Fromage » deux
 * fois de suite à un lecteur d'écran. Il reprend tout son sens là où l'image
 * est seule — la caisse, la vitrine, l'aperçu de cadrage.
 */
export function ProductThumbnail({
  produit,
  catalogue,
}: {
  produit: Product;
  catalogue: ReadonlyMap<string, MediaVue>;
}) {
  // L'usage JUSTE : cette case fait 44 px de côté. Les quatre adresses sont
  // identiques aujourd'hui — le jour où un transformateur d'images se branche,
  // cette ligne demandera déjà la bonne.
  const url = photoUrlDe(produit, catalogue, "vignette");
  return (
    <div
      className={cx(
        "size-11 shrink-0 overflow-hidden rounded-ctrl border",
        url ? "border-line bg-surface2" : "border-dashed border-line bg-ink/3",
      )}
    >
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element -- l'image vient de notre API (ou du paquet web pour les photos du pilote) : next/image n'a rien à y optimiser, et le recadrage est le nôtre.
        <img
          src={url}
          alt=""
          loading="lazy"
          style={{ objectPosition: cadrageCss(photoPointDe(produit, catalogue)) }}
          className="size-full object-cover"
        />
      ) : (
        <span aria-hidden className="grid size-full place-items-center text-mut">
          <Icon name="fries" size={16} />
        </span>
      )}
    </div>
  );
}
