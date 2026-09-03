import { useSyncExternalStore } from "react";
import { DIRECTIONS, PresetKeySchema, type Brand } from "@sm/contracts";

/**
 * Direction demandée par l'URL — LEVIER RÉSERVÉ À LA MATRICE DE CAPTURES.
 *
 * `scripts/capture-masque.mjs` doit prouver les six directions sur la
 * démonstration SANS créer six tenants. Sur la vitrine (`Storefront`), le
 * transport est en mémoire : intercepter `**\/public/tenants/demo/site` ne
 * sert à rien, aucune réponse réseau n'existe à intercepter. Sur la carte de
 * fidélité de démonstration (`DemoLoyaltyCard`), il n'y a même pas de marque
 * à lire : c'est un aperçu générique, jamais relié à un programme réel. Le
 * paramètre `?masque=<direction>` remplace donc la marque affichée par une
 * des six directions du catalogue, dans les deux cas.
 *
 * ─── `useSyncExternalStore`, PAS UN INITIALISEUR D'ÉTAT NI UN EFFET ───
 *
 * Deux pièges vérifiés avant ce choix :
 *
 *  1. Un initialiseur d'état (`useState(() => …)`) NE SUFFIT PAS : le premier
 *     rendu client, PENDANT l'hydratation, produirait un `style` différent de
 *     celui du serveur (qui ignore toujours l'URL) — et React n'y touche
 *     plus. L'attribut reste bloqué sur la valeur serveur (« This won't be
 *     patched up » ; mesuré sur les six directions : cinq restaient
 *     bloquées sur l'accent par défaut).
 *  2. Un `useEffect` qui pose l'état APRÈS l'hydratation évite bien le
 *     désaccord, mais `react-hooks/set-state-in-effect` le refuse à raison :
 *     un rendu supplémentaire déclenché depuis un effet est le signe qu'un
 *     store externe (ici, `window.location`) devrait être lu par
 *     `useSyncExternalStore` — le patron déjà en place dans ce dossier pour
 *     le même genre de lecture (`demo/DemoStorefront.tsx`, `adresseCourante`).
 *
 * `useSyncExternalStore` résout les deux : `rienAuServeur` rend le rendu
 * serveur ET la PREMIÈRE passe client identiques (aucune hydratation en
 * désaccord), puis React relit `directionDepuisUrl` tout seul, par un rendu
 * normal — sans passer par un `useEffect` qui `setState`.
 *
 * Lu UNIQUEMENT côté client (`window` n'existe pas au rendu serveur) et
 * UNIQUEMENT quand l'appelant confirme être en démonstration (`demo`) : la
 * page d'un vrai restaurant ne se rethème jamais par son URL.
 */
const sansAbonnement = () => () => {};
const rienAuServeur = (): Brand | null => null;

/**
 * Le lecteur de store, exporté pour `masqueDeCapture.test.ts` : la garde qui
 * décide de rethémer une page entière se prouve sans monter React.
 */
export function directionDepuisUrl(): Brand | null {
  if (typeof window === "undefined") return null;
  const cle = new URLSearchParams(window.location.search).get("masque");
  /*
   * `cle in DIRECTIONS` ACCEPTAIT LA CHAÎNE DE PROTOTYPE.
   *
   * `"constructor" in {}` vaut `true` : `?masque=constructor` passait la
   * garde, `DIRECTIONS["constructor"]` rendait la fonction `Object` — une
   * référence stable, donc `useSyncExternalStore` la retenait sans broncher —
   * et `styleDuMasque()` levait un `TypeError` sur `brand.palette.ground`. La
   * page de démonstration tombait dans son error boundary depuis une simple
   * URL. `toString`, `valueOf`, `hasOwnProperty` faisaient de même.
   *
   * L'énumération du contrat est la garde qui manquait : elle ne connaît que
   * les six directions, et elle est la MÊME source que celle qui les définit.
   */
  const lu = PresetKeySchema.safeParse(cle);
  // `DIRECTIONS[cle]` est un objet de MODULE — la même référence à chaque
  // appel pour une même clé : `useSyncExternalStore` ne rejoue donc jamais
  // pour rien.
  return lu.success ? DIRECTIONS[lu.data] : null;
}

export function useMasqueDeCapture(demo: boolean): Brand | null {
  const brand = useSyncExternalStore(sansAbonnement, directionDepuisUrl, rienAuServeur);
  return demo ? brand : null;
}
