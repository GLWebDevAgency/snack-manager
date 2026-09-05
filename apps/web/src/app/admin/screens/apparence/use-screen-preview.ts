"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Scenography, ScreenContent, ScreenOrientation, ScreenTheme } from "@sm/contracts";
import { api } from "@/lib/api";
import { createPreviewSession } from "./preview-session";

export interface Brouillon {
  screenId: string | null;
  orientation: ScreenOrientation;
  theme: ScreenTheme;
  scenography: Scenography;
}

/** Une clé stable : l'ordre des champs ne compte pas, chaque réglage compte. */
export const cleDuBrouillon = (b: Brouillon): string =>
  JSON.stringify([b.screenId, b.orientation, b.theme, b.scenography]);

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
    const [screenId, orientation, theme, scenography] = JSON.parse(cle) as [
      string | null, ScreenOrientation, ScreenTheme, Scenography,
    ];
    const session = createPreviewSession({
      request: (signal) =>
        api.post<ScreenContent>("/screens/preview", { screenId, orientation, theme, scenography }, { signal }),
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
