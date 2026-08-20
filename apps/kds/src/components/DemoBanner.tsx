/**
 * Bandeau de démonstration de l'écran cuisine — la sortie de secours du visiteur.
 *
 * ─── MÊME FORME, MÊME PLACE, MÊMES MOTS QUE LES TROIS AUTRES ───
 *
 * En HAUT, DANS LE FLUX, jamais en surimpression : une barre flottante
 * finirait par recouvrir « Accepter » ou « Prêt », c'est-à-dire les deux seuls
 * gestes de cet écran. Posée dans le flux elle ne peut rien recouvrir, et
 * comme le KDS occupe exactement la fenêtre, elle reste visible en permanence.
 *
 * Les 44 px qu'elle prend sont rendus aux colonnes par le moteur de mise en
 * page : `useLayout` dimensionne à partir de la fenêtre, et le plateau est en
 * `flex: 1` sous la barre. Aucune carte n'est tronquée, aucun bouton ne sort.
 *
 * Il n'apparaît QUE en démonstration : voir `demo-retour.ts` et son test.
 */
import { useMemo } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { retourVitrine } from '../demo-retour';
import { FONT, ink, palette } from '../ui';

/** Hauteur de la barre. Identique sur les quatre démonstrations. */
export const DEMO_BAR_H = 44;

/** En dessous, la mention longue ne tient plus : on garde l'essentiel. */
const COMPACT_W = 720;

export function DemoBanner() {
  // `?demo=1` est lu une fois pour la vie de la page : inutile de recalculer à
  // chaque tour d'horloge du tableau.
  const retour = useMemo(() => retourVitrine(), []);
  const { width } = useWindowDimensions();

  if (!retour) return null;
  const compact = width < COMPACT_W;

  return (
    <View style={styles.bar}>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={`${retour.libelle} — snackmanager.fr`}
        onPress={() => ouvrir(retour.href)}
        style={({ pressed }) => [styles.lien, pressed && styles.lienPresse]}
      >
        {retour.retour ? (
          <Text style={styles.fleche} accessible={false}>
            ←
          </Text>
        ) : null}
        <Text style={styles.libelle} numberOfLines={1}>
          {retour.libelle}
        </Text>
      </Pressable>

      <View style={styles.droite}>
        <View style={styles.tuile}>
          <Text style={styles.tuileTexte}>SM</Text>
        </View>
        {compact ? null : (
          <Text style={styles.marque} numberOfLines={1}>
            {retour.marque}
          </Text>
        )}
        <Text style={styles.mention} numberOfLines={1}>
          {compact ? retour.mentionCourte : retour.mention}
        </Text>
      </View>
    </View>
  );
}

/**
 * Navigation DANS LE MÊME ONGLET.
 *
 * `Linking.openURL` ouvrirait un onglet de plus sur le web : le visiteur
 * resterait exactement là où il est — c'est-à-dire perdu, le défaut qu'on
 * corrige.
 */
function ouvrir(href: string): void {
  if (Platform.OS !== 'web') return;
  const location = (globalThis as { location?: { assign?: (url: string) => void } }).location;
  location?.assign?.(href);
}

const styles = StyleSheet.create({
  bar: {
    height: DEMO_BAR_H,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 14,
    backgroundColor: palette.surface,
    borderBottomWidth: 1,
    // Le filet doré dit que cette barre est à NOUS, pas au produit qu'elle
    // encadre — et il évite deux plans de même valeur côte à côte (DA §1).
    borderBottomColor: 'rgba(201,161,90,0.38)',
  },
  lien: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 32,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  lienPresse: {
    transform: [{ scale: 0.97 }],
    backgroundColor: 'rgba(201,161,90,0.18)',
    borderColor: 'rgba(201,161,90,0.55)',
  },
  fleche: { fontFamily: FONT, fontSize: 15, lineHeight: 17, color: palette.gold },
  libelle: {
    fontFamily: FONT,
    fontSize: 13.5,
    fontWeight: '700',
    letterSpacing: -0.01,
    color: palette.text,
  },
  droite: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 },
  tuile: {
    width: 22,
    height: 22,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.gold,
  },
  tuileTexte: {
    fontFamily: FONT,
    fontSize: 10.5,
    fontWeight: '800',
    letterSpacing: 0.2,
    color: '#12100d',
  },
  marque: { fontFamily: FONT, fontSize: 13, fontWeight: '700', color: palette.text },
  mention: { fontFamily: FONT, fontSize: 13, fontWeight: '500', color: ink.dim, flexShrink: 1 },
});
