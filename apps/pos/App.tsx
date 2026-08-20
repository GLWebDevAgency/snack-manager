/**
 * Racine de la caisse.
 *
 * Trois états, et un seul en régime permanent :
 *
 *   NON APPAIRÉE — une tablette neuve, qui ne sait pas encore chez qui elle
 *                  travaille. Six caractères, une fois dans sa vie ;
 *   VERROUILLÉE  — appairée, en attente du code équipier ;
 *   EN SERVICE   — l'écran de vente.
 *
 * Pas de navigation par routes : le poste est mono-écran avec des surcouches
 * modales, conformément à la spécification `docs/specs/pos.md`.
 *
 * L'appairage et la session sont DEUX choses distinctes, et c'est essentiel :
 * l'équipier se déconnecte tous les soirs, la tablette reste appairée pour la
 * vie du restaurant.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { activateKeepAwakeAsync } from 'expo-keep-awake';
import { DEVICE_HEARTBEAT_INTERVAL_MS } from '@sm/contracts';
import { getStore, palette } from '@sm/client-core';
import {
  DeviceError,
  KEYS,
  client,
  deviceHeartbeat,
  forgetPairedDevice,
  loadPairedDevice,
  type PairedDevice,
  type Session,
} from './src/client';
import { DemoBanner } from './src/DemoBanner';
import { PairingScreen, PinScreen } from './src/PinScreen';
import { PosScreen } from './src/PosScreen';
import { Loading } from './src/ui';

/** Le jeton staff vit 12 h ; au-delà, on redemande le PIN sans rien perdre. */
const SESSION_TTL = 11 * 60 * 60 * 1000;

export default function App() {
  const [device, setDevice] = useState<PairedDevice | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [restored, setRestored] = useState(false);
  const [lockNotice, setLockNotice] = useState<string | null>(null);

  /**
   * Restauration au démarrage : d'ABORD l'appairage, ensuite la session.
   *
   * L'ordre compte. Sans appairage, une session enregistrée ne veut plus rien
   * dire — son jeton a été émis pour un établissement que ce poste ne sert
   * plus. On la laisse alors tomber plutôt que d'ouvrir une caisse orpheline.
   */
  useEffect(() => {
    let alive = true;
    void (async () => {
      const paired = await loadPairedDevice();
      if (!alive) return;
      setDevice(paired);

      if (paired) {
        try {
          const raw = await getStore().getItem(KEYS.session);
          const saved = raw ? (JSON.parse(raw) as Session) : null;
          if (alive && saved?.token && Date.now() - saved.at < SESSION_TTL) {
            client.setToken(saved.token);
            setSession(saved);
          }
        } catch {
          /* session illisible : on repart sur l'écran de code équipier */
        }
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
    setSession(next);
    void getStore().setItem(KEYS.session, JSON.stringify(next));
  }, []);

  const onLock = useCallback((reason?: string) => {
    client.setToken(null);
    setLockNotice(reason ?? null);
    setSession(null);
    void getStore().removeItem(KEYS.session);
  }, []);

  /** Désappairage confirmé depuis l'écran de code équipier. */
  const onUnpair = useCallback(() => {
    setSession(null);
    setLockNotice(null);
    setDevice(null);
  }, []);

  /**
   * Battement de cœur de l'appareil.
   *
   * Il rend deux services : le back-office voit « caisse en ligne » — le seul
   * incident possible sur ce poste est qu'il se taise —, et la marque revient
   * à jour, si bien qu'un changement de nom ou de couleur se propage sans
   * réappairage. Une révocation depuis le back-office (tablette perdue) ramène
   * le poste à l'écran d'appairage, immédiatement.
   */
  const deviceRef = useRef(device);
  deviceRef.current = device;

  useEffect(() => {
    if (!device) return;
    let alive = true;

    const beat = () => {
      void deviceHeartbeat()
        .then((fresh) => {
          // Le client ne rend un objet NEUF que si la marque a réellement
          // bougé. Comparer les identités suffit donc à ne repeindre que dans
          // ce cas — un rendu par minute pour rien, c'est une animation cassée
          // toutes les minutes.
          if (alive && fresh && fresh !== deviceRef.current) setDevice(fresh);
        })
        .catch((e: unknown) => {
          if (!alive || !(e instanceof DeviceError) || e.status !== 401) return;
          // Le jeton a été révoqué depuis le back-office : garder l'appairage
          // ne ferait qu'échouer à chaque saisie. Retour à l'écran d'appairage.
          setSession(null);
          setDevice(null);
          void forgetPairedDevice();
        });
    };

    beat();
    const id = setInterval(beat, DEVICE_HEARTBEAT_INTERVAL_MS);
    // Une tablette mise en veille toute la nuit doit se manifester dès qu'on la
    // rallume, sans attendre le prochain tour d'horloge.
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') beat();
    });
    return () => {
      alive = false;
      clearInterval(id);
      sub.remove();
    };
  }, [device]);

  return (
    <View style={{ flex: 1, backgroundColor: palette.bg }}>
      <StatusBar style="light" hidden />
      {/*
        Le retour à la vitrine, en démonstration UNIQUEMENT.

        Il est posé ici, au-dessus des trois écrans, pour deux raisons. D'abord
        il ne dépend d'aucun d'eux : le visiteur doit pouvoir repartir depuis
        l'écran de vente comme depuis un chargement. Ensuite les surcouches de
        la caisse (tiroir du ticket, modales d'encaissement) se positionnent en
        absolu DANS `PosScreen` — elles ne peuvent donc pas venir couvrir la
        barre, et le retour reste atteignable même une modale ouverte.
      */}
      <DemoBanner />
      {!restored ? (
        <Loading label="Ouverture du poste…" />
      ) : !device ? (
        <PairingScreen onPaired={setDevice} />
      ) : session ? (
        <PosScreen session={session} onLock={onLock} />
      ) : (
        <PinScreen
          onSession={onSession}
          device={device}
          onUnpair={onUnpair}
          notice={lockNotice}
        />
      )}
    </View>
  );
}
