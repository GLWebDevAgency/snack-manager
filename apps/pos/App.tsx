/**
 * Racine de la caisse.
 *
 * Deux états seulement : verrouillée (saisie du PIN) ou en service. Pas de
 * navigation par routes — le poste est mono-écran avec des surcouches modales,
 * conformément à la spécification `docs/specs/pos.md`.
 */
import { useCallback, useEffect, useState } from 'react';
import { Platform, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { activateKeepAwakeAsync } from 'expo-keep-awake';
import { getStore, palette } from '@sm/client-core';
import { KEYS, client, type Session } from './src/client';
import { PinScreen } from './src/PinScreen';
import { PosScreen } from './src/PosScreen';
import { Loading } from './src/ui';

/** Le jeton staff vit 12 h ; au-delà, on redemande le PIN sans rien perdre. */
const SESSION_TTL = 11 * 60 * 60 * 1000;

interface BrandHint {
  name: string;
  color: string;
}

const FALLBACK_BRAND: BrandHint = { name: "Class'Food", color: palette.gold };

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [brandHint, setBrandHint] = useState<BrandHint>(FALLBACK_BRAND);
  const [restored, setRestored] = useState(false);
  const [lockNotice, setLockNotice] = useState<string | null>(null);

  // Restauration de la session : le poste doit repartir sans ressaisie après un
  // simple rechargement. Même expirée, elle sert à afficher la bonne identité
  // sur l'écran de PIN plutôt qu'une marque générique.
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const raw = await getStore().getItem(KEYS.session);
        const saved = raw ? (JSON.parse(raw) as Session) : null;
        if (alive && saved?.token) {
          setBrandHint({ name: saved.tenantName, color: saved.brandColor });
          if (Date.now() - saved.at < SESSION_TTL) {
            client.setToken(saved.token);
            setSession(saved);
          }
        }
      } catch {
        /* session illisible : on repart sur l'écran de PIN */
      }
      if (alive) setRestored(true);
    })();
    return () => {
      alive = false;
    };
  }, []);

  // L'écran d'un poste de caisse ne doit jamais s'éteindre pendant le service.
  useEffect(() => {
    if (Platform.OS !== 'web') void activateKeepAwakeAsync().catch(() => undefined);
  }, []);

  const onSession = useCallback((next: Session) => {
    setLockNotice(null);
    setBrandHint({ name: next.tenantName, color: next.brandColor });
    setSession(next);
    void getStore().setItem(KEYS.session, JSON.stringify(next));
  }, []);

  const onLock = useCallback((reason?: string) => {
    client.setToken(null);
    setLockNotice(reason ?? null);
    setSession(null);
    void getStore().removeItem(KEYS.session);
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: palette.bg }}>
      <StatusBar style="light" hidden />
      {!restored ? (
        <Loading label="Ouverture du poste…" />
      ) : session ? (
        <PosScreen session={session} onLock={onLock} />
      ) : (
        <PinScreen
          onSession={onSession}
          tenantName={brandHint.name}
          brandColor={brandHint.color}
          notice={lockNotice}
        />
      )}
    </View>
  );
}
