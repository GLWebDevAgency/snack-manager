import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { KeyValueStore } from '@sm/client-core';
import { client } from './client';
import { DEFAULT_PREFS, PREFS_KEY, parsePrefs, type PosLayoutId, type PosPrefs, type PosTheme } from './prefs';

interface PrefsValue {
  prefs: PosPrefs;
  ready: boolean;
  setLayout: (layout: PosLayoutId) => void;
  setTheme: (theme: PosTheme) => void;
  setSplash: (splash: boolean) => void;
}

const PrefsContext = createContext<PrefsValue>({
  prefs: { ...DEFAULT_PREFS }, ready: false,
  setLayout: () => undefined, setTheme: () => undefined, setSplash: () => undefined,
});

/** La clé React réinitialise les valeurs avant le premier rendu d'un autre établissement. */
export function PrefsProvider({ scope, store = client.tenantStore, children }: {
  scope: string | null;
  store?: KeyValueStore;
  children: ReactNode;
}) {
  return <ScopedPrefs key={scope ?? 'unpaired'} scope={scope} store={store}>{children}</ScopedPrefs>;
}

function ScopedPrefs({ scope, store, children }: { scope: string | null; store: KeyValueStore; children: ReactNode }) {
  const [prefs, setPrefs] = useState<PosPrefs>(() => ({ ...DEFAULT_PREFS }));
  // Sans appairage, aucun réglage n'a encore pu être relu : ne pas jouer le
  // splash par défaut avant de découvrir qu'il est désactivé sur ce poste.
  const [ready, setReady] = useState(false);
  const current = useRef(prefs);
  const active = useRef(false);
  const writes = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    let cancelled = false;
    active.current = true;
    if (scope !== null) {
      void store.getItem(PREFS_KEY).then((raw) => {
        if (cancelled) return;
        const next = parsePrefs(raw);
        current.current = next;
        setPrefs(next);
      }).catch(() => undefined).finally(() => {
        if (!cancelled) setReady(true);
      });
    }
    return () => { cancelled = true; active.current = false; };
  }, [scope, store]);

  const change = useCallback((patch: Partial<PosPrefs>) => {
    if (!ready || scope === null || !active.current) return;
    const next = { ...current.current, ...patch };
    current.current = next;
    setPrefs(next);
    // Sérialiser évite qu'une écriture lente remplace une préférence plus récente.
    // Les écritures encore en attente sont abandonnées après le changement de poste.
    writes.current = writes.current.then(async () => {
      if (active.current) await store.setItem(PREFS_KEY, JSON.stringify(next));
    }).catch(() => undefined);
  }, [ready, scope, store]);

  const setLayout = useCallback((layout: PosLayoutId) => change({ layout }), [change]);
  const setTheme = useCallback((theme: PosTheme) => change({ theme }), [change]);
  const setSplash = useCallback((splash: boolean) => change({ splash }), [change]);
  const value = useMemo(() => ({ prefs, ready, setLayout, setTheme, setSplash }), [prefs, ready, setLayout, setTheme, setSplash]);
  return <PrefsContext.Provider value={value}>{children}</PrefsContext.Provider>;
}

export function usePrefs() { return useContext(PrefsContext); }
