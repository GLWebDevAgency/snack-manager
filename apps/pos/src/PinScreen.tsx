/**
 * Les deux écrans d'ouverture du poste de caisse.
 *
 *   PairingScreen — UNE fois, à l'installation : six caractères qui apprennent
 *                   au poste chez quel restaurant il travaille ;
 *   PinScreen     — tous les jours : le code à quatre chiffres de l'équipier.
 *
 * Un poste de caisse est allumé le matin et partagé toute la journée : la
 * saisie doit être lisible à bout de bras et pardonner l'erreur (secousse +
 * message clair, jamais de blocage).
 *
 * Les deux écrans partagent volontairement leur mise en page — tuile de marque,
 * points de saisie, pavé sur panneau — parce que c'est le même geste, au même
 * endroit, sur la même tablette. Seul l'alphabet change.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Image, Platform, Text, View } from 'react-native';
import { PAIRING_CODE_ALPHABET, PAIRING_CODE_LENGTH } from '@sm/contracts';
import { TOUCH_MIN, palette } from '@sm/client-core';
import {
  DeviceError,
  client,
  forgetPairedDevice,
  pairDevice,
  pinLogin,
  type PairedDevice,
  type Session,
} from './client';
import { FONT, R, makeBrand, shadow, type, withAlpha } from './theme';
import { Btn, Overlay, PanelHead, Press, Sheen, useReducedMotion } from './ui';
import { useLayout } from './useLayout';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'back'] as const;

// ─────────────────────────────────────────────────────────────
// Secousse partagée
// ─────────────────────────────────────────────────────────────

/**
 * Le refus se voit AVANT de se lire : la secousse dit « recommence » en
 * 240 ms, là où un message seul demande de lire pour comprendre. Respecte
 * « mouvement réduit », où le message porte seul l'information.
 */
