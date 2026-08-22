/**
 * Bandeau de démonstration de la caisse — la sortie de secours du visiteur.
 *
 * ─── OÙ IL SE POSE, ET POURQUOI LÀ ───
 *
 * En HAUT, DANS LE FLUX, jamais en surimpression. Un bandeau flottant finit
 * toujours par recouvrir quelque chose : ici « Encaisser », le rail des
 * catégories ou le ticket. Posé dans le flux, il ne peut RIEN recouvrir — il
 * prend 44 px et rend le reste. Comme la caisse occupe exactement la fenêtre
 * (colonne flex, pas de défilement de page), il reste visible en permanence
 * sans avoir à être collant.
 *
 * Les quatre démonstrations portent la même barre, au même endroit, avec le
 * même vocabulaire (`@sm/client-core/demo/retour`). Les surfaces Expo et
 * Next.js ne partagent aucun composant : la duplication est assumée, l'écart
 * de forme ne l'est pas — quatre bandeaux différents donneraient l'impression
 * de quatre produits, alors qu'on vend une suite.
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
import { palette } from '@sm/client-core';
import { FONT } from './theme';
import { retourVitrine } from './demo-retour';

/** Hauteur de la barre. Reprise à l'identique par les trois autres surfaces. */
export const DEMO_BAR_H = 44;

/**
 * En dessous, la mention longue ne tient plus : on garde l'essentiel.
 *
 * 768 px, soit exactement le seuil `md` de Tailwind employé par le bandeau des
 * deux surfaces web : la barre change de forme au même endroit sur les quatre
 * démonstrations.
 */
const COMPACT_W = 768;

export function DemoBanner() {
  // Le mode ne bascule pas en cours de route (`?demo=1` est lu une fois) : on
  // calcule une fois pour toutes plutôt qu'à chaque rendu de la caisse.
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
 * corrige. On assigne donc l'adresse.
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
    // Plan 1 sur le canevas noir de l'application (DA §1) — et le filet doré
    // dit que cette barre est à NOUS, pas au produit qu'elle encadre.
    backgroundColor: palette.surface,
    borderBottomWidth: 1,
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
  // Retour tactile en moins de 100 ms (DA §4) : enfoncement et fond plus clair.
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
  mention: { fontFamily: FONT, fontSize: 13, fontWeight: '500', color: palette.mut, flexShrink: 1 },
});
