/**
 * Petit verrou synchrone partageable avec `useRef`.
 *
 * Un état React ne protège pas deux événements du même tour : sa mise à jour
 * n'est visible qu'au rendu suivant. Ce booléen, lui, change avant le premier
 * `await` et ferme donc immédiatement le passage à un scan concurrent.
 */
export type VerrouSynchrone = { current: boolean };

export type VerdictSuppression =
  | { ok: true }
  | { ok: false; cause: unknown };

export function scanAutorise(verrouSuppression: VerrouSynchrone): boolean {
  return !verrouSuppression.current;
}

/**
 * Garde le verrou jusqu'au verdict terminal de DELETE, succès ou échec.
 * L'appelant peut effacer son affichage local tout de suite, mais ne doit pas
 * rouvrir le scanner avant la résolution de cette promesse.
 */
export async function supprimerCarteJusquAuVerdict(
  verrou: VerrouSynchrone,
  supprimer: () => Promise<void>,
  apresVerrouillage?: () => void,
): Promise<VerdictSuppression> {
  if (verrou.current) {
    return { ok: false, cause: new Error("suppression-deja-en-cours") };
  }

  verrou.current = true;
  try {
    apresVerrouillage?.();
    await supprimer();
    return { ok: true };
  } catch (cause) {
    return { ok: false, cause };
  } finally {
    verrou.current = false;
  }
}

/** Une seule des entrées caméra, photo ou manuelle peut gagner la course. */
export function reconnaitreUneSeuleFois(
  verrouReconnaissance: VerrouSynchrone,
): boolean {
  if (verrouReconnaissance.current) return false;
  verrouReconnaissance.current = true;
  return true;
}
