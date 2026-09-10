import { forwardRef, useCallback, useEffect, useRef } from 'react';
import { Animated, Easing, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path, type PathProps } from 'react-native-svg';
import { SM_PATHS } from './SMMark';
import { BRAND_FONT as FONT } from './brand';

// Animated injecte `collapsable` pour les Views natives ; ce n'est pas un
// attribut SVG DOM. Conserver le vrai ref Path pour la mise à jour du tracé.
const AnimationPath = forwardRef<Path, PathProps & { collapsable?: boolean }>(function AnimationPath({ collapsable, ...props }, ref) {
  return <Path ref={ref} {...props} {...(Platform.OS === 'web' ? {} : { collapsable })} />;
});
const AnimatedPath = Animated.createAnimatedComponent(AnimationPath);
const ease = Easing.bezier(0.2, 0.8, 0.2, 1);
const spring = Easing.bezier(0.34, 1.56, 0.64, 1);
// Longueur du tracé original (le pathLength normalisé du SVG web n'existe pas en RN).
const TICKET_LENGTH = 101.553;

/** Le démarrage accompagne la restauration réelle, sans ajouter de délai au poste prêt. */
export function BrandSplash({ ready, onDone, deviceName = 'Poste 1', kindLabel = 'Caisse', reducedMotion = false }: {
  kindLabel?: string;
  reducedMotion?: boolean;
  ready: boolean;
  onDone: () => void;
  deviceName?: string;
}) {
  const reduced = reducedMotion;
  const complete = useRef(onDone);
  complete.current = onDone;
  const done = useRef(false);
  const opacity = useRef(new Animated.Value(1)).current;
  const outline = useRef(new Animated.Value(0)).current;
  const top = useRef(new Animated.Value(0)).current;
  const patty = useRef(new Animated.Value(0)).current;
  const bottom = useRef(new Animated.Value(0)).current;
  const bolt = useRef(new Animated.Value(0)).current;
  const word = useRef(new Animated.Value(0)).current;
  const subtitle = useRef(new Animated.Value(0)).current;
  const progress = useRef(new Animated.Value(0)).current;
  const skip = useRef(new Animated.Value(0)).current;
  const finish = useCallback(() => {
    if (done.current) return;
    done.current = true;
    complete.current();
  }, []);

  useEffect(() => {
    const values = [outline, top, patty, bottom, bolt, word, subtitle, progress, skip];
    if (reduced) {
      values.forEach((value) => value.setValue(1));
      return;
    }
    const enter = (value: Animated.Value, delay: number, duration: number, easing = ease, native = true) =>
      Animated.timing(value, { toValue: 1, delay, duration, easing, useNativeDriver: native && Platform.OS !== 'web' });
    const animation = Animated.parallel([
      enter(outline, 150, 850, ease, false),
      enter(top, 700, 500, spring), enter(patty, 840, 500, spring), enter(bottom, 980, 500, spring),
      enter(bolt, 1220, 380, spring), enter(word, 1300, 600), enter(subtitle, 1650, 500),
      enter(progress, 1350, 1150), enter(skip, 1800, 500),
    ]);
    animation.start();
    return () => animation.stop();
  }, [reduced, outline, top, patty, bottom, bolt, word, subtitle, progress, skip]);

  useEffect(() => {
    if (!ready || done.current) return;
    [outline, top, patty, bottom, bolt, word, subtitle, progress, skip].forEach((value) => value.setValue(1));
    const animation = Animated.timing(opacity, { toValue: 0, duration: 200, easing: ease, useNativeDriver: Platform.OS !== 'web' });
    animation.start(({ finished }) => { if (finished) finish(); });
    return () => animation.stop();
  }, [ready, opacity, finish, outline, top, patty, bottom, bolt, word, subtitle, progress, skip]);

  const layers = [
    { path: SM_PATHS.top, color: '#ffffff', value: top },
    { path: SM_PATHS.patty, color: '#c9a15a', value: patty },
    { path: SM_PATHS.bot, color: '#ffffff', value: bottom },
  ];
  return <Animated.View style={[StyleSheet.absoluteFill, { zIndex: 1000, backgroundColor: '#000000', opacity }]}>
    <Pressable onPress={finish} accessibilityRole="button" accessibilityLabel="Passer l’animation de démarrage"
      style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
      <View style={{ alignItems: 'center', gap: 26, pointerEvents: 'none' }} accessible={false}>
        <View style={{ width: 128, height: 128 }}>
          <Svg width={128} height={128} viewBox="0 0 32 32" style={StyleSheet.absoluteFill}>
            <AnimatedPath d={SM_PATHS.ticket} fill="none" stroke="#ffffff" strokeWidth={2.1}
              strokeLinecap="round" strokeLinejoin="round" strokeDasharray={[TICKET_LENGTH]}
              strokeDashoffset={outline.interpolate({ inputRange: [0, 1], outputRange: [TICKET_LENGTH, 0] })} />
          </Svg>
          {layers.map(({ path, color, value }) => <Animated.View key={path} style={[StyleSheet.absoluteFill, {
            opacity: value, transform: [{ translateY: value.interpolate({ inputRange: [0, 1], outputRange: [-12, 0] }) }],
          }]}><Svg width={128} height={128} viewBox="0 0 32 32"><Path d={path} fill={color} /></Svg></Animated.View>)}
          <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ scale: bolt }] }]}>
            <Svg width={128} height={128} viewBox="0 0 32 32"><Path d={SM_PATHS.bolt} fill="#000000" stroke="#000000" strokeWidth={0.45} strokeLinejoin="round" /></Svg>
          </Animated.View>
        </View>
        <View style={{ overflow: 'hidden', paddingHorizontal: 4 }}>
          <Animated.View style={{ transform: [{ translateY: word.interpolate({ inputRange: [0, 1], outputRange: [37, 0] }) }] }}>
            <Text style={{ fontFamily: FONT, color: '#ffffff', fontSize: 30, lineHeight: 33, fontWeight: '800', letterSpacing: -0.9 }}>
              Snack <Text style={{ color: '#c9a15a' }}>Manager</Text>
            </Text>
          </Animated.View>
        </View>
        <Animated.Text style={{ fontFamily: FONT, color: '#6b6b6b', fontSize: 11.5, fontWeight: '600', letterSpacing: 1.6, textTransform: 'uppercase', opacity: subtitle }}>
          {kindLabel} · {deviceName}
        </Animated.Text>
        <View style={{ width: 160, height: 2, borderRadius: 2, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.08)', marginTop: 6 }}>
          <Animated.View style={{ width: 160, height: 2, backgroundColor: '#c9a15a', transform: [
            { translateX: -80 }, { scaleX: progress }, { translateX: 80 },
          ] }} />
        </View>
      </View>
      <Animated.Text style={{ position: 'absolute', bottom: 22, fontFamily: FONT, fontSize: 12, fontWeight: '600', color: '#555555', opacity: skip }}>
        Toucher pour passer
      </Animated.Text>
    </Pressable>
  </Animated.View>;
}
