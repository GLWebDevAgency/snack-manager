import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import {
  useAutoSync,
  useNow,
  useOncePerId,
  useSyncState,
  type Order,
} from '@sm/client-core';
import { client, installErrorReporting } from './src/client';
import { Board } from './src/Board';
import { DemoBanner } from './src/components/DemoBanner';
import { PinScreen } from './src/components/PinScreen';
import { useBoard } from './src/useBoard';
import { useLayout } from './src/useLayout';
import { useReducedMotion } from './src/useReducedMotion';
import { useSession } from './src/useSession';
import { useStayAwake } from './src/useStayAwake';
import { sound, soundSupported } from './src/sound';
import { KEY_PREFS, REMINDER_MS } from './src/config';
import { ink, palette, type } from './src/ui';

/**
 * Écran cuisine (KDS) — Snack Manager.
 *
 * Cet écran ne fait qu'une chose : montrer ce qu'il reste à produire et laisser
 * un cuisinier gantée le faire avancer d'un doigt. Tout le reste (réseau, file
 * offline, réconciliation des statuts) doit être invisible tant que ça marche,
 * et parfaitement explicite quand ça casse.
 *
 * Composition :
 *   App           — session, préférences, alertes sonores, aiguillage d'écran
 *   ├─ PinScreen  — ouverture de service
 *   └─ Board      — barre haute + « À lancer » + 3 colonnes (ou onglets)
 */

interface Prefs {
  sound: boolean;
  /**
   * Panneau « À lancer » épinglé par le cuisinier.
   *
   * Absent = on laisse la place décider, comme avant. Présent = sa décision
   * prime sur le repli automatique, y compris sur un écran étroit.
   */
  allDay?: boolean;
}

