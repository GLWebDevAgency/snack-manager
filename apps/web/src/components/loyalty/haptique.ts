/**
 * LE RETOUR HAPTIQUE — celui que le tunnel de commande avait et pas la carte.
 *
 * `Checkout.tsx` fait vibrer l'appareil à la confirmation d'une commande
 * (`navigator.vibrate(60)`) : c'est le seul retour physique du produit, et il
 * manquait précisément là où le geste est le plus aveugle — on scanne un QR en
 * tenant le téléphone à bout de bras, l'écran tourné vers la caisse.
 *
 * ═══ POURQUOI CE N'EST PAS DÉSARMÉ PAR `prefers-reduced-motion` ═══
 *
 * Cette préférence répond à un trouble VESTIBULAIRE : ce qui gêne, c'est le
 * mouvement à l'écran, pas une pulsation dans la main. Couper la vibration
 * avec elle retirerait justement le canal qui reste quand on ne regarde pas —
 * et le tunnel de commande, sur la même surface et pour le même client, ne la
 * coupe pas. Deux comportements opposés pour un même produit seraient pires
 * que le choix de l'un ou de l'autre.
 *
 * L'API est absente sur iOS Safari, où l'appel n'existe simplement pas : la
 * garde ci-dessous n'est donc pas une précaution théorique, c'est le cas d'un
 * iPhone sur deux visiteurs.
 */

/** Scan reconnu : une impulsion sèche, plus courte que celle d'une commande. */
export const VIBRATION_SCAN = 24;

/**
 * Palier franchi : deux impulsions séparées d'un silence — un motif, pas une
 * durée. C'est ce qui le rend distinguable du scan sans regarder l'écran.
 */
export const VIBRATION_PALIER = [18, 70, 34];

export function vibrer(motif: number | number[]): void {
  try {
    if (typeof navigator === "undefined" || !("vibrate" in navigator)) return;
    navigator.vibrate(motif);
  } catch {
    // Certains navigateurs lèvent quand la page n'a pas encore reçu de geste
    // utilisateur. Rien à rattraper : le retour visuel porte déjà le message.
  }
}
