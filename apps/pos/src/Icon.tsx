import type { ComponentProps } from 'react';
import { Icon as SharedIcon } from '@sm/ui-native';
import { useTheme } from './theme';

/** Adaptateur de thème ; les tracés sont partagés avec le KDS et le natif. */
export function Icon(props: ComponentProps<typeof SharedIcon>) {
  const { palette } = useTheme();
  return <SharedIcon {...props} color={props.color ?? palette.text} />;
}
