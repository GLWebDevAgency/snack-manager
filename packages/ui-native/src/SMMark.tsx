/** Logo original du kit : l'éclair est un vide, y compris sur les fonds clairs. */
import { useId } from 'react';
import { Platform } from 'react-native';
import Svg, { Defs, G, Mask, Path, Rect } from 'react-native-svg';
import { BRAND_GOLD } from './brand';

export const SM_PATHS = {
  "ticket": "M 8.2 1.6 L 23.8 1.6 C 25.6 1.6 27 3 27 4.8 L 27 29.8 L 24.3 28.1 L 21.6 29.8 L 18.9 28.1 L 16.2 29.8 L 13.5 28.1 L 10.8 29.8 L 8.1 28.1 L 5 29.8 L 5 4.8 C 5 3 6.4 1.6 8.2 1.6 Z",
  "top": "M 8.6 11 C 8.6 7.4 11.9 5 16 5 C 20.1 5 23.4 7.4 23.4 11 L 23.4 11.3 C 23.4 11.9 22.9 12.4 22.3 12.4 L 9.7 12.4 C 9.1 12.4 8.6 11.9 8.6 11.3 Z",
  "patty": "M 10.8 13.5 L 21.2 13.5 C 22.4 13.5 23.4 14.5 23.4 15.7 L 23.4 18.3 C 23.4 19.5 22.4 20.5 21.2 20.5 L 10.8 20.5 C 9.6 20.5 8.6 19.5 8.6 18.3 L 8.6 15.7 C 8.6 14.5 9.6 13.5 10.8 13.5 Z",
  "bot": "M 9.7 21.8 L 22.3 21.8 C 22.9 21.8 23.4 22.3 23.4 22.9 C 23.4 24.3 20.1 25.3 16 25.3 C 11.9 25.3 8.6 24.3 8.6 22.9 C 8.6 22.3 9.1 21.8 9.7 21.8 Z",
  "bolt": "M 16.9 8.6 L 12.5 16.4 L 15.5 16.4 L 14.5 22.6 L 19.3 15 L 16.3 15 Z",
  "microBolt": "M 16.9 9.4 L 13.2 16.2 L 15.7 16.2 L 14.9 21.6 L 18.8 15 L 16.3 15 Z"
} as const;

export function SMMark({ size = 28, color, mono = false, accessible = true }: {
  size?: number;
  color?: string;
  mono?: boolean;
  accessible?: boolean;
}) {
  const id = 'sm-bolt-' + useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const ink = color ?? '#ffffff';
  const micro = size < 24;
  return <Svg width={size} height={size} viewBox="0 0 32 32"
    {...(Platform.OS === 'web'
      ? accessible ? { role: 'img', 'aria-label': 'Snack Manager' } : { 'aria-hidden': true as const }
      : { accessible, accessibilityLabel: accessible ? 'Snack Manager' : undefined })}>
    <Defs>
      <Mask id={id} maskUnits="userSpaceOnUse" x={0} y={0} width={32} height={32}>
        <Rect width={32} height={32} fill="white" />
        <Path d={micro ? SM_PATHS.microBolt : SM_PATHS.bolt} fill="black" stroke="black"
          strokeWidth={micro ? 0.7 : 0.45} strokeLinejoin="round" />
      </Mask>
    </Defs>
    <G mask={`url(#${id})`}>
      <Path d={SM_PATHS.ticket} fill="none" stroke={ink} strokeWidth={2.1} strokeLinejoin="round" strokeLinecap="round" />
      <Path d={SM_PATHS.top} fill={ink} />
      <Path d={SM_PATHS.patty} fill={mono || micro ? ink : BRAND_GOLD} />
      <Path d={SM_PATHS.bot} fill={ink} />
    </G>
  </Svg>;
}
