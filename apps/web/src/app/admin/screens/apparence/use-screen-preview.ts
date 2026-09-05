"use client";

import { useEffect, useRef, useState } from "react";
import type { Scenography, ScreenContent, ScreenOrientation, ScreenTheme } from "@sm/contracts";
import { api, ApiError } from "@/lib/api";

export interface Brouillon {
  screenId: string | null;
  orientation: ScreenOrientation;
  theme: ScreenTheme;
  scenography: Scenography;
}

/** Une clé stable : l'ordre des champs ne compte pas, chaque réglage compte. */
export const cleDuBrouillon = (b: Brouillon): string =>
  [b.screenId ?? "", b.orientation, b.theme, b.scenography].join("|");

/** Le gérant clique trois fois en une seconde : un seul aperçu part. */
const TEMPORISATION_MS = 250;
/** Même cadence que la liste des écrans : un prix changé apparaît sans clic. */
const RAFRAICHISSEMENT_MS = 30_000;

/**
 * L'APERÇU VIVANT — le même contrat de fraîcheur que le téléviseur.
 *
 * Le contenu n'est remplacé que si son empreinte a bougé, ou si le brouillon
 * a changé : un aperçu repeint toutes les trente secondes casserait la scène
 * en cours sous les yeux du gérant, exactement ce qu'on évite en salle.
 */
export function useScreenPreview(brouillon: Brouillon): {
  content: ScreenContent | null;
  error: string | null;
  loading: boolean;
} {
  const cle = cleDuBrouillon(brouillon);
  const [content, setContent] = useState<ScreenContent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const hashRef = useRef<string | null>(null);
  const cleRef = useRef<string>("");

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const [screenId, orientation, theme, scenography] = cle.split("|");
    const corps = {
      screenId: screenId || null,
      orientation,
      theme,
      scenography,
    };

    const charger = async () => {
      try {
        const next = await api.post<ScreenContent>("/screens/preview", corps);
        if (!alive) return;
        const nouveauBrouillon = cleRef.current !== cle;
        if (nouveauBrouillon || next.contentHash !== hashRef.current) {
          hashRef.current = next.contentHash;
          cleRef.current = cle;
          setContent(next);
        }
        setError(null);
      } catch (e) {
        if (!alive) return;
        setError(
          e instanceof ApiError || e instanceof Error ? e.message : "Aperçu indisponible",
        );
      } finally {
        if (alive) setLoading(false);
      }
    };

    // eslint-disable-next-line react-hooks/set-state-in-effect -- le chargement est asynchrone et suit le brouillon : c'est l'effet qui sait quand repartir, et « en cours » doit se voir dès que le brouillon change.
    setLoading(true);
    const premier = setTimeout(() => void charger(), TEMPORISATION_MS);
    const boucle = () => {
      // Une requête encore en vol quand le brouillon change ou que le tiroir
      // se ferme ne doit pas réarmer une boucle que personne n'effacera.
      if (!alive) return;
      timer = setTimeout(() => {
        void charger().finally(boucle);
      }, RAFRAICHISSEMENT_MS);
    };
    boucle();
    const auRetour = () => void charger();
    window.addEventListener("focus", auRetour);

    return () => {
      alive = false;
      clearTimeout(premier);
      if (timer) clearTimeout(timer);
      window.removeEventListener("focus", auRetour);
    };
  }, [cle]);

  return { content, error, loading };
}
