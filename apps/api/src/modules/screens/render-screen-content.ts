import { tenancy } from '@sm/domain';
import {
  SCENE_DURATION_DEFAULT_MS,
  SCENE_DURATION_MAX_MS,
  SCREEN_DAILY_RELOAD_HOUR,
  SCREEN_POLL_INTERVAL_MS,
  SCREEN_SERVICE_LABELS,
  RESTAURANT_TZ,
  isServedAt,
  logoPour,
  masquePourFond,
  type ScreenContent,
  type ScreenScene,
  type ScreenScenePayload,
  type ScreenService,
  type ScreenPreviewService,
} from '@sm/contracts';
import { contentHashOf } from './content-hash';
import { currentService, nextOpeningOf, serviceHoursOf } from './daypart';
import type { BoardProduct, BoardSnapshot } from './menu-board.repository';
import { paginate, toScreenProduct, toScreenPromo } from './screen-content.view';
import type { StoredScreen } from './screens.repository';

/**
 * Résolution du contenu d'un écran — fonction PURE.
 *
 * Aucune base, aucune horloge globale, aucune injection : l'instant est un
 * argument. C'est ce qui permet de vérifier le dayparting midi / soir / fermé
 * en quelques millisecondes plutôt qu'en attendant 18 h, et de prouver que
 * l'empreinte de contenu ne bouge pas toute seule.
 */

/**
 * Un écran désactivé ne s'éteint pas : il repasse sur la plaque de marque.
 *
 * Couper la réponse serait pire — l'écran rejouerait indéfiniment le menu mis
 * en cache, et le gérant croirait avoir éteint quelque chose qui tourne encore.
 */
function standbyScene(snapshot: BoardSnapshot): ScreenScenePayload {
  return {
    id: 'standby',
    kind: 'custom',
    title: snapshot.identity.name,
    subtitle: null,
    durationMs: SCENE_DURATION_MAX_MS,
    products: [],
    promos: [],
    nextOpening: null,
  };
}

/** Carte vide (établissement qui démarre) : la marque plutôt qu'un écran noir. */
function fallbackScene(snapshot: BoardSnapshot): ScreenScenePayload {
  return {
    id: 'brand',
    kind: 'custom',
    title: snapshot.identity.name,
    subtitle: 'Carte en cours de préparation',
    durationMs: SCENE_DURATION_DEFAULT_MS,
    products: [],
    promos: [],
    nextOpening: null,
  };
}

/**
 * Hors service : une seule scène, qui dit quand on rouvre.
 *
 * C'est l'écran que voit le passant derrière la vitrine à 15 h ou à 23 h. Lui
 * rejouer la carte serait une invitation à pousser une porte fermée.
 */
function closedScene(hours: tenancy.ServiceHours, now: Date): ScreenScenePayload {
  const nextOpening = nextOpeningOf(hours, now);
  return {
    id: 'closed',
    kind: 'closed',
    title: 'Fermé',
    subtitle: nextOpening
      ? `${nextOpening.dayLabel} · ${nextOpening.windows.join(' · ')}`
      : 'Réouverture prochainement',
    durationMs: SCENE_DURATION_MAX_MS,
    products: [],
    promos: [],
    nextOpening,
  };
}

/** Produits d'une catégorie, dans l'ordre de la carte, filtrés par le service. */
function groupByCategory(
  products: readonly BoardProduct[],
  service: 'lunch' | 'dinner',
): Map<string, BoardProduct[]> {
  const grouped = new Map<string, BoardProduct[]>();
  for (const product of products) {
    // Produit « Non rattaché » (orphelin d'une catégorie supprimée) : jamais
    // exposé au client, exactement comme sur la commande en ligne.
    if (!product.categoryId) continue;
    if (!isServedAt(product.tags, service)) continue;
    const list = grouped.get(product.categoryId) ?? [];
    list.push(product);
    grouped.set(product.categoryId, list);
  }
  return grouped;
}

/** Une scène qui déborde devient plusieurs pages numérotées (« 2 / 3 »). */
function paged(
  scene: ScreenScene,
  key: string,
  title: string,
  products: readonly BoardProduct[],
): ScreenScenePayload[] {
  const pages = paginate(products);
  return pages.map((page, index) => ({
    id: pages.length > 1 ? `${key}-${index + 1}` : key,
    kind: scene.kind,
    title,
    subtitle: pages.length > 1 ? `${index + 1} / ${pages.length}` : null,
    durationMs: scene.durationMs,
    products: page.map(toScreenProduct),
    promos: [],
    nextOpening: null,
  }));
}

