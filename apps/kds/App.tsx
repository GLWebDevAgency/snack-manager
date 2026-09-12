import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
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
import { REMINDER_MS } from './src/config';
import { makeUi } from './src/ui';
import { ThemeProvider } from './src/theme';
import { usePrefs } from './src/usePrefs';
import { BrandSplash, BrandSplashPlaceholder, StartupContent, useBrandFonts } from '@sm/ui-native';
import { SettingsSheet } from './src/components/SettingsSheet';
import type { KdsTheme } from './src/prefs';

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

export default function App() {
  useBrandFonts();
  const [splashDone, setSplashDone] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const finishSplash = useCallback(() => setSplashDone(true), []);
  // Une cuisine ne doit jamais voir l'écran s'éteindre en plein coup de feu.
  useStayAwake();

  const systemReducedMotion = useReducedMotion();
  const now = useNow(1000);

  const { session, restoring, restoreError, retryRestore, login, logout, device } =
    useSession(client);
  const sync = useSyncState(client);
  useAutoSync(client, 15000);
  const activeDeviceScope = sync.scopeValid ? (device?.queueScope ?? null) : null;
  const { prefs, ready: prefsReady, patchPrefs } = usePrefs(activeDeviceScope);
  const reducedMotion = systemReducedMotion || prefs.reduceMotion;
  const startupKnown = prefsReady || (!restoring && !activeDeviceScope);
  const startupVisible = !splashDone && (!startupKnown || prefs.splash);
  const { palette } = makeUi(prefs.theme);
  const soundOn = prefs.sound;
  const allDayOn = prefs.allDay;
  const layout = useLayout(allDayOn);
  const styles = appStyles(prefs.theme);

  useEffect(() => { if (prefsReady && !prefs.splash) finishSplash(); }, [prefsReady, prefs.splash, finishSplash]);
  useEffect(() => { setSettingsOpen(false); }, [activeDeviceScope, session === null]);


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

  // Les gestes audio conservent leur rôle de déblocage du contexte navigateur.
  const toggleAllDay = useCallback(() => patchPrefs((p) => ({ allDay: !p.allDay })), [patchPrefs]);
  const toggleSound = useCallback(() => {
    patchPrefs((p) => {
      const next = !p.sound;
      if (next) { sound.unlock(); sound.newOrder(); }
      return { sound: next };
    });
  }, [patchPrefs]);

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
    <ThemeProvider theme={prefs.theme} reducedTransparency={prefs.reduceTransparency}>
    <View style={styles.root}>
      <StatusBar style={prefs.theme === 'light' ? 'dark' : 'light'} />
      <StartupContent blocked={startupVisible} style={{ flex: 1 }}>
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
          logoUrl={device?.tenant.logoUrl}
          density={prefs.density}
          onSettings={() => setSettingsOpen(true)}
          onLogout={() => void logout()}
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
      {settingsOpen && session ? <SettingsSheet layout={layout} reducedMotion={reducedMotion} prefs={prefs}
        accent={accent} tenantName={session.tenant.name} deviceName={device?.device.name ?? 'Cuisine'} pending={sync.pending}
        soundSupported={soundSupported} onTheme={(theme) => patchPrefs({ theme })} onDensity={(density) => patchPrefs({ density })}
        onToggleSound={toggleSound} onToggleAllDay={toggleAllDay} onToggleSplash={() => patchPrefs((p) => ({ splash: !p.splash }))}
        onToggleReduceMotion={() => patchPrefs((p) => ({ reduceMotion: !p.reduceMotion }))}
        onToggleReduceTransparency={() => patchPrefs((p) => ({ reduceTransparency: !p.reduceTransparency }))}
        onClose={() => setSettingsOpen(false)} onLogout={() => { setSettingsOpen(false); void logout(); }} /> : null}
      </StartupContent>
      {startupVisible ? startupKnown
        ? <BrandSplash ready={!restoring} onDone={finishSplash} kindLabel="Cuisine" deviceName={device?.device.name ?? 'Écran'} reducedMotion={reducedMotion} />
        : <BrandSplashPlaceholder /> : null}
    </View>
    </ThemeProvider>
  );
}

const styleCache = new Map<KdsTheme, ReturnType<typeof buildAppStyles>>();
function appStyles(theme: KdsTheme) {
  if (!styleCache.has(theme)) styleCache.set(theme, buildAppStyles(theme));
  return styleCache.get(theme)!;
}
function buildAppStyles(theme: KdsTheme) {
  const { palette, ink, type } = makeUi(theme);
  return StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.bg, ...(Platform.OS === 'web' ? { WebkitFontSmoothing: 'antialiased' } : {}) },
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
}
