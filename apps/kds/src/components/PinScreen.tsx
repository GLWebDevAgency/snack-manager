import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Image, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { PAIRING_CODE_ALPHABET, PAIRING_CODE_LENGTH } from '@sm/contracts';
import {
  alpha,
  contrastOn,
  radius,
  tabular,
  TOUCH_MIN,
} from '../ui';
import { forgetPairedDevice, pairDevice, type PairedDevice } from '../client';
import { useDevice } from '../useSession';
import { useUi } from '../theme';
import { makeUi } from '../ui';
import { SMMark, BRAND_GOLD } from '@sm/ui-native';
import { scaledStyles, type Layout } from '../useLayout';
import { Check, Sheen, Tap } from './primitives';

/**
 * L'ouverture de l'écran cuisine, en deux temps.
 *
 *   APPAIRAGE — une fois, à l'installation : six caractères qui apprennent à
 *               la tablette chez quel restaurant elle travaille ;
 *   CODE      — tous les jours : le code équipe à quatre à six chiffres.
 *
 * Pavé tactile plutôt que champ texte, dans les deux cas : gants, écran gras,
 * aucun clavier logiciel à faire apparaître. Les touches dépassent largement
 * les 44 px réglementaires, grandissent avec l'écran, et répondent à l'appui
 * en moins de 100 ms.
 */

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
const ALPHABET = PAIRING_CODE_ALPHABET.split('');
const MIN_PIN = 4;
const MAX_PIN = 6;

export function PinScreen({
  accent,
  tenantName,
  onSubmit,
  reducedMotion,
  layout,
}: {
  /** Accent de repli, tant qu'aucun établissement n'est appairé. */
  accent: string;
  /** Nom de repli, tant qu'aucun établissement n'est appairé. */
  tenantName: string;
  onSubmit: (pin: string) => Promise<void>;
  reducedMotion: boolean;
  layout: Layout;
}) {
  const device = useDevice();

  // Tant que la tablette n'est appairée à personne, il n'y a pas de code
  // équipe à demander : il n'existe pas encore d'équipe à laquelle le
  // rattacher.
  if (!device) {
    return <PairingView reducedMotion={reducedMotion} layout={layout} />;
  }

  return (
    <CodeView
      device={device}
      fallbackAccent={accent}
      fallbackName={tenantName}
      onSubmit={onSubmit}
      reducedMotion={reducedMotion}
      layout={layout}
    />
  );
}

// ─────────────────────────────────────────────────────────────
// Appairage
// ─────────────────────────────────────────────────────────────

/**
 * Écran d'appairage.
 *
 * Ni adresse de serveur, ni identifiant, ni mot de passe : six caractères lus
 * dans le back-office. L'alphabet exclut I, O, 0 et 1 — les seules confusions
 * qui restent une fois le code affiché en gros, et un cuisinier ganté n'a pas
 * à se demander s'il lit un zéro ou un O.
 */