function useShake(reduced: boolean) {
  const value = useRef(new Animated.Value(0)).current;
  const shake = useCallback(() => {
    if (reduced) return;
    Animated.sequence([
      Animated.timing(value, { toValue: 1, duration: 55, useNativeDriver: true }),
      Animated.timing(value, { toValue: -1, duration: 55, useNativeDriver: true }),
      Animated.timing(value, { toValue: 0.6, duration: 55, useNativeDriver: true }),
      Animated.timing(value, {
        toValue: 0,
        duration: 70,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start();
  }, [reduced, value]);
  const transform = [
    { translateX: value.interpolate({ inputRange: [-1, 1], outputRange: [-9, 9] }) },
  ];
  return { shake, transform };
}

// ─────────────────────────────────────────────────────────────
// Appairage — six caractères, une seule fois dans la vie du poste
// ─────────────────────────────────────────────────────────────

const ALPHABET = PAIRING_CODE_ALPHABET.split('');

/**
 * Écran d'appairage.
 *
 * C'est le premier écran qu'un restaurateur voit de Snack Manager, tablette en
 * main, souvent debout. Il ne demande ni adresse de serveur, ni identifiant, ni
 * mot de passe : six caractères lus dans le back-office, et la caisse sait chez
 * qui elle travaille. L'alphabet exclut I, O, 0 et 1 — les seules confusions
 * qui restaient une fois le code affiché en gros.
 */
export function PairingScreen({ onPaired }: { onPaired: (device: PairedDevice) => void }) {
  const L = useLayout();
  const reduced = useReducedMotion();
  const { shake, transform } = useShake(reduced);

  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Un refus laisse le code affiché : la frappe suivante repart de zéro. */
  const [errored, setErrored] = useState(false);

  const submit = useCallback(
    async (value: string) => {
      setBusy(true);
      setError(null);
      try {
        onPaired(await pairDevice(value));
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Appairage impossible — réessayez');
        setErrored(true);
        setBusy(false);
        shake();
      }
    },
    [onPaired, shake],
  );

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

  // Clavier physique : la plupart des tablettes de caisse sont installées avec
  // un clavier USB branché, et c'est le confort de démonstration au navigateur.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const doc = (globalThis as { document?: Document }).document;
    if (!doc) return;
    const onKey = (e: KeyboardEvent) => {
      const char = e.key.toUpperCase();
      if (char.length === 1 && PAIRING_CODE_ALPHABET.includes(char)) push(char);
      else if (e.key === 'Backspace') back();
      else if (e.key === 'Escape') setCode('');
    };
    doc.addEventListener('keydown', onKey);
    return () => doc.removeEventListener('keydown', onKey);
  }, [back, push]);

  // Pavé de 32 symboles. On dimensionne la TOUCHE d'abord, puis le panneau
  // autour : partir de la largeur du panneau laisse les bordures déborder d'un
  // pixel et fait retomber la dernière colonne à la ligne.
  const cols = L.width < 560 ? 6 : 8;
  const gap = 10;
  const padMax = Math.min(Math.round(560 * (1 + (L.scale - 1) * 0.6)), L.width - 32);
  const keySize = Math.max(
    Math.round(TOUCH_MIN * 0.92),
    Math.floor((padMax - 36 - gap * (cols - 1) - 2) / cols),
  );
  const padW = keySize * cols + gap * (cols - 1) + 36 + 2;

  // Le signe se lit à bout de bras sur une tablette posée au comptoir : 84 px
  // à la référence, borné à [72 ; 96].
  const markSize = Math.min(96, Math.max(72, L.sp(84)));
  // …mais il ne passe JAMAIS avant le pavé. Cet écran ne défile pas : sur une
  // tablette courte, un signe imposé pousserait les dernières touches hors de
  // la fenêtre. On mesure donc la place réellement libre avant de le servir.
  // Hauteur du pavé : exacte, c'est la même grille que celle rendue plus bas.
  const padRows = Math.ceil(ALPHABET.length / cols);
  const padH = padRows * keySize + gap * (padRows - 1) + 38;
  // Tout ce qui n'est pas le pavé, poste par poste et aux mêmes échelles que
  // le rendu : bandeau, titre, phrase d'aide (deux lignes), tuiles de saisie,
  // ligne de message, gouttière du pavé, boutons.
  const restH =
    L.fs(14) * 1.3 + 10 + L.fs(26) * 1.3 + 8 + L.fs(20) * 2 + 24 + L.sp(58) + 34 + 6 + 12 + 44;
  const showMark = L.height - padH - restH - 16 >= markSize;

  return (
    <View style={{ flex: 1, backgroundColor: palette.bg, alignItems: 'center', justifyContent: 'center' }}>
      {/* Filet d'accent : le poste n'a pas encore de marque — c'est l'or de la
          maison qui tient la place, et il changera dès l'appairage. */}
      <View
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: 2,
          backgroundColor: palette.gold,
          opacity: 0.55,
        }}
      />

      <Animated.View style={{ alignItems: 'center', transform }}>
        {/* NOTRE marque, et UNIQUEMENT ici : tant que le poste n'est appairé à
            personne, il n'a pas d'établissement à représenter — c'est le
            logiciel qui se présente. Dès l'appairage, l'écran de code équipier
            porte la marque du RESTAURANT, jamais la nôtre.
            Le signe est posé sur l'aplat de fond : son éclair est un VIDE, il
            exige un fond uni derrière lui. */}
        {showMark && (
          <Image
            source={require('../assets/mark.png')}
            style={{ width: markSize, height: markSize, marginBottom: 16 }}
            resizeMode="contain"
            accessibilityLabel="Snack Manager"
          />
        )}
        <Text style={[type.eyebrow, { color: palette.gold }]}>Snack Manager · Caisse</Text>
        <Text style={[type.h1, { fontSize: L.fs(26), marginTop: 10, textAlign: 'center' }]}>
          Appairer cet appareil
        </Text>
        <Text
          style={{
            fontFamily: FONT,
            fontSize: L.fs(14),
            color: palette.mut,
            marginTop: 8,
            maxWidth: 420,
            textAlign: 'center',
            lineHeight: L.fs(20),
          }}
        >
          Saisissez le code à {PAIRING_CODE_LENGTH} caractères affiché dans votre back-office,
          rubrique « Caisses & cuisine ».
        </Text>

        {/* Tuiles de saisie : une case par caractère, comme dans le back-office
            — on ne perd pas sa place au milieu du code. */}
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 24 }}>
          {Array.from({ length: PAIRING_CODE_LENGTH }, (_, i) => {
            const char = code[i];
            const active = code.length === i && !errored;
            return (
              <View
                key={i}
                style={{
                  width: L.sp(46),
                  height: L.sp(58),
                  borderRadius: R.card,
                  backgroundColor: palette.surface,
                  borderWidth: active ? 2 : 1,
                  borderColor: errored
                    ? palette.red
                    : active
                      ? palette.gold
                      : palette.line2,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Text
                  style={{
                    fontFamily: FONT,
                    fontSize: L.fs(30),
                    fontWeight: '800',
                    color: errored ? palette.red : palette.text,
                  }}
                >
                  {char ?? ''}
                </Text>
              </View>
            );
          })}
        </View>

        <View style={{ height: 34, justifyContent: 'center', paddingHorizontal: 20 }}>
          <Text
            style={{
              fontFamily: FONT,
              fontSize: L.fs(14),
              fontWeight: '600',
              textAlign: 'center',
              color: error ? palette.red : palette.mut,
              opacity: error || busy ? 1 : 0.7,
            }}
          >
            {error ?? (busy ? 'Appairage en cours…' : 'Ni I, ni O, ni 0, ni 1 dans le code')}
          </Text>
        </View>

        <View
          style={{
            width: padW,
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap,
            marginTop: 6,
            padding: 18,
            borderRadius: 26,
            backgroundColor: '#0b0b0b',
            borderWidth: 1,
            borderColor: palette.line2,
            justifyContent: 'center',
          }}
        >
          {ALPHABET.map((char) => (
            <PadKey key={char} label={char} size={keySize} onPress={() => push(char)} compact />
          ))}
        </View>

        <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
          {/* Libellés en toutes lettres plutôt qu'un pictogramme : le glyphe
              « retour arrière » manque à une bonne partie des polices système
              et se dessine alors en carré vide, ce qu'on ne peut pas se
              permettre sur le tout premier écran du produit. */}
          <Btn label="Tout effacer" kind="ghost" size="sm" onPress={() => setCode('')} />
          <Btn label="Corriger" kind="ghost" size="sm" onPress={back} />
        </View>
      </Animated.View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────
// Code équipier — l'écran de tous les jours
// ─────────────────────────────────────────────────────────────

export function PinScreen({
  onSession,
  device,
  onUnpair,
  notice,
}: {
  onSession: (s: Session) => void;
  /** Établissement appairé : c'est LUI qui porte le nom et l'accent affichés. */
  device: PairedDevice;
  /** Désappairage confirmé — « Changer d'établissement ». */
  onUnpair: () => void;
  /** Raison du verrouillage (session expirée, fin de poste…). */
  notice?: string | null;
}) {
  const L = useLayout();
  const brand = useMemo(
    () => makeBrand(device.tenant.name, device.tenant.brandColor),
    [device.tenant.brandColor, device.tenant.name],
  );
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(notice ?? null);
  const [confirmUnpair, setConfirmUnpair] = useState(false);
  const reduced = useReducedMotion();
  const { shake, transform } = useShake(reduced);

  const fail = useCallback(
    (message: string) => {
      setError(message);
      setPin('');
      setBusy(false);
      shake();
    },
    [shake],
  );

  const submit = useCallback(
    async (code: string) => {
      setBusy(true);
      setError(null);
      try {
        // L'établissement vient du JETON D'APPAREIL, jamais d'un slug envoyé
        // par la caisse : c'est ce qui rend le poste réellement
        // multi-restaurants au lieu de le figer sur un client.
        const res = await pinLogin(code);
        client.setToken(res.token);
        onSession({
          token: res.token,
          staffName: res.staff.name,
          staffRole: res.staff.role,
          tenantName: res.tenant.name,
          tenantSlug: res.tenant.slug,
          brandColor: res.tenant.brandColor,
          at: Date.now(),
        });
      } catch (e) {
        // 401 sur l'APPAREIL (et non sur le PIN) : la tablette a été révoquée
        // depuis le back-office. Inutile d'insister, il faut réappairer.
        if (e instanceof DeviceError && /appair/i.test(e.message)) {
          fail(e.message);
          return;
        }
        const msg = e instanceof Error ? e.message : 'Connexion impossible';
        fail(/PIN|invalide|Unauthorized/i.test(msg) ? 'Code incorrect — réessayez' : msg);
      }
    },
    [fail, onSession],
  );

  const push = useCallback(
    (digit: string) => {
      if (busy) return;
      setError(null);
      setPin((cur) => {
        const next = (cur + digit).slice(0, 4);
        if (next.length === 4) void submit(next);
        return next;
      });
    },
    [busy, submit],
  );

  const back = useCallback(() => {
    if (busy) return;
    setError(null);
    setPin((cur) => cur.slice(0, -1));
  }, [busy]);

  // Clavier physique (poste avec clavier, démonstration navigateur).
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const doc = (globalThis as { document?: Document }).document;
    if (!doc) return;
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) push(e.key);
      else if (e.key === 'Backspace') back();
      else if (e.key === 'Escape') setPin('');
    };
    doc.addEventListener('keydown', onKey);
    return () => doc.removeEventListener('keydown', onKey);
  }, [back, push]);

  // Pavé : 378 px de large sur la référence (3 touches + 2 gouttières de 12 +
  // 2 × 18 de padding + 2 × 1 de bordure), fluide ailleurs, jamais plus large
  // que l'écran. On dimensionne la TOUCHE d'abord puis le panneau autour :
  // partir de la largeur du panneau laisse les bordures déborder d'un pixel et
  // fait retomber le pavé sur deux colonnes.
  const padMax = Math.min(Math.round(378 * (1 + (L.scale - 1) * 0.6)), L.width - 32);
  const keySize = Math.max(TOUCH_MIN, Math.floor((padMax - 36 - 24 - 2) / 3));
  const padW = keySize * 3 + 24 + 36 + 2;

  return (
    <View style={{ flex: 1, backgroundColor: palette.bg, alignItems: 'center', justifyContent: 'center' }}>
      {/* Filet d'accent en tête d'écran : signature de marque discrète, désormais
          celle de l'établissement appairé et non plus d'une constante. */}
      <View
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: 2,
          backgroundColor: brand.accent,
          opacity: 0.55,
        }}
      />

      <Animated.View style={{ alignItems: 'center', transform }}>
        <View
          style={[
            {
              width: 72,
              height: 72,
              borderRadius: 22,
              backgroundColor: brand.accent,
              alignItems: 'center',
              justifyContent: 'center',
            },
            shadow(2),
          ]}
        >
          <Text style={{ fontFamily: FONT, color: brand.onAccent, fontSize: 34, fontWeight: '800' }}>
            {brand.initial}
          </Text>
        </View>

        <Text style={[type.h1, { fontSize: 26, marginTop: 18 }]}>{brand.name}</Text>
        {/* Le nom de l'APPAREIL, pas un numéro de poste inventé : c'est celui
            que le gérant a saisi dans le back-office, donc celui qu'il cherche
            quand il veut savoir quelle tablette est laquelle. */}
        <Text style={[type.eyebrow, { marginTop: 8 }]}>
          {device.device.kindLabel} · {device.device.name}
        </Text>

        {/* Points de saisie */}
        <View style={{ flexDirection: 'row', gap: 16, marginTop: 30, height: 18, alignItems: 'center' }}>
          {[0, 1, 2, 3].map((i) => {
            const filled = pin.length > i;
            return (
              <View
                key={i}
                style={{
                  width: filled ? 16 : 12,
                  height: filled ? 16 : 12,
                  borderRadius: 8,
                  backgroundColor: filled ? brand.accent : 'transparent',
                  borderWidth: filled ? 0 : 1.5,
                  borderColor: '#3a3a3a',
                }}
              />
            );
          })}
        </View>

        <View style={{ height: 30, justifyContent: 'center' }}>
          <Text
            style={{
              fontFamily: FONT,
              fontSize: 14,
              fontWeight: '600',
              color: error ? palette.red : palette.mut,
              opacity: error || busy ? 1 : 0.7,
            }}
          >
            {error ?? (busy ? 'Vérification…' : 'Saisissez votre code à 4 chiffres')}
          </Text>
        </View>

        {/* Pavé numérique — posé sur un panneau, pour la stratification
            fond → panneau → touche plutôt qu'un aplat unique. Sa largeur suit
            l'écran : 378 px sur la tablette de référence, jamais plus large
            que la fenêtre sur un téléphone de dépannage. */}
        <View
          style={{
            width: padW,
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: 12,
            marginTop: 12,
            padding: 18,
            borderRadius: 26,
            backgroundColor: '#0b0b0b',
            borderWidth: 1,
            borderColor: palette.line2,
            justifyContent: 'center',
          }}
        >
          {KEYS.map((k) => {
            if (k === 'clear') {
              return (
                <PadKey
                  key={k}
                  label="C"
                  muted
                  size={keySize}
                  onPress={() => setPin('')}
                  accessibilityLabel="Effacer"
                />
              );
            }
            if (k === 'back') {
              return (
                <PadKey key={k} label="⌫" muted size={keySize} onPress={back} accessibilityLabel="Corriger" />
              );
            }
            return <PadKey key={k} label={k} size={keySize} onPress={() => push(k)} />;
          })}
        </View>
      </Animated.View>

      {/*
        « Changer d'établissement » — discret par construction : sur un poste
        appairé c'est un geste rarissime, et le déclencher par erreur en plein
        service couperait l'encaissement. D'où le pied d'écran, le gris, et la
        confirmation qui suit.
      */}
      <View style={{ position: 'absolute', bottom: 18, alignItems: 'center', gap: 6 }}>
        <Press
          onPress={() => setConfirmUnpair(true)}
          accessibilityLabel="Changer d'établissement"
          scale={0.97}
          style={{
            paddingHorizontal: 14,
            paddingVertical: 9,
            borderRadius: R.pill,
            borderWidth: 1,
            borderColor: palette.line2,
          }}
        >
          <Text style={{ fontFamily: FONT, fontSize: 12.5, fontWeight: '600', color: '#6b6b6b' }}>
            Changer d'établissement
          </Text>
        </Press>
        <Text style={[type.mut, { color: '#4a4a4a', fontSize: 12 }]}>Snack Manager · Caisse</Text>
      </View>

      {confirmUnpair && (
        <Overlay onClose={() => setConfirmUnpair(false)} accessibilityLabel="Changer d'établissement" width={460}>
          <PanelHead title="Changer d'établissement" onClose={() => setConfirmUnpair(false)} />
          <View style={{ padding: 20, gap: 14 }}>
            <View
              style={{
                borderRadius: R.card,
                borderWidth: 1,
                borderColor: withAlpha(palette.red, 0.4),
                backgroundColor: withAlpha(palette.red, 0.1),
                padding: 14,
              }}
            >
              <Text style={{ fontFamily: FONT, fontSize: 14, lineHeight: 20, color: palette.text }}>
                <Text style={{ fontWeight: '800' }}>
                  Ce poste cessera d'encaisser pour « {brand.name} ».
                </Text>{' '}
                Il faudra saisir un nouveau code d'appairage pour le remettre en service.
              </Text>
            </View>
            <Text style={[type.mut, { lineHeight: 19 }]}>
              À ne faire qu'en cas de changement d'établissement. Pour un poste simplement figé,
              fermez et rouvrez l'application : elle repart avec son appairage.
            </Text>
            <View style={{ flexDirection: 'row', gap: 10, justifyContent: 'flex-end' }}>
              <Btn label="Annuler" kind="ghost" onPress={() => setConfirmUnpair(false)} />
              <Btn
                label="Désappairer ce poste"
                kind="danger"
                onPress={() => {
                  setConfirmUnpair(false);
                  void forgetPairedDevice().then(onUnpair);
                }}
              />
            </View>
          </View>
        </Overlay>
      )}
    </View>
  );
}

