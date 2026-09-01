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
import { AppState, Platform, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { activateKeepAwakeAsync } from 'expo-keep-awake';
import { DEVICE_HEARTBEAT_INTERVAL_MS } from '@sm/contracts';
import { palette, useSyncState } from '@sm/client-core';
import {
  DeviceError,
  KEYS,
  client,
  deviceHeartbeat,
  forgetPairedDevice,
  installErrorReporting,
  loadPairedDevice,
  type PairedDevice,
  type Session,
} from './src/client';
import { DemoBanner } from './src/DemoBanner';
import { PairingScreen, PinScreen } from './src/PinScreen';
import { PosScreen } from './src/PosScreen';
import { createSaleInFlightGate } from './src/pos-safety';
import { Loading, Press } from './src/ui';

/** Le jeton staff vit 12 h ; au-delà, on redemande le PIN sans rien perdre. */
const SESSION_TTL = 11 * 60 * 60 * 1000;

export default function App() {
  const [device, setDevice] = useState<PairedDevice | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [restored, setRestored] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [restoreAttempt, setRestoreAttempt] = useState(0);
  const sync = useSyncState(client);
  const [lockNotice, setLockNotice] = useState<string | null>(null);
  /**
   * Barrière partagée avec l'écran de vente : un lock ne doit jamais
   * démonter le composant pendant son commit local asynchrone.
   */
  const saleInFlight = useRef(createSaleInFlightGate()).current;
  const [, refreshAfterSale] = useState(0);
  const appAlive = useRef(true);

  useEffect(() => {
    appAlive.current = true;
    return () => {
      appAlive.current = false;
    };
  }, []);

  // Le rapporteur d'erreurs, pour toute la vie du poste — voir `client.ts`.
  useEffect(() => installErrorReporting(), []);

  /**
   * Restauration au démarrage : d'ABORD l'appairage, ensuite la session.
   *
   * L'ordre compte. Sans appairage, une session enregistrée ne veut plus rien
   * dire — son jeton a été émis pour un établissement que ce poste ne sert
   * plus. On la laisse alors tomber plutôt que d'ouvrir une caisse orpheline.
   */
  useEffect(() => {
    let alive = true;
    setRestored(false);
    setRestoreError(null);
    void (async () => {
      try {
        const paired = await loadPairedDevice();
        if (!alive) return;
        setDevice(paired);

        if (paired) {
          try {
            const raw = await client.tenantStore.getItem(KEYS.session);
            const saved = raw ? (JSON.parse(raw) as Session) : null;
            if (
              alive &&
              saved?.token &&
              saved.tenantSlug === paired.tenant.slug &&
              Date.now() - saved.at < SESSION_TTL
            ) {
              client.setToken(saved.token);
              setSession(saved);
            } else if (raw) {
              await client.tenantStore.removeItem(KEYS.session);
            }
          } catch (error) {
            if (error instanceof SyntaxError) {
              await client.tenantStore.removeItem(KEYS.session);
            } else {
              throw error;
            }
          }
        }
      } catch (error) {
        if (alive) {
          setRestoreError(
            error instanceof Error
              ? error.message
              : 'Le stockage sécurisé du poste est indisponible.',
          );
        }
      } finally {
        if (alive) setRestored(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [restoreAttempt]);

  // L'écran d'un poste de caisse ne doit jamais s'éteindre pendant le service.
  useEffect(() => {
    if (Platform.OS !== 'web') void activateKeepAwakeAsync().catch(() => undefined);
  }, []);

  const onSession = useCallback((next: Session) => {
    setLockNotice(null);
    setSession(next);
    void client.tenantStore.setItem(KEYS.session, JSON.stringify(next)).catch(() => undefined);
  }, []);

  const onLock = useCallback((reason?: string) => {
    saleInFlight.deferUntilIdle(() => {
      client.setToken(null);
      setLockNotice(reason ?? null);
      setSession(null);
      void client.tenantStore.removeItem(KEYS.session).catch(() => undefined);
    });
  }, [saleInFlight]);

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
   * le poste à l'écran d'appairage dès que l'éventuel commit de vente en
   * cours est durable.
   */
  const deviceRef = useRef(device);
  deviceRef.current = device;

  const revokeDevice = useCallback(() => {
    saleInFlight.deferUntilIdle(() => {
      // On masque immédiatement la caisse pour qu'aucune nouvelle vente ne
      // démarre, mais on conserve le jeton le temps de prouver les mutations
      // déjà durables côté serveur. `forgetPairedDevice` refusera ensuite la
      // purge de façon atomique s'il reste une entrée ou un rejet.
      setRestoreError('Révocation détectée — sécurisation des ventes en cours.');
      void client.queue
        .flush()
        .catch(() => undefined)
        .then(() => forgetPairedDevice())
        .then(() => {
          if (!appAlive.current) return;
          setSession(null);
          setDevice(null);
          setRestoreError(null);
        })
        .catch((error: unknown) => {
          if (!appAlive.current) return;
          setRestoreError(
            error instanceof Error
              ? `Désappairage bloqué sans effacer les ventes : ${error.message}. Rétablissez le réseau ou traitez les rejets, puis réessayez.`
              : 'Le désappairage sécurisé doit être relancé.',
          );
        });
    });
  }, [saleInFlight]);

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
          // ne ferait qu'échouer à chaque saisie. L'écran reste BLOQUÉ jusqu'à
          // ce que clear + purge soient réellement terminés : présenter le
          // formulaire B avant cela créerait une course entre pair et purge.
          revokeDevice();
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
  }, [device, revokeDevice]);

  /**
   * `scopeValid` et `suspended` verrouillent normalement par le rendu, sans
   * callback. Si l'un bascule pendant une vente, on garde l'écran monté puis
   * on force le rendu de verrouillage exactement après `finish()`.
   */
  const mustLeaveSaleScreen =
    !restored || restoreError !== null || !sync.scopeValid || !device || device.suspended === true;
  useEffect(() => {
    if (!session || !mustLeaveSaleScreen) return;
    saleInFlight.deferUntilIdle(() => refreshAfterSale((revision) => revision + 1));
  }, [mustLeaveSaleScreen, saleInFlight, session]);

  const protectActiveSale = session !== null && saleInFlight.active;
  const posScreen = session ? (
    <PosScreen session={session} onLock={onLock} saleInFlight={saleInFlight} />
  ) : null;

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
      {protectActiveSale ? (
        posScreen
      ) : !restored ? (
        <Loading label="Ouverture du poste…" />
      ) : restoreError ? (
        <RestoreError
          message={restoreError}
          onRetry={() => setRestoreAttempt((attempt) => attempt + 1)}
        />
      ) : !sync.scopeValid ? (
        <RestoreError
          message="L’appairage a changé dans une autre fenêtre. Les données de cette fenêtre ont été verrouillées."
          onRetry={() => globalThis.location?.reload()}
        />
      ) : !device ? (
        <PairingScreen onPaired={setDevice} />
      ) : device.suspended ? (
        // Abonnement suspendu : l'écran se verrouille AVANT qu'une vente
        // n'échoue devant un client (contrat `DeviceHeartbeatResult`). La
        // tablette reste appairée et continue de battre — le support la voit
        // vivante ; la réactivation la rouvre au battement suivant, seule.
        <SuspendedScreen name={device.tenant.name} />
      ) : session ? (
        posScreen
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

function RestoreError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 32 }}>
      <Text style={{ color: palette.text, fontSize: 22, fontWeight: '800', textAlign: 'center' }}>
        Poste momentanément verrouillé
      </Text>
      <Text style={{ color: palette.mut, fontSize: 15, textAlign: 'center', maxWidth: 460 }}>
        {message} Aucune donnée d’un autre établissement ne sera ouverte tant que la restauration
        n’est pas terminée.
      </Text>
      <Press
        onPress={onRetry}
        accessibilityRole="button"
        accessibilityLabel="Réessayer la restauration du poste"
        style={{
          minHeight: 48,
          paddingHorizontal: 24,
          borderRadius: 14,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: palette.gold,
        }}
      >
        <Text style={{ color: palette.bg, fontSize: 15, fontWeight: '800' }}>Réessayer</Text>
      </Press>
    </View>
  );
}

/**
 * L'écran d'un poste dont l'abonnement est suspendu.
 *
 * Le mot d'ordre : neutre et actionnable. Pas de rouge criard devant les
 * clients de la salle, pas de jargon — qui appeler, et c'est tout.
 */
function SuspendedScreen({ name }: { name: string }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 32 }}>
      <Text style={{ color: palette.text, fontSize: 22, fontWeight: '800', textAlign: 'center' }}>
        Caisse en pause
      </Text>
      <Text style={{ color: palette.mut, fontSize: 15, textAlign: 'center', maxWidth: 420 }}>
        L’accès de {name} est suspendu. Contactez Snack Manager pour le rétablir — la caisse
        rouvrira toute seule, sans réappairage.
      </Text>
    </View>
  );
}