function PairingView({
  reducedMotion,
  layout,
}: {
  reducedMotion: boolean;
  layout: Layout;
}) {
  const { palette, surface, ink, hair, hair2, shadow, type, theme } = useUi();
  const styles = pinStyles(layout, theme);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Un refus laisse le code affiché : la frappe suivante repart de zéro. */
  const [errored, setErrored] = useState(false);

  const submit = useCallback(async (value: string) => {
    setBusy(true);
    setError(null);
    try {
      await pairDevice(value);
      // Succès : le magasin d'appareil prévient `useDevice`, l'écran bascule
      // seul sur le code équipe. Rien à faire de plus ici.
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Appairage impossible — réessayez');
      setErrored(true);
      setBusy(false);
    }
  }, []);

  const push = useCallback(
    (char: string) => {
      if (busy) return;
      setCode((cur) => {
        // Après un refus, la première touche recommence la saisie : on ne
        // corrige pas un code entier caractère par caractère.
        const base = errored ? '' : cur;
        const next = (base + char).slice(0, PAIRING_CODE_LENGTH);
        if (next.length === PAIRING_CODE_LENGTH) void submit(next);
        return next;
      });
      setError(null);
      setErrored(false);
    },
    [busy, errored, submit],
  );

  const back = useCallback(() => {
    if (busy) return;
    setError(null);
    setErrored(false);
    setCode((cur) => cur.slice(0, -1));
  }, [busy]);

  // La tablette est souvent installée avec un clavier USB (maintenance), et
  // c'est le confort de démonstration au navigateur.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const onKey = (event: KeyboardEvent) => {
      const char = event.key.toUpperCase();
      if (char.length === 1 && PAIRING_CODE_ALPHABET.includes(char)) push(char);
      else if (event.key === 'Backspace') back();
      else if (event.key === 'Escape') setCode('');
    };
    globalThis.addEventListener?.('keydown', onKey);
    return () => globalThis.removeEventListener?.('keydown', onKey);
  }, [push, back]);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: palette.bg }} contentContainerStyle={styles.screen}>
      <View style={[styles.widePanel, shadow.panel]}>
        <Sheen height={160} radius={radius.xl} />

        <View style={styles.head}>
          {/* NOTRE marque, et UNIQUEMENT ici : tant que l'écran n'est appairé à
              personne, il n'a pas d'établissement à représenter — c'est le
              logiciel qui se présente. La tuile générique portait un « S » de
              repli qui ne voulait rien dire. Dès l'appairage, `CodeView`
              reprend la tuile avec l'initiale et l'accent du RESTAURANT.
              Le signe est posé sur l'aplat du panneau : son éclair est un
              VIDE, il exige un fond uni derrière lui. */}
          {layout.pairingMarkFits && <SMMark size={layout.pairingMark} color={palette.text} />}
          <Text style={styles.title}>Appairer cet appareil</Text>
          <Text style={styles.subtitle}>Snack Manager · Cuisine</Text>
        </View>

        <Text style={styles.lead}>
          Saisissez le code à {PAIRING_CODE_LENGTH} caractères affiché dans votre back-office,
          rubrique « Caisses & cuisine ».
        </Text>

        {/* Tuiles de saisie : une case par caractère, comme dans le back-office
            — on ne perd pas sa place au milieu du code. */}
        <View style={styles.slots}>
          {Array.from({ length: PAIRING_CODE_LENGTH }, (_, i) => {
            const char = code[i];
            const active = code.length === i && !errored;
            return (
              <View
                key={i}
                style={[
                  styles.slot,
                  active && { borderColor: palette.gold, borderWidth: 2 },
                  errored && { borderColor: palette.red },
                ]}
              >
                <Text style={[styles.slotText, errored && { color: ink.onRed }]}>
                  {char ?? ''}
                </Text>
              </View>
            );
          })}
        </View>

        <View style={styles.errorSlot}>
          <Text
            style={[styles.error, !error && styles.hintInline]}
            accessibilityLiveRegion="polite"
          >
            {error ?? (busy ? 'Appairage en cours…' : 'Ni I, ni O, ni 0, ni 1 dans le code')}
          </Text>
        </View>

        <View style={styles.alphaPad}>
          {ALPHABET.map((char) => (
            <Tap
              key={char}
              onPress={() => push(char)}
              label={char}
              reducedMotion={reducedMotion}
              style={styles.alphaKey}
              pressedStyle={{ backgroundColor: surface.el2, borderColor: hair }}
            >
              <Text style={styles.alphaKeyText}>{char}</Text>
            </Tap>
          ))}
        </View>

        <View style={styles.row}>
          <Tap
            onPress={() => setCode('')}
            label="Tout effacer"
            reducedMotion={reducedMotion}
            style={[styles.wideKey, styles.keyGhost]}
            pressedStyle={{ backgroundColor: surface.el }}
          >
            <Text style={styles.keyGhostText}>Tout effacer</Text>
          </Tap>
          <Tap
            onPress={back}
            label="Corriger"
            reducedMotion={reducedMotion}
            style={[styles.wideKey, styles.keyGhost]}
            pressedStyle={{ backgroundColor: surface.el }}
          >
            {/* Libellé en toutes lettres plutôt qu'un pictogramme : le glyphe
                « retour arrière » manque à une bonne partie des polices
                système et se dessine alors en carré vide. */}
            <Text style={styles.keyGhostText}>Corriger</Text>
          </Tap>
        </View>
      </View>
    </ScrollView>
  );
}

