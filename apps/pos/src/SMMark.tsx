import type { ComponentProps } from 'react';
import { SMMark as SharedSMMark } from '@sm/ui-native';
import { useTheme } from './theme';
export { SM_PATHS } from '@sm/ui-native';

/** Adaptateur de thème ; les tracés sont partagés avec le KDS et le natif. */
export function SMMark(props: ComponentProps<typeof SharedSMMark>) {
  const { palette } = useTheme();
  return <SharedSMMark {...props} color={props.color ?? palette.text} />;
}