function resolvePlaylist(
  playlist: readonly ScreenScene[],
  snapshot: BoardSnapshot,
  service: 'lunch' | 'dinner',
): ScreenScenePayload[] {
  const byCategory = groupByCategory(snapshot.products, service);
  const byId = new Map(snapshot.products.map((p) => [p.id, p]));
  const categoryNames = new Map(snapshot.categories.map((c) => [c.id, c.name]));
  const scenes: ScreenScenePayload[] = [];

  playlist.forEach((scene, index) => {
    const key = `${scene.kind}-${index}`;

    if (scene.kind === 'promo') {
      // Aucune offre active : la scène disparaît de la boucle. Un panneau
      // « Offres du moment » vide ferait douter de tout le reste de l'écran.
      if (snapshot.promos.length === 0) return;
      scenes.push({
        id: key,
        kind: 'promo',
        title: scene.title ?? 'Offres du moment',
        subtitle: null,
        durationMs: scene.durationMs,
        products: [],
        promos: snapshot.promos.map(toScreenPromo),
        nextOpening: null,
      });
      return;
    }

    if (scene.kind === 'category') {
      if (!scene.categoryId) return;
      const products = byCategory.get(scene.categoryId) ?? [];
      // Catégorie vide (ou vidée par le dayparting) : omise.
      if (products.length === 0) return;
      const title = scene.title ?? categoryNames.get(scene.categoryId) ?? 'Notre carte';
      scenes.push(...paged(scene, key, title, products));
      return;
    }

    // `featured` et `custom` : une sélection explicite de produits. Les ids
    // périmés (produit supprimé depuis) sont ignorés plutôt que de casser la
    // scène — un écran ne doit jamais tomber sur une donnée obsolète.
    const products = scene.productIds
      .map((id) => byId.get(id))
      .filter((p): p is BoardProduct => p !== undefined)
      .filter((p) => isServedAt(p.tags, service));

    if (scene.kind === 'featured') {
      if (products.length === 0) return;
      scenes.push(...paged(scene, key, scene.title ?? 'La sélection', products));
      return;
    }

    // Un panneau libre vaut par son titre : il reste affiché même sans produit.
    scenes.push({
      id: key,
      kind: 'custom',
      title: scene.title ?? snapshot.identity.name,
      subtitle: null,
      durationMs: scene.durationMs,
      products: products.map(toScreenProduct),
      promos: [],
      nextOpening: null,
    });
  });

  return scenes;
}

/**
 * Heure du rechargement de nuit, décalée écran par écran.
 *
 * Le décalage n'est pas une coquetterie : dans une salle à quatre écrans sur le
 * même wifi, quatre rechargements simultanés à 4 h 00 pile se disputent la
 * bande passante et l'un d'eux repart sur un cache vide.
 */
function dailyReloadAt(now: Date, screenId: string): string {
  let jitter = 0;
  for (const char of screenId) jitter = (jitter * 31 + char.charCodeAt(0)) % 60;

  const minutes = SCREEN_DAILY_RELOAD_HOUR * 60 + jitter;
  const today = tenancy.CalendarDay.from(now);
  const target = today.atMinutes(minutes);
  return (target.getTime() > now.getTime() ? target : today.plusDays(1).atMinutes(minutes))
    .toISOString();
}

export function renderScreenContent(
  screen: StoredScreen,
  snapshot: BoardSnapshot,
  now: Date,
  /** Réservé à l'aperçu authentifié. Les appels des téléviseurs n'en passent pas. */
  previewService?: ScreenPreviewService,
): ScreenContent {
  const hours = serviceHoursOf(snapshot.identity.hours);
  const service: ScreenService = screen.active
    ? (previewService ?? currentService(hours, now))
    : 'closed';

  let scenes: ScreenScenePayload[];
  // DÉFENSE EN PROFONDEUR, et non un chemin nominal.
  //
  // Un écran désactivé n'arrive PAS jusqu'ici : `requirePairedScreen` refuse
  // l'appel de la clé HDMI avant que cette fonction ne soit atteinte, et c'est
  // le bon endroit pour le faire — un écran révoqué ne doit obtenir aucune
  // réponse, pas une jolie veille.
  //
  // La branche reste néanmoins, et volontairement : cette fonction est PURE et
  // publique, un appelant futur pourrait l'atteindre sans passer par le garde.
  // Mieux vaut alors un écran noir qu'une carte de prix affichée en salle sur
  // un appareil qu'on croyait coupé.
  if (!screen.active) {
    scenes = [standbyScene(snapshot)];
  } else if (service === 'closed') {
    scenes = [closedScene(hours, now)];
  } else {
    scenes = resolvePlaylist(screen.playlist, snapshot, service);
    if (scenes.length === 0) scenes = [fallbackScene(snapshot)];
  }

  /**
   * Le masque EFFECTIF : la variante de fond est appliquée ICI, une fois, et
   * l'écran reçoit un masque qu'il résout comme la vitrine. Il n'a pas à
   * connaître la logique du fond — une clé HDMI n'a personne pour s'apercevoir
   * qu'elle l'applique autrement que le back-office.
   */
  const masque = masquePourFond(snapshot.identity.brand, screen.theme);

  /**
   * Ce qui compte pour l'empreinte : ce qui se VOIT. L'horodatage de génération
   * et l'heure du rechargement de nuit en sont exclus — sinon l'empreinte
   * changerait à chaque seconde et l'écran se repeindrait en boucle.
   */
  const painted = {
    screenId: screen.id,
    name: screen.name,
    orientation: screen.orientation,
    theme: screen.theme,
    scenography: screen.scenography,
    masque,
    brand: {
      slug: snapshot.identity.slug,
      name: snapshot.identity.name,
      // Dérivés du masque EFFECTIF : un logo dessiné pour fond sombre ne se
      // pose pas sur « Fond clair ».
      logoUrl: logoPour(masque, 'mark'),
      accent: masque.palette.accent,
    },
    service,
    serviceLabel: SCREEN_SERVICE_LABELS[service],
    open: service !== 'closed',
    scenes,
  };

  return {
    ...painted,
    contentHash: contentHashOf(painted),
    generatedAt: now.toISOString(),
    dailyReloadAt: dailyReloadAt(now, screen.id),
    pollIntervalMs: SCREEN_POLL_INTERVAL_MS,
    timezone: RESTAURANT_TZ,
  };
}