// ─────────────────────────────────────────────────────────────
// Code équipe
// ─────────────────────────────────────────────────────────────

function CodeView({
  device,
  fallbackAccent,
  fallbackName,
  onSubmit,
  reducedMotion,
  layout,
}: {
  device: PairedDevice;
  fallbackAccent: string;
  fallbackName: string;
  onSubmit: (pin: string) => Promise<void>;
  reducedMotion: boolean;
  layout: Layout;
}) {
  const { palette, surface, ink, hair, hair2, shadow, type, theme } = useUi();
  const styles = pinStyles(layout, theme);
  // Le nom et l'accent viennent de l'établissement APPAIRÉ : plus aucune
  // constante côté application. Les valeurs reçues en props ne servent que de
  // repli si la marque revenait vide du serveur.
  const accent = device.tenant.brandColor || fallbackAccent;
  const tenantName = device.tenant.name || fallbackName;

  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmUnpair, setConfirmUnpair] = useState(false);
  const [failedLogo, setFailedLogo] = useState<string | null>(null);

  const push = useCallback(
    (digit: string) => {
      if (busy) return;
      setError(null);
      setPin((current) => (current.length >= MAX_PIN ? current : current + digit));
    },
    [busy],
  );

  const clear = useCallback(() => {
    if (busy) return;
    setError(null);
    setPin('');
  }, [busy]);

  const submit = useCallback(async () => {
    if (busy || pin.length < MIN_PIN) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(pin);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connexion impossible');
      setPin('');
    } finally {
      setBusy(false);
    }
  }, [busy, onSubmit, pin]);

  // Confort de développement et d'exploitation : la tablette peut être reliée
  // à un clavier USB (installation, maintenance).
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key >= '0' && event.key <= '9') push(event.key);
      else if (event.key === 'Backspace') setPin((c) => c.slice(0, -1));
      else if (event.key === 'Enter') void submit();
      else if (event.key === 'Escape') clear();
    };
    globalThis.addEventListener?.('keydown', onKey);
    return () => globalThis.removeEventListener?.('keydown', onKey);
  }, [push, submit, clear]);

  const ready = pin.length >= MIN_PIN && !busy;

  /*
   * « Changer d'établissement » — un geste rarissime sur une tablette
   * installée, et catastrophique s'il part tout seul en plein coup de feu.
   * D'où le lien gris en pied de panneau, et cette confirmation qui prend
   * toute la place plutôt qu'une boîte de dialogue à fermer avec un gant.
   */
  if (confirmUnpair) {
    return (
      <ScrollView style={{ flex: 1, backgroundColor: palette.bg }} contentContainerStyle={styles.screen}>
        <View style={[styles.panel, shadow.panel]}>
          <Sheen height={160} radius={radius.xl} />
          <Text style={styles.title}>Changer d&apos;établissement</Text>
          <View style={styles.warn}>
            <Text style={styles.warnText}>
              <Text style={{ fontWeight: '800' }}>
                Cet écran cessera d&apos;afficher les tickets de « {tenantName} ».
              </Text>{' '}
              Il faudra saisir un nouveau code d&apos;appairage pour le remettre en service.
            </Text>
          </View>
          <Text style={styles.hint}>
            À ne faire qu&apos;en cas de changement d&apos;établissement. Pour un écran
            simplement figé, fermez et rouvrez l&apos;application : elle repart avec son
            appairage.
          </Text>
          <View style={styles.row}>
            <Tap
              onPress={() => setConfirmUnpair(false)}
              label="Annuler"
              reducedMotion={reducedMotion}
              style={[styles.wideKey, styles.keyGhost]}
              pressedStyle={{ backgroundColor: surface.el }}
            >
              <Text style={styles.keyGhostText}>Annuler</Text>
            </Tap>
            <Tap
              onPress={() => void forgetPairedDevice()}
              label="Désappairer cet écran"
              reducedMotion={reducedMotion}
              style={[
                styles.wideKey,
                { backgroundColor: alpha(palette.red, 0.16), borderColor: alpha(palette.red, 0.4) },
              ]}
              pressedStyle={{ opacity: 0.82 }}
            >
              <Text style={[styles.keyGhostText, { color: ink.onRed }]}>Désappairer</Text>
            </Tap>
          </View>
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: palette.bg }} contentContainerStyle={styles.screen}>
      <View style={styles.codePanel}>
        <View style={styles.head}>
          <View style={[styles.brand, { backgroundColor: accent }]}>
            {device.tenant.logoUrl && failedLogo !== device.tenant.logoUrl ? <Image source={{ uri: device.tenant.logoUrl }} resizeMode="contain" onError={() => setFailedLogo(device.tenant.logoUrl ?? null)} style={{ width: '72%', height: '72%' }} accessible={false} /> :
            <Text style={[styles.brandLetter, { color: contrastOn(accent) }]}>{(tenantName.trim()[0] ?? 'S').toUpperCase()}</Text>}
          </View>
          <Text style={styles.title}>{tenantName}</Text>
          <Text style={styles.subtitle}>Cuisine · {device.device.name}</Text>
        </View>

        <Text style={styles.prompt}>Code équipe</Text>

        <View style={styles.dots} accessibilityLabel={`${pin.length} chiffre(s) saisi(s)`}>
          {Array.from({ length: MAX_PIN }, (_, i) => {
            const filled = i < pin.length;
            const optional = i >= MIN_PIN;
            return (
              <View
                key={i}
                style={[
                  styles.dot,
                  optional && styles.dotOptional,
                  filled && { backgroundColor: accent, borderColor: accent },
                ]}
              />
            );
          })}
        </View>

        <View style={styles.errorSlot}>
          {error ? (
            <Text style={styles.error} accessibilityLiveRegion="polite">
              {error}
            </Text>
          ) : null}
        </View>

        <View style={styles.pad}>
          {KEYS.map((key) => (
            <Tap
              key={key}
              onPress={() => push(key)}
              label={key}
              reducedMotion={reducedMotion}
              style={styles.key}
              pressedStyle={{ backgroundColor: surface.el2, borderColor: hair }}
            >
              <Text style={styles.keyText}>{key}</Text>
            </Tap>
          ))}

          <Tap
            onPress={clear}
            label="Effacer"
            reducedMotion={reducedMotion}
            style={[styles.key, styles.keyGhost]}
            pressedStyle={{ backgroundColor: surface.el }}
          >
            <Text style={styles.keyGhostText}>Effacer</Text>
          </Tap>

          <Tap
            onPress={() => push('0')}
            label="0"
            reducedMotion={reducedMotion}
            style={styles.key}
            pressedStyle={{ backgroundColor: surface.el2, borderColor: hair }}
          >
            <Text style={styles.keyText}>0</Text>
          </Tap>

          <Tap
            onPress={() => void submit()}
            disabled={!ready}
            label="Valider le code"
            reducedMotion={reducedMotion}
            style={[
              styles.key,
              {
                backgroundColor: ready ? accent : surface.el,
                borderColor: ready ? accent : hair2,
              },
            ]}
            pressedStyle={{ opacity: 0.82 }}
          >
            {busy ? (
              <ActivityIndicator color={contrastOn(accent)} />
            ) : (
              <Check color={ready ? contrastOn(accent) : ink.dimmer} size={layout.far(26)} />
            )}
          </Tap>
        </View>

        <Text style={styles.hint}>
          {MIN_PIN} à {MAX_PIN} chiffres, puis validez.
        </Text>

        <View style={{ flexDirection: 'row', alignSelf: 'center', alignItems: 'center', gap: layout.fs(6), marginTop: layout.fs(22), opacity: 0.6 }}>
          <SMMark size={layout.fs(18)} color={palette.text} accessible={false} />
          <Text style={{ fontFamily: type.title.fontFamily, fontSize: layout.fs(13), fontWeight: '800', color: palette.text }}>Snack <Text style={{ color: BRAND_GOLD }}>Manager</Text></Text>
        </View>

        {/* Nom de l'APPAREIL, pas un numéro inventé : c'est celui que le gérant
            a saisi dans le back-office, donc celui qu'il cherche quand il veut
            savoir quelle tablette est laquelle. */}
        <Tap
          onPress={() => setConfirmUnpair(true)}
          label="Changer d'établissement"
          reducedMotion={reducedMotion}
          style={styles.unpair}
          pressedStyle={{ backgroundColor: surface.el }}
        >
          <Text style={styles.unpairText}>
            {device.device.name} · Changer d&apos;établissement
          </Text>
        </Tap>
      </View>
    </ScrollView>
  );
}