export default function App() {
  // Une cuisine ne doit jamais voir l'écran s'éteindre en plein coup de feu.
  useStayAwake();

  /**
   * Panneau « À lancer » épinglé.
   *
   * Déclaré AVANT `useLayout`, qui en dépend : cet état ne décide pas d'un
   * affichage, il décide d'une MISE EN PAGE — la largeur rendue au panneau, et
   * donc celle qui reste aux colonnes.
   *
   * Il vivait auparavant dans le tableau, sous `useLayout`, et n'avait donc
   * aucune prise sur elle : sous le seuil de repli automatique, le bouton
   * disparaissait purement et simplement, laissant le cuisinier sans moyen de
   * rappeler la seule vue qui AGRÈGE ce qu'il a à lancer au lieu de le lister.
   */
  const [allDayOn, setAllDayOn] = useState(true);

  // Toutes les dimensions de l'écran — colonnes, panneau, échelle typo, cibles
  // tactiles — sortent d'ici et de nulle part ailleurs.
  const layout = useLayout(allDayOn);

  const reducedMotion = useReducedMotion();
  const now = useNow(1000);

  const { session, restoring, restoreError, retryRestore, login, logout, device } =
    useSession(client);
  const sync = useSyncState(client);
  useAutoSync(client, 15000);
  const activeDeviceScope = sync.scopeValid ? (device?.queueScope ?? null) : null;

  // Le rapporteur d'erreurs, pour toute la vie de l'écran — voir `client.ts`.
  useEffect(() => installErrorReporting(), []);

  const onUnauthorized = useCallback(() => {
    void logout();
  }, [logout]);

  const board = useBoard(
    client,
    session !== null,
    onUnauthorized,
    session?.token ?? null,
    activeDeviceScope,
  );

  // ─── Préférences locales (son, panneau « À lancer ») ───

  const [soundOn, setSoundOn] = useState(true);

  /** Vrai une fois les préférences relues : avant, on n'écrase rien. */
  const prefsLoadedScope = useRef<string | null>(null);
  const deviceScope = activeDeviceScope;

  useEffect(() => {
    let alive = true;
    const capturedScope = deviceScope;
    prefsLoadedScope.current = null;
    setSoundOn(true);
    setAllDayOn(true);
    if (!capturedScope) return () => void (alive = false);
    void (async () => {
      try {
        const raw = await client.tenantStore.getItem(KEY_PREFS);
        if (!alive || deviceScope !== capturedScope) return;
        if (raw) {
          const prefs = JSON.parse(raw) as Prefs;
          if (typeof prefs.sound === 'boolean') setSoundOn(prefs.sound);
          if (typeof prefs.allDay === 'boolean') setAllDayOn(prefs.allDay);
        }
      } catch {
        /* préférences illisibles : on garde les valeurs par défaut */
      } finally {
        if (alive) prefsLoadedScope.current = capturedScope;
      }
    })();
    return () => {
      alive = false;
    };
  }, [deviceScope]);

  // Une seule écriture pour toutes les préférences : chaque bascule n'a pas à
  // connaître l'état des autres, et aucune ne peut en effacer une en écrivant
  // un objet partiel.
  useEffect(() => {
    if (!deviceScope || prefsLoadedScope.current !== deviceScope) return;
    void client.tenantStore
      .setItem(
        KEY_PREFS,
        JSON.stringify({ sound: soundOn, allDay: allDayOn } satisfies Prefs),
      )
      .catch(() => undefined);
  }, [soundOn, allDayOn, deviceScope]);

  const toggleAllDay = useCallback(() => setAllDayOn((v) => !v), []);

  const toggleSound = useCallback(() => {
    setSoundOn((current) => {
      const next = !current;
      // Le geste sert aussi à débloquer le contexte audio du navigateur.
      if (next) {
        sound.unlock();
        sound.newOrder();
      }
      return next;
    });
  }, []);

  // ─── Commandes dont une écriture attend encore le réseau ───

  const [pendingIds, setPendingIds] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    let alive = true;
    void client.queue
      .pending()
      .then((entries) => {
        if (!alive) return;
        const ids = entries.map((e) => e.subject).filter((s): s is string => Boolean(s));
        ids.push(...board.advancingIds);
        setPendingIds(new Set(ids));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [sync.pending, sync.syncing, board.advancingIds]);

  // ─── Alerte d'arrivée : un bip, une seule fois par commande ───

  const once = useOncePerId();
  const primed = useRef(false);
  const soundOnRef = useRef(soundOn);
  soundOnRef.current = soundOn;

  useEffect(() => {
    for (const order of board.orders) {
      if (order.status !== 'new') continue;
      // Le tout premier passage enregistre les tickets déjà là sans sonner :
      // ouvrir le KDS en plein service ne doit pas déclencher une rafale.
      once(order._id, () => {
        if (primed.current && soundOnRef.current) sound.newOrder();
      });
    }
    if (!board.loading) primed.current = true;
  }, [board.orders, board.loading, once]);

  // ─── Rappel : toutes les 60 s tant qu'un ticket reste dans « Nouveau » ───

  const ordersRef = useRef<Order[]>(board.orders);
  ordersRef.current = board.orders;
  const reminderAnchor = useRef(0);

  useEffect(() => {
    const tick = setInterval(() => {
      const waiting = ordersRef.current.some((o) => o.status === 'new');
      if (!waiting) {
        reminderAnchor.current = 0;
        return;
      }
      const at = Date.now();
      if (reminderAnchor.current === 0) {
        reminderAnchor.current = at; // départ du compte à rebours
        return;
      }
      if (at - reminderAnchor.current >= REMINDER_MS) {
        reminderAnchor.current = at;
        if (soundOnRef.current) sound.reminder();
      }
    }, 1000);
    return () => clearInterval(tick);
  }, []);

  // ─── Écrans ───
  //
  // Les trois états partagent désormais une seule coque, et ce n'est pas de la
  // cosmétique : le bandeau de démonstration doit être présent DÈS l'ouverture
  // du service et jusqu'au tableau. Un visiteur qui tombe sur le chargement ou
  // sur le clavier de code n'est pas moins perdu qu'un autre — il l'est plus.

  const accent = session ? session.tenant.brandColor || palette.gold : palette.gold;

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      {/* Le retour à la vitrine, en démonstration UNIQUEMENT. */}
      <DemoBanner />
      {restoring ? (
        <View style={styles.boot}>
          <ActivityIndicator color={palette.mut} />
          <Text style={styles.bootText}>Ouverture du service…</Text>
        </View>
      ) : restoreError ? (
        <View style={styles.boot}>
          <Text style={[styles.bootText, { fontSize: 20, fontWeight: '800', color: palette.text }]}>
            Écran momentanément verrouillé
          </Text>
          <Text style={styles.bootText}>
            {restoreError} Aucune donnée d’un autre établissement ne sera ouverte avant la fin de
            la restauration.
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Réessayer la restauration de l’écran cuisine"
            onPress={retryRestore}
            style={({ pressed }) => [
              styles.retry,
              { opacity: pressed ? 0.78 : 1 },
            ]}
          >
            <Text style={styles.retryText}>Réessayer</Text>
          </Pressable>
        </View>
      ) : !sync.scopeValid ? (
        <View style={styles.boot}>
          <Text style={[styles.bootText, { fontSize: 20, fontWeight: '800', color: palette.text }]}>
            Appairage modifié
          </Text>
          <Text style={styles.bootText}>
            Une autre fenêtre a changé l’établissement. Cet écran a masqué toutes ses données ;
            rechargez-le pour continuer.
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Recharger l’écran cuisine"
            onPress={() => globalThis.location?.reload()}
            style={({ pressed }) => [styles.retry, { opacity: pressed ? 0.78 : 1 }]}
          >
            <Text style={styles.retryText}>Recharger</Text>
          </Pressable>
        </View>
      ) : device?.suspended ? (
        // Abonnement suspendu : l'écran se verrouille (contrat
        // `DeviceHeartbeatResult`) au lieu d'afficher un tableau qui ne
        // recevra plus rien. Il rouvre seul au battement qui suit la
        // réactivation — la coque et le battement, eux, continuent.
        <View style={styles.boot}>
          <Text style={[styles.bootText, { fontSize: 20, fontWeight: '800', color: palette.text }]}>
            Écran en pause
          </Text>
          <Text style={styles.bootText}>
            L’accès de l’établissement est suspendu. Contactez Snack Manager pour le rétablir.
          </Text>
        </View>
      ) : !session ? (
        <PinScreen
          accent={palette.gold}
          tenantName="Snack Manager"
          onSubmit={login}
          reducedMotion={reducedMotion}
          layout={layout}
        />
      ) : (
        <Board
          orders={board.orders}
          now={now}
          accent={accent}
          tenantName={session.tenant.name}
          online={!board.offline}
          loading={board.loading}
          error={board.offline ? board.error : null}
          pending={sync.pending}
          pendingIds={pendingIds}
          soundOn={soundOn && soundSupported}
          onToggleSound={toggleSound}
          allDayOn={allDayOn}
          onToggleAllDay={toggleAllDay}
          onAdvance={board.advance}
          reducedMotion={reducedMotion}
          layout={layout}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.bg },
  boot: {
    flex: 1,
    backgroundColor: palette.bg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
  },
  bootText: {
    fontFamily: type.body.fontFamily,
    fontSize: 13.5,
    fontWeight: '600',
    letterSpacing: 0.4,
    color: ink.dim,
  },
  retry: {
    minHeight: 48,
    paddingHorizontal: 24,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.gold,
  },
  retryText: {
    fontFamily: type.body.fontFamily,
    color: palette.bg,
    fontSize: 15,
    fontWeight: '800',
  },
});
