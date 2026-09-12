/** Icônes du kit POS/KDS ; compléments conservés uniquement sans équivalent. */
import Svg, { Path, SvgXml } from 'react-native-svg';
import { Platform, type StyleProp, type ViewStyle } from 'react-native';
import { renderIcon, resolveIconName } from '@sm/design-icons';

const PATHS: Record<string, string> = {
  'bellOff': 'M13.7 21a1.9 1.9 0 01-3.4 0M18.6 13A17 17 0 0118 8a6 6 0 00-9.3-5M6.3 6.3A6 6 0 006 8c0 7-3 9-3 9h14M3 3l18 18',
  "sandwich": "M3 8l9-4 9 4-9 4-9-4zM3 8v3l9 4 9-4V8M6 12.5V15l6 2.6L18 15v-2.5",
  "dog": "M4 12h16a2 2 0 010 4H4a2 2 0 010-4zM6 12a6 6 0 0112 0M9 10l1 2M13 10l1 2",
  "chicken": "M13 4a5 5 0 00-5 5c0 2-1 3-2.5 4S4 16 5 18s4 1 5-0.5 2-2.5 4-2.5a5 5 0 000-9zM6 18l-2 2",
  "heart": "M12 20s-7-4.5-9-9a4.5 4.5 0 018-3 4.5 4.5 0 018 3c-2 4.5-9 9-9 9z",
  "cart": "M4 5h2l2.5 11h9L20 8H7M9 20a1 1 0 100 2 1 1 0 000-2zM17 20a1 1 0 100 2 1 1 0 000-2z",
  "trash": "M5 7h14M9 7V5h6v2M6 7l1 13h10l1-13",
  "home": "M4 11l8-7 8 7v9a1 1 0 01-1 1h-4v-6H9v6H5a1 1 0 01-1-1z",
  "euro": "M15 7a5 5 0 100 10M6 10h7M6 14h7",
  "pause": "M8 5v14M16 5v14",
  "bolt": "M13 3L5 14h6l-1 7 8-11h-6z",
};

export function Icon({ name, size = 18, color, strokeWidth = 1.75, style }: {
  name: string;
  size?: number;
  color?: string;
  strokeWidth?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const canonical = resolveIconName(name);
  if (canonical) {
    return <SvgXml xml={renderIcon(canonical)} width={size} height={size}
      color={color ?? '#ffffff'} strokeWidth={strokeWidth}
      {...(Platform.OS === 'web' ? { 'aria-hidden': true as const } : { accessible: false })} style={style} />;
  }
  // Absences réelles du kit uniquement : silence, panier, corbeille, devise…
  // Une clé inconnue ne doit jamais devenir une étoile sans rapport.
  const path = Object.hasOwn(PATHS, name) ? PATHS[name] : null;
  if (!path) return null;
  return <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color ?? '#ffffff'}
    strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"
    {...(Platform.OS === 'web' ? { 'aria-hidden': true as const } : { accessible: false })} style={style}>
    <Path d={path} />
  </Svg>;
}
