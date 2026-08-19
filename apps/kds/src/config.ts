import { Platform } from 'react-native';

/**
 * Configuration de l'appareil cuisine.
 *
 * L'ÉTABLISSEMENT NE FIGURE PLUS ICI. Ce module a porté un
 * `TENANT_SLUG = 'classfood'` : l'écran cuisine savait chez qui il travaillait
 * parce que c'était compilé dedans, ce qui aurait exigé un build par
 * restaurant. La tablette l'apprend désormais à l'appairage — un code à six
 * caractères saisi une fois, contre un jeton d'appareil qui porte le tenant
 * (voir `client.ts`). Ne réintroduis pas de valeur par défaut ici : elle
 * ferait silencieusement travailler une cuisine sur les commandes d'un autre
 * restaurant, et personne ne le verrait avant le premier ticket servi.
 *
 * Reste l'URL d'API, qui est bien une propriété de l'installation. En
 * développement web, on accepte une surcharge par paramètre d'URL
 * (`?api=http://localhost:3001`), mémorisée ensuite pour survivre aux
 * rechargements de Metro.
 */

const DEFAULT_API = 'https://api-production-8949.up.railway.app';

function override(key: 'api'): string | null {
  if (Platform.OS !== 'web') return null;
  const storeKey = `sm.kds.cfg.${key}`;
  try {
    const fromQuery = new URL(globalThis.location.href).searchParams.get(key);
    if (fromQuery) {
      globalThis.localStorage?.setItem(storeKey, fromQuery);
      return fromQuery;
    }
    return globalThis.localStorage?.getItem(storeKey) ?? null;
  } catch {
    return null;
  }
}

export const API_URL = override('api') ?? DEFAULT_API;

/** Rafraîchissement du tableau (le temps réel WebSocket viendra en complément). */
export const POLL_MS = 5000;

/** Rappel sonore tant qu'un ticket reste dans « Nouveau ». */
export const REMINDER_MS = 60000;

// ─────────────────────────────────────────────────────────────
// Mise en page multi-supports — seuils consommés UNIQUEMENT par useLayout()
// ─────────────────────────────────────────────────────────────

/**
 * Le parc d'un snack est hétérogène et évolue : tablette 10" (1280×800, la
 * référence), tablette 12-13" (2000×1200), écran de comptoir ou mural 24"
 * (1920×1080), et un téléphone en dépannage. Toutes les décisions de dimension
 * partent donc de la fenêtre réelle, jamais d'une largeur de maquette figée.
 *
 * Un seul module (`useLayout`) lit ces seuils ; aucun composant ne compare une
 * largeur lui-même.
 */

/**
 * En dessous : mode COMPACT — une seule liste et des onglets par statut.
 *
 * 900 px est le point où trois colonnes tombent sous ~280 px : en dessous, la
 * carte doit tronquer le nom du client ou replier le minuteur sous le titre,
 * c'est-à-dire dégrader l'information la plus lue. Mieux vaut une colonne
 * entière et un onglet à toucher. (La spec KDS prévoyait déjà ce mode pour le
 * téléphone ; il couvre désormais aussi la petite tablette en portrait.)
 */
export const TABS_MAX_WIDTH = 900;

/**
 * En dessous : le panneau « À lancer » se replie automatiquement.
 *
 * Les colonnes priment — c'est le cœur du service. Le seuil est DÉDUIT, pas
 * choisi : le panneau n'a le droit d'apparaître que si les trois colonnes
 * gardent ≥ 320 px, la largeur à laquelle une carte affiche encore le nom du
 * client sans le tronquer.
 *
 *   3 × 320 (colonnes) + 2 × 12 (gouttières) + 216 (panneau) + 12 + 2 × 14
 *   (marges du plateau) ≈ 1240 px
 *
 * La tablette de référence (1280) reste donc exactement telle qu'elle était :
 * panneau 224 px, colonnes 330 px. En dessous de 1240, l'espace revient aux
 * colonnes et la bascule « À lancer » disparaît avec le panneau.
 */
export const ALLDAY_MIN_SCREEN = 1240;

/** Largeur du panneau « À lancer » : proportion de la fenêtre, entre bornes. */
export const ALLDAY_PANEL = { ratio: 0.175, min: 216, max: 340 } as const;

/**
 * En dessous : barre haute allégée. Les trois compteurs colorés cèdent la place
 * (les en-têtes de colonnes portent déjà le même chiffre) ; le total « Actives »,
 * l'horloge et l'état réseau restent toujours visibles.
 *
 * Le seuil est exprimé À L'ÉCHELLE DE RÉFÉRENCE : `useLayout` le multiplie par
 * l'échelle courante, puisqu'une barre dont tout le contenu a grossi de 28 %
 * réclame d'autant plus de largeur pour tenir sur une ligne.
 */
export const DENSE_TOOLBAR_MAX_WIDTH = 1380;

/**
 * Échelle typographique — calculée sur le PETIT côté de la fenêtre.
 *
 * Le petit côté approxime la classe physique de l'appareil et ne change pas
 * quand on pivote : une 10" lit pareil en 1280×800 et en 800×1280, alors qu'un
 * mural 1920×1080 doit vraiment grossir (il est lu à 2-4 m, depuis le piano).
 *
 *   échelle = 1 + (petitCôté − 800) / 1000, bornée [1 ; 1,5]
 *
 * soit 800 → 1,00 (référence 10") · 1080 → 1,28 (24" mural) · 1200 → 1,40
 * (13") · ≥ 1300 → 1,50 (plafond). Le plancher est 1 : on ne rapetisse jamais
 * sous la référence, sans quoi le téléphone de dépannage deviendrait illisible.
 */
export const SCALE_REF_SHORT = 800;
export const SCALE_SPAN = 1000;
export const SCALE_MAX = 1.5;

/**
 * Sur-amplification des éléments lus DE LOIN (n° de retrait, minuteur,
 * « SANS OIGNONS », en-têtes de colonne). Ce sont eux qui décident si l'écran
 * est utilisable depuis la friteuse : ils grossissent 35 % plus vite que le
 * texte courant. À 1920×1080 : n° 32 → 44 px, minuteur 22 → 30 px.
 */
export const FAR_BOOST = 1.35;

/**
 * Largeur de confort d'une carte. Une colonne plus étroite ne peut pas porter
 * une typo agrandie sans tronquer : l'échelle est alors bridée par la colonne,
 * pas par la taille de l'écran (cas d'un grand écran en portrait).
 */
export const COLUMN_COMFORT_WIDTH = 300;

/** Hauteur minimale d'un bouton d'action (charte : ≥ 56 px sur POS/KDS). */
export const ACTION_MIN_HEIGHT = 56;

// ─── Clés de stockage local ───
export const KEY_SESSION = 'sm.kds.session.v1';
export const KEY_BOARD = 'sm.kds.board.v1';
export const KEY_DELIVERED = 'sm.kds.delivered.v1';
export const KEY_PREFS = 'sm.kds.prefs.v1';
