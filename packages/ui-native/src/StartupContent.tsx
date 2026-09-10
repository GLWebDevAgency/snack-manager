import { useLayoutEffect, useRef } from 'react';
import { Platform, View, type ViewProps } from 'react-native';

export const STARTUP_SKIP_ID = 'sm-startup-skip';

/** L'application continue de charger sous le démarrage, sans recevoir de gestes cachés. */
export function StartupContent({ blocked, ...props }: ViewProps & { blocked: boolean }) {
  const root = useRef<View>(null);
  useLayoutEffect(() => {
    if (Platform.OS !== 'web') return;
    const element = root.current as unknown as HTMLElement | null;
    if (!element) return;
    const previous = element.inert;
    element.inert = blocked;
    const win = element.ownerDocument.defaultView;
    const guardKeyboard = (event: KeyboardEvent) => {
      // inert protège le DOM, mais pas les raccourcis PIN enregistrés sur
      // window/document. Les bloquer avant qu'ils ne reçoivent une saisie cachée.
      event.stopImmediatePropagation();
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      event.preventDefault();
      if (event.type !== 'keydown' || event.repeat) return;
      const skip = element.ownerDocument.getElementById(STARTUP_SKIP_ID);
      if (!skip) return;
      if (event.key === 'Tab') skip.focus();
      else if (event.key === 'Escape' ||
        ((event.key === 'Enter' || event.key === ' ') && skip === element.ownerDocument.activeElement)) skip.click();
    };
    if (blocked) {
      win?.addEventListener('keydown', guardKeyboard, true);
      win?.addEventListener('keyup', guardKeyboard, true);
    }
    return () => {
      element.inert = previous;
      win?.removeEventListener('keydown', guardKeyboard, true);
      win?.removeEventListener('keyup', guardKeyboard, true);
    };
  }, [blocked]);
  return <View {...props} ref={root}
    pointerEvents={blocked ? 'none' : props.pointerEvents}
    aria-hidden={blocked || props['aria-hidden']}
    accessibilityElementsHidden={blocked || props.accessibilityElementsHidden}
    importantForAccessibility={blocked ? 'no-hide-descendants' : props.importantForAccessibility} />;
}
