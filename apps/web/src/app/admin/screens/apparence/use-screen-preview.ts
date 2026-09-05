"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { screenPresentationOf, type Brand, type Scenography, type ScreenContent, type ScreenOrientation, type ScreenPresentation, type ScreenPreview, type ScreenPreviewService, type ScreenTheme } from "@sm/contracts";
import { api } from "@/lib/api";
import { createPreviewSession } from "./preview-session";

export interface Brouillon {
  screenId: string | null;
  orientation: ScreenOrientation;
  theme: ScreenTheme;
  scenography: Scenography;
  service?: ScreenPreviewService;
  presentation?: ScreenPresentation;
  brandDraft?: Brand;
}

/** L'identité peut venir de plusieurs éditeurs : l'ordre des objets ne doit pas relancer le réseau. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(
    Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]),
  );
  return value;
}

/** Une clé stable : l'ordre des champs ne compte pas, chaque réglage compte. */
export const cleDuBrouillon = (b: Brouillon): string =>
  JSON.stringify(canonical({ ...b, presentation: screenPresentationOf(b.presentation) }));

interface PreviewState {
  content: ScreenContent | null;
  contentKey: string | null;
  requestKey: string;
  error: string | null;
  loading: boolean;
}

/** Conserve le dernier rendu reçu, tout en indiquant s'il décrit encore le brouillon. */
export function useScreenPreview(brouillon: Brouillon): {
  content: ScreenContent | null;
  error: string | null;
  loading: boolean;
  stale: boolean;
  retry: () => void;
} {
  const cle = cleDuBrouillon(brouillon);
  const [state, setState] = useState<PreviewState>(() => ({
    content: null,
    contentKey: null,
    requestKey: cle,
    error: null,
    loading: true,
  }));
  const sessionRef = useRef<ReturnType<typeof createPreviewSession<ScreenContent>> | null>(null);

  useEffect(() => {
    const request = JSON.parse(cle) as ScreenPreview;
    const session = createPreviewSession({
      request: (signal) =>
        api.post<ScreenContent>("/screens/preview", request, { signal }),
      onStart: () => setState((previous) => ({
        ...previous,
        requestKey: cle,
        loading: true,
        error: previous.requestKey === cle ? previous.error : null,
      })),
      onContent: (next) => setState((previous) => ({
        content: previous.contentKey === cle && previous.content?.contentHash === next.contentHash
          ? previous.content
          : next,
        contentKey: cle,
        requestKey: cle,
        loading: false,
        error: null,
      })),
      onError: (error) => setState((previous) => ({
        ...previous,
        requestKey: cle,
        loading: false,
        error: error instanceof Error ? error.message : "Aperçu indisponible",
      })),
    });
    sessionRef.current = session;
    window.addEventListener("focus", session.refresh);
    return () => {
      session.stop();
      if (sessionRef.current === session) sessionRef.current = null;
      window.removeEventListener("focus", session.refresh);
    };
  }, [cle]);

  const retry = useCallback(() => sessionRef.current?.refresh(), []);
  const changed = state.requestKey !== cle;
  const error = changed ? null : state.error;
  return {
    content: state.content,
    error,
    loading: changed || state.loading,
    stale: state.content !== null && (state.contentKey !== cle || error !== null),
    retry,
  };
}