const pinStyles = scaledStyles((l: Layout, theme) => {
  const { palette, surface, ink, hair, hair2, type } = makeUi(theme);
  const keyW = l.pinKeyW;
  const keyH = l.pinKeyH;
  const gap = l.fs(10);
  const alphaKey = l.pairingKey;
  const wideWidth = l.pairingWidth;
  const markSize = l.pairingMark;
  return StyleSheet.create({
    screen: {
      flexGrow: 1,
      backgroundColor: palette.bg,
      alignItems: 'center',
      justifyContent: 'center',
      padding: l.fs(16),
    },
    // Le panneau suit l'échelle (340 px à la référence) mais ne descend jamais
    // sous la largeur du pavé : trois touches + deux gouttières + marges +
    // bordures — sinon la troisième colonne de touches passe à la ligne.
    codePanel: { width: l.pinPadW, maxWidth: '100%', paddingVertical: l.fs(20) },
    panel: {
      width: Math.max(Math.round(340 * l.scale), keyW * 3 + gap * 2 + 46),
      maxWidth: '100%',
      backgroundColor: surface.card,
      borderRadius: radius.xl,
      borderWidth: 1,
      borderColor: hair2,
      paddingHorizontal: 20,
      paddingTop: 26,
      paddingBottom: 20,
      overflow: 'hidden',
    },
    /** Même panneau, dimensionné pour le pavé alphabétique de l'appairage. */
    widePanel: {
      width: wideWidth,
      maxWidth: '100%',
      backgroundColor: surface.card,
      borderRadius: radius.xl,
      borderWidth: 1,
      borderColor: hair2,
      paddingHorizontal: 20,
      paddingTop: 26,
      paddingBottom: 20,
      overflow: 'hidden',
    },
    head: { alignItems: 'center', gap: 8 },
    brand: {
      width: l.pinBrand,
      height: l.pinBrand,
      borderRadius: l.fs(19),
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 4,
    },
    /** Le signe Snack Manager — écran d'appairage seulement. */
    mark: {
      width: markSize,
      height: markSize,
      marginBottom: 4,
    },
    brandLetter: {
      fontFamily: type.hero.fontFamily,
      fontSize: l.far(27),
      fontWeight: '800',
      letterSpacing: -0.8,
    },
    title: {
      fontFamily: type.title.fontFamily,
      fontSize: l.fs(20),
      fontWeight: '700',
      letterSpacing: -0.4,
      color: palette.text,
      textAlign: 'center',
    },
    subtitle: {
      fontFamily: type.micro.fontFamily,
      fontSize: l.fs(11.5),
      fontWeight: '700',
      letterSpacing: 1.1,
      textTransform: 'uppercase',
      color: ink.dim,
    },
    lead: {
      fontFamily: type.body.fontFamily,
      fontSize: l.fs(13.5),
      lineHeight: l.fs(20),
      color: ink.dim,
      textAlign: 'center',
      marginTop: 18,
      paddingHorizontal: 8,
    },
    prompt: {
      fontFamily: type.micro.fontFamily,
      fontSize: l.fs(11),
      fontWeight: '800',
      letterSpacing: 1.2,
      textTransform: 'uppercase',
      color: ink.dimmer,
      textAlign: 'center',
      marginTop: 22,
    },
    dots: { flexDirection: 'row', justifyContent: 'center', gap: 12, marginTop: 12 },
    dot: {
      width: l.fs(14),
      height: l.fs(14),
      borderRadius: l.fs(7),
      borderWidth: 1.5,
      borderColor: hair,
      backgroundColor: 'transparent',
    },
    dotOptional: { borderColor: hair2 },
    slots: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginTop: 18 },
    slot: {
      width: l.pairingSlotW,
      height: Math.round(58 * l.scale),
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: hair2,
      backgroundColor: surface.el,
      alignItems: 'center',
      justifyContent: 'center',
    },
    slotText: {
      fontFamily: type.hero.fontFamily,
      fontSize: l.far(28),
      fontWeight: '800',
      color: palette.text,
      ...tabular,
    },
    errorSlot: { minHeight: 30, justifyContent: 'center' },
    error: {
      fontFamily: type.body.fontFamily,
      fontSize: l.fs(13),
      fontWeight: '700',
      color: ink.onRed,
      textAlign: 'center',
    },
    hintInline: { color: ink.dimmer, fontWeight: '600' },
    pad: { flexDirection: 'row', flexWrap: 'wrap', gap, justifyContent: 'center' },
    key: {
      width: keyW,
      height: keyH,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: hair2,
      backgroundColor: surface.el,
      alignItems: 'center',
      justifyContent: 'center',
    },
    keyText: {
      fontFamily: type.hero.fontFamily,
      fontSize: l.far(26),
      fontWeight: '700',
      color: palette.text,
      ...tabular,
    },
    alphaPad: { flexDirection: 'row', flexWrap: 'wrap', gap, justifyContent: 'center' },
    alphaKey: {
      width: alphaKey,
      height: alphaKey,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: hair2,
      backgroundColor: surface.el,
      alignItems: 'center',
      justifyContent: 'center',
    },
    alphaKeyText: {
      fontFamily: type.hero.fontFamily,
      fontSize: l.far(21),
      fontWeight: '700',
      color: palette.text,
      ...tabular,
    },
    row: { flexDirection: 'row', gap, justifyContent: 'center', marginTop: 14 },
    wideKey: {
      flex: 1,
      height: Math.max(TOUCH_MIN, l.touch),
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: hair2,
      alignItems: 'center',
      justifyContent: 'center',
    },
    keyGhost: { backgroundColor: 'transparent', borderColor: hair2 },
    keyGhostText: {
      fontFamily: type.micro.fontFamily,
      fontSize: l.fs(12.5),
      fontWeight: '700',
      color: ink.dim,
    },
    warn: {
      marginTop: 16,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: alpha(palette.red, 0.4),
      backgroundColor: alpha(palette.red, 0.1),
      padding: 14,
    },
    warnText: {
      fontFamily: type.body.fontFamily,
      fontSize: l.fs(13.5),
      lineHeight: l.fs(20),
      color: palette.text,
    },
    hint: {
      fontFamily: type.body.fontFamily,
      fontSize: l.fs(12),
      lineHeight: l.fs(18),
      color: ink.dimmer,
      textAlign: 'center',
      marginTop: 16,
    },
    unpair: {
      minHeight: l.touch,
      justifyContent: 'center',
      alignSelf: 'center',
      marginTop: 12,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: hair2,
    },
    unpairText: {
      fontFamily: type.micro.fontFamily,
      fontSize: l.fs(11.5),
      fontWeight: '600',
      color: ink.dimmer,
    },
  });
});