function PadKey({
  label,
  onPress,
  muted,
  size,
  compact,
  accessibilityLabel,
}: {
  label: string;
  onPress: () => void;
  muted?: boolean;
  /** Côté de la touche, calculé par l'écran depuis la largeur du pavé. */
  size: number;
  /** Pavé à 32 touches : carré plutôt que large, sinon rien ne tient. */
  compact?: boolean;
  accessibilityLabel?: string;
}) {
  return (
    <Press
      onPress={onPress}
      accessibilityLabel={accessibilityLabel ?? label}
      scale={0.94}
      style={[
        {
          width: size,
          height: compact ? size : Math.max(TOUCH_MIN, Math.round(size * 0.7)),
          minHeight: compact ? Math.round(TOUCH_MIN * 0.92) : TOUCH_MIN,
          borderRadius: R.panel,
          backgroundColor: palette.surface,
          borderWidth: 1,
          borderColor: palette.line2,
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        },
        shadow(1),
      ]}
      activeStyle={{ backgroundColor: '#212121' }}
    >
      <Sheen />
      <Text
        style={{
          fontFamily: FONT,
          color: muted ? palette.mut : palette.text,
          fontSize: compact ? Math.max(17, Math.round(size * 0.44)) : muted ? 22 : 27,
          fontWeight: '700',
          letterSpacing: -0.5,
        }}
      >
        {label}
      </Text>
    </Press>
  );
}
