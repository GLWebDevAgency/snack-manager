import { BrandSplash } from '@sm/ui-native';
import { useReducedMotion } from './ui';

export function Splash(props: { ready: boolean; onDone: () => void; deviceName?: string }) {
  const reducedMotion = useReducedMotion();
  return <BrandSplash {...props} kindLabel="Caisse" reducedMotion={reducedMotion} />;
}
