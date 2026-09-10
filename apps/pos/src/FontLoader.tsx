import { useLayoutEffect } from 'react';
import { Platform } from 'react-native';
import { FontDisplay, useFonts } from 'expo-font';

const FONTS = {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Inter: { uri: require('../assets/fonts/InterVariable.ttf'), display: FontDisplay.SWAP },
};

/** Police locale, disponible hors ligne ; une erreur ne bloque jamais la caisse. */
export function usePosFonts() {
  const [loaded, error] = useFonts(FONTS);
  useLayoutEffect(() => {
    if (!loaded || Platform.OS !== 'web' || typeof document === 'undefined') return;
    // expo-font déclare la famille sans plage de graisse. Le fichier variable
    // doit porter 100–900 pour éviter un faux gras synthétique à 700/800/900.
    const style = document.getElementById('expo-generated-fonts') as HTMLStyleElement | null;
    const rules = style?.sheet?.cssRules;
    if (!rules) return;
    for (let i = 0; i < rules.length; i += 1) {
      const rule = rules.item(i);
      if (rule?.type !== CSSRule.FONT_FACE_RULE) continue;
      const face = rule as CSSFontFaceRule;
      if (face.style.fontFamily.replace(/["']/g, '') === 'Inter') {
        face.style.setProperty('font-weight', '100 900');
        face.style.setProperty('font-style', 'normal');
      }
    }
  }, [loaded]);
  return { loaded, error, ready: loaded || error !== null };
}
