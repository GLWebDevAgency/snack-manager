"use client";

/**
 * La vitrine et son tunnel, branchés sur la démonstration.
 *
 * Ce composant n'existe que pour une raison : le transport de démonstration
 * est une FONCTION avec un état en mémoire, et une fonction ne traverse pas la
 * frontière serveur → client. Il faut donc la construire ici, dans le
 * navigateur, et la remettre au `Storefront` — qui, lui, ne connaît que le
 * port et ignore tout de la fixture.
 *
 * Conséquence utile : `Storefront` n'importe RIEN de ce dossier. La carte
 * fictive, ses 109 produits et cette bascule ne descendent que dans le paquet
 * de la route `/r/demo`. Une page de vrai restaurant ne les embarque même pas.
 *
 * L'état vit le temps d'un chargement de page. Le visiteur peut tout casser :
 * commander douze tacos, saturer un créneau, recommencer — un rafraîchissement
 * remet le service à neuf, parce qu'il n'y a rien à remettre à neuf.
 */

import { useState, useSyncExternalStore } from "react";
import { BandeauDemo } from "@/lib/demo/BandeauDemo";
import { orderingApi, type Site } from "../api";
import { Storefront } from "../Storefront";
import { isDemoStorefront } from "./mode";
import { demoTransport } from "./transport";

/** Aucun abonnement : l'adresse d'entrée ne change pas en cours de page. */
const sansAbonnement = () => () => {};
const adresseCourante = () =>
  isDemoStorefront(
    typeof window === "undefined" ? null : window.location.href,
  );
const rienAuServeur = () => false;

export function DemoStorefront({ site }: { site: Site }) {
  // `useState` et non `useMemo` : React peut rejouer un `useMemo` quand il le
  // décide, et le service repartirait à zéro sous les doigts du visiteur — sa
  // commande passée disparaîtrait de l'écran de suivi.
  const [api] = useState(() => orderingApi(demoTransport()));

  /**
   * Le bandeau de retour se dessine sur la foi de l'ADRESSE, relue dans le
   * navigateur, et pas seulement sur le fait d'avoir été monté ici. La route
   * répond déjà 404 sans `?demo=1` ; cette seconde vérification garantit
   * qu'aucun lien vers notre site commercial ne peut apparaître sur la page
   * d'un vrai restaurant, servie sur son propre domaine.
   */
  const demo = useSyncExternalStore(sansAbonnement, adresseCourante, rienAuServeur);

  return (
    <>
      <BandeauDemo actif={demo} />
      <Storefront site={site} api={api} demo />
    </>
  );
}
