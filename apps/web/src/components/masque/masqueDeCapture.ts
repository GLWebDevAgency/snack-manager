import { useSyncExternalStore } from "react";
import { DIRECTIONS, type Brand, type PresetKey } from "@sm/contracts";

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

function directionDepuisUrl(): Brand | null {
  if (typeof window === "undefined") return null;
  const cle = new URLSearchParams(window.location.search).get("masque");
  // `DIRECTIONS[cle]` est un objet de MODULE — la même référence à chaque
  // appel pour une même clé : `useSyncExternalStore` ne rejoue donc jamais
  // pour rien.
  if (!cle || !(cle in DIRECTIONS)) return null;
  return DIRECTIONS[cle as PresetKey];
}

export function useMasqueDeCapture(demo: boolean): Brand | null {
  const brand = useSyncExternalStore(sansAbonnement, directionDepuisUrl, rienAuServeur);
  return demo ? brand : null;
}
