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

import { useState } from "react";
import { orderingApi, type Site } from "../api";
import { Storefront } from "../Storefront";
import { demoTransport } from "./transport";

export function DemoStorefront({ site }: { site: Site }) {
  // `useState` et non `useMemo` : React peut rejouer un `useMemo` quand il le
  // décide, et le service repartirait à zéro sous les doigts du visiteur — sa
  // commande passée disparaîtrait de l'écran de suivi.
  const [api] = useState(() => orderingApi(demoTransport()));
  return <Storefront site={site} api={api} demo />;
}
