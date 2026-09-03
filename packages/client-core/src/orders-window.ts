/**
 * LA FENÊTRE DE `GET /orders`, ET SON PLAFOND.
 *
 * Le serveur plafonne la liste à 200 commandes, les 200 PLUS RÉCENTES
 * (`orders.service.ts` : `.sort({ createdAt: -1 }).limit(ORDERS_PAGE_MAX)`), et
 * il dit explicitement ce qu'il a coupé :
 *
 *     return { rows, total, truncated: total > rows.length };
 *
 * Son commentaire est sans ambiguïté : « `total` est désormais le vrai compte,
 * et `truncated` dit qu'il manque des lignes. Les deux ensemble permettent à
 * l'écran de refuser de conclure, plutôt que de conclure faux. »
 *
 * La caisse typait la réponse `{ rows }` et jetait les deux autres champs. Au
 * delà de 200 commandes dans la journée, le Z de clôture — chiffre d'affaires,
 * espèces, carte, titres-restaurant — était calculé sur une fenêtre AMPUTÉE de
 * ses lignes les plus anciennes, sans qu'aucun écran ne le signale. Le gérant
 * recomptait son tiroir contre un total faux. C'est un défaut d'argent, pas un
 * défaut d'affichage.
 *
 * Ce module est le pendant terrain de `apps/web/src/app/admin/orders/
 * list-response.ts`, qui traite déjà le cas côté back-office. Il vit dans le
 * noyau parce que les deux surfaces terrain lisent la même route.
 */

/** Même plafond que `GET /orders` ; aucune fenêtre locale ne le dépasse. */
export const ORDERS_WINDOW_MAX = 200;

/** Réponse brute de `GET /orders`, telle qu'elle arrive sur le fil. */
export interface OrdersWindowResponse<T> {
  rows?: T[];
  total?: number;
  truncated?: boolean;
}

export interface OrdersWindow<T> {
  rows: T[];
  /** Nombre EXACT de commandes correspondant à la requête, côté serveur. */
  total: number;
  /** `true` quand `rows` n'est qu'une fenêtre : il manque les plus anciennes. */
  truncated: boolean;
}

/**
 * Normalise la réponse, y compris l'ancien TABLEAU NU.
 *
 * Le tableau nu n'est pas une hypothèse d'école : pendant un déploiement
 * roulant, l'API et la surface peuvent servir deux versions voisines pendant
 * quelques secondes. Un écran qui planterait là-dessus tomberait exactement au
 * moment d'une livraison.
 */
export function normalizeOrdersWindow<T>(
  response: OrdersWindowResponse<T> | T[] | null | undefined,
): OrdersWindow<T> {
  if (Array.isArray(response)) {
    return { rows: response, total: response.length, truncated: false };
  }
  const rows = Array.isArray(response?.rows) ? response.rows : [];
  const annonce = response?.total;
  // Un `total` inférieur au nombre de lignes reçues est incohérent : on garde
  // alors ce qu'on tient réellement plutôt qu'un chiffre qui ferait croire à
  // moins de commandes qu'il n'y en a sous les yeux.
  const total =
    typeof annonce === 'number' && Number.isSafeInteger(annonce) && annonce >= rows.length
      ? annonce
      : rows.length;
  return {
    rows,
    total,
    // Le total suffit à détecter la coupe, même face à une API intermédiaire
    // qui ne servirait pas encore le booléen.
    truncated: response?.truncated === true || total > rows.length,
  };
}

/**
 * Un compteur calculé sur une fenêtre tronquée est un MINIMUM, jamais un total.
 *
 * « 200 » et « ≥ 200 » ne se lisent pas pareil au comptoir, et c'est toute la
 * différence entre un chiffre et une estimation présentée comme un chiffre.
 */
export function windowCountLabel(count: number, truncated: boolean): string {
  return truncated ? `≥ ${count}` : String(count);
}
