import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import {
  getStore,
  useAutoSync,
  useNow,
  useOncePerId,
  useSyncState,
  type Order,
} from '@sm/client-core';
import { client } from './src/client';
import { Board } from './src/Board';
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

  const { session, restoring, login, logout } = useSession(client);
  const sync = useSyncState(client);
  useAutoSync(client, 15000);

  const onUnauthorized = useCallback(() => {
    void logout();
  }, [logout]);

  const board = useBoard(client, session !== null, onUnauthorized);

  // ─── Préférences locales (son, panneau « À lancer ») ───

  const [soundOn, setSoundOn] = useState(true);

  /** Vrai une fois les préférences relues : avant, on n'écrase rien. */
  const prefsLoaded = useRef(false);

  useEffect(() => {
    void (async () => {
      const raw = await getStore().getItem(KEY_PREFS);
      try {
        if (raw) {
          const prefs = JSON.parse(raw) as Prefs;
          if (typeof prefs.sound === 'boolean') setSoundOn(prefs.sound);
          if (typeof prefs.allDay === 'boolean') setAllDayOn(prefs.allDay);
        }
      } catch {
        /* préférences illisibles : on garde les valeurs par défaut */
      } finally {
        prefsLoaded.current = true;
      }
    })();
  }, []);

  // Une seule écriture pour toutes les préférences : chaque bascule n'a pas à
  // connaître l'état des autres, et aucune ne peut en effacer une en écrivant
  // un objet partiel.
  useEffect(() => {
    if (!prefsLoaded.current) return;
    void getStore().setItem(
      KEY_PREFS,
      JSON.stringify({ sound: soundOn, allDay: allDayOn } satisfies Prefs),
    );
  }, [soundOn, allDayOn]);

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
    void client.queue.pending().then((entries) => {
      if (!alive) return;
      const ids = entries.map((e) => e.subject).filter((s): s is string => Boolean(s));
      setPendingIds(new Set(ids));
    });
    return () => {
      alive = false;
    };
  }, [sync.pending, sync.syncing]);

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

  if (restoring) {
    return (
      <View style={styles.boot}>
        <StatusBar style="light" />
        <ActivityIndicator color={palette.mut} />
        <Text style={styles.bootText}>Ouverture du service…</Text>
      </View>
    );
  }

  if (!session) {
    return (
      <View style={styles.root}>
        <StatusBar style="light" />
        <PinScreen
          accent={palette.gold}
          tenantName="Snack Manager"
          onSubmit={login}
          reducedMotion={reducedMotion}
          layout={layout}
        />
      </View>
    );
  }

  const accent = session.tenant.brandColor || palette.gold;

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
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
});
