import { z } from 'zod';
// ⚠️ `import type` uniquement : `index.ts` réexporte ce fichier ET
// `mediatheque.ts` ; un import de valeurs créerait un cycle CommonJS.
import type { PointInteret } from './mediatheque';

// ─────────────────────────────────────────────────────────────
// Menu Board — les écrans TV accrochés en salle
//
// Le contenu affiché existe déjà en base (catégories, produits, promos,
// horaires) : ce module n'est qu'une VUE de plus, pas un produit à ressaisir.
// Le restaurateur change un prix dans le back-office, l'écran suit.
//
// Rappel : tous les montants sont en CENTIMES (int).
// ─────────────────────────────────────────────────────────────

// ─── Appairage ───

/**
 * Alphabet du code d'appairage : 24 lettres + 8 chiffres, soit exactement 32
 * symboles.
 *
 * `I`, `O`, `0` et `1` en sont retirés — le gérant lit le code sur un téléviseur
 * à trois mètres puis le recopie sur son téléphone, et un `O` pris pour un `0`
 * coûte un appel au support. Trente-deux symboles, c'est aussi une puissance de
 * deux : un octet aléatoire se réduit modulo 32 sans biais statistique.
 */
export const PAIRING_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export const PAIRING_CODE_LENGTH = 6;

/**
 * Durée de vie du code : un quart d'heure, le temps de descendre de l'escabeau
 * et d'ouvrir le back-office. Au-delà, un code affiché sur un écran de salle
 * devient un secret exposé au public — il faut le régénérer.
 */
export const PAIRING_CODE_TTL_MS = 15 * 60_000;

/** 32 octets aléatoires → 43 caractères base64url. */
export const DEVICE_TOKEN_BYTES = 32;

/** Le code est-il fait des seuls symboles non ambigus, à la bonne longueur ? */
export function isPairingCodeShape(code: string): boolean {
  if (code.length !== PAIRING_CODE_LENGTH) return false;
  for (const char of code) {
    if (!PAIRING_CODE_ALPHABET.includes(char)) return false;
  }
  return true;
}

// ─── Réglages d'un écran ───

/** Les écrans verticaux sont courants en salle : les deux sens sont natifs. */
export const SCREEN_ORIENTATIONS = ['landscape', 'portrait'] as const;
export const ScreenOrientationSchema = z.enum(SCREEN_ORIENTATIONS);
export type ScreenOrientation = z.infer<typeof ScreenOrientationSchema>;

export const SCREEN_ORIENTATION_LABELS: Record<ScreenOrientation, string> = {
  landscape: 'Paysage',
  portrait: 'Portrait',
};

export const SCREEN_THEMES = ['brand', 'dark', 'light'] as const;
export const ScreenThemeSchema = z.enum(SCREEN_THEMES);
export type ScreenTheme = z.infer<typeof ScreenThemeSchema>;

export const SCREEN_THEME_LABELS: Record<ScreenTheme, string> = {
  brand: 'Couleurs du restaurant',
  dark: 'Fond noir',
  light: 'Fond clair',
};

// ─── Scènes ───

/**
 * `category` : une catégorie entière · `promo` : les offres du moment ·
 * `featured` : une sélection de produits · `custom` : un panneau libre.
 *
 * La scène `promo` ne cite aucune promotion : elle résout les offres ACTIVES à
 * l'instant de l'affichage. Sans ça, activer une promo obligerait à rouvrir la
 * playlist de chaque écran.
 */
export const SCENE_KINDS = ['category', 'promo', 'featured', 'custom'] as const;
export const SceneKindSchema = z.enum(SCENE_KINDS);
export type SceneKind = z.infer<typeof SceneKindSchema>;

/**
 * Rythme d'une scène. On regarde l'écran debout, dans la file, 10 à 30
 * secondes : en dessous de 4 s on ne lit rien, au-delà d'une minute l'écran
 * paraît figé (et le client croit à une panne).
 */
export const SCENE_DURATION_DEFAULT_MS = 10_000;
export const SCENE_DURATION_MIN_MS = 4_000;
export const SCENE_DURATION_MAX_MS = 60_000;

/** La scène des offres passe un peu plus vite : deux ou trois lignes suffisent. */
export const PROMO_SCENE_DURATION_MS = 8_000;

/**
 * Lignes de prix par scène — plafond dur.
 *
 * À deux ou quatre mètres, au-delà de huit lignes la typographie descend sous
 * le seuil de lecture. Une catégorie plus longue est donc découpée en pages
 * successives par le serveur : l'écran affiche, il ne pagine pas.
 */
export const SCENE_MAX_LINES = 8;

export const ScreenSceneSchema = z
  .object({
    kind: SceneKindSchema,
    /** Requis pour `category`. */
    categoryId: z.string().min(1).nullish(),
    /** Requis pour `featured`. Ignoré ailleurs. */
    productIds: z.array(z.string().min(1)).default([]),
    /** Titre affiché — à défaut, le nom de la catégorie. */
    title: z.string().trim().max(60).nullish(),
    durationMs: z
      .number()
      .int()
      .min(SCENE_DURATION_MIN_MS)
      .max(SCENE_DURATION_MAX_MS)
      .default(SCENE_DURATION_DEFAULT_MS),
  })
  .superRefine((scene, ctx) => {
    if (scene.kind === 'category' && !scene.categoryId) {
      ctx.addIssue({
        code: 'custom',
        path: ['categoryId'],
        message: 'Une scène « catégorie » doit désigner une catégorie',
      });
    }
    if (scene.kind === 'featured' && scene.productIds.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['productIds'],
        message: 'Une scène « sélection » doit contenir au moins un produit',
      });
    }
    if (scene.kind === 'custom' && !scene.title) {
      ctx.addIssue({
        code: 'custom',
        path: ['title'],
        message: 'Un panneau libre doit porter un titre',
      });
    }
  });
export type ScreenScene = z.infer<typeof ScreenSceneSchema>;

// ─── DTO back-office ───

export const ScreenCreateSchema = z.object({
  name: z.string().trim().min(1, 'Donnez un nom à cet écran').max(60),
  orientation: ScreenOrientationSchema.default('landscape'),
  theme: ScreenThemeSchema.default('brand'),
  /**
   * Absente à la création : l'API génère une playlist par défaut depuis la
   * carte. Le restaurateur ne configure RIEN pour que l'écran fonctionne.
   */
  playlist: z.array(ScreenSceneSchema).optional(),
});
export type ScreenCreate = z.infer<typeof ScreenCreateSchema>;

export const ScreenUpdateSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  orientation: ScreenOrientationSchema.optional(),
  theme: ScreenThemeSchema.optional(),
  playlist: z.array(ScreenSceneSchema).optional(),
  active: z.boolean().optional(),
});
export type ScreenUpdate = z.infer<typeof ScreenUpdateSchema>;

// ─── DTO écran ───

export const PairScreenSchema = z.object({
  pairingCode: z
    .string()
    .trim()
    .min(1, "Saisissez le code affiché à l'écran")
    .max(32)
    .toUpperCase(),
});
export type PairScreen = z.infer<typeof PairScreenSchema>;

/**
 * `?token=…` des routes écran.
 *
 * Typé `string` explicitement : Express interprète `?token[$ne]=x` comme un
 * objet, qui deviendrait un opérateur Mongo si on le passait tel quel au filtre.
 */
export const ScreenTokenQuerySchema = z.object({
  token: z.string().min(1).max(200),
});
export type ScreenTokenQuery = z.infer<typeof ScreenTokenQuerySchema>;

// ─── Cadence de terrain ───

/**
 * Cadence du battement de cœur — qui sert AUSSI de sonde de fraîcheur : la
 * réponse porte le `contentHash`. L'écran ne retélécharge le contenu que si
 * l'empreinte a bougé, ce qui tient sur le wifi fatigué d'un snack.
 */
export const SCREEN_POLL_INTERVAL_MS = 60_000;

/** Sans nouvelle depuis ce délai, le back-office affiche « écran hors ligne ». */
export const SCREEN_OFFLINE_AFTER_MS = 15 * 60_000;

/**
 * Rechargement quotidien de la page, garde-fou contre les fuites d'un
 * navigateur de clé HDMI qui tourne douze heures par jour. Aux heures creuses :
 * aucun snack ne sert à 4 h du matin.
 */
export const SCREEN_DAILY_RELOAD_HOUR = 4;

// ─── Contenu renvoyé à l'écran ───

/** Service en cours, déduit des horaires réels du tenant (Europe/Paris). */
export const SCREEN_SERVICES = ['lunch', 'dinner', 'closed'] as const;
export const ScreenServiceSchema = z.enum(SCREEN_SERVICES);
export type ScreenService = z.infer<typeof ScreenServiceSchema>;

export const SCREEN_SERVICE_LABELS: Record<ScreenService, string> = {
  lunch: 'Service du midi',
  dinner: 'Service du soir',
  closed: 'Fermé',
};

/**
 * Dayparting sans nouvelle saisie : un produit étiqueté « soir » disparaît de
 * l'écran au service du midi, et réciproquement.
 *
 * On réutilise les `tags` du produit plutôt que d'inventer un champ. Le
 * restaurateur pose un mot-clé qu'il comprend et l'écran suit l'heure réelle ;
 * un produit sans étiquette de service reste affiché toute la journée, ce qui
 * est le cas de l'immense majorité de la carte.
 */
export const DAYPART_TAGS: Record<'lunch' | 'dinner', readonly string[]> = {
  lunch: ['midi', 'lunch', 'déjeuner', 'dejeuner'],
  dinner: ['soir', 'dinner', 'dîner', 'diner'],
};

/** Ce produit est-il servi pendant ce service ? Non étiqueté ⇒ toujours servi. */
export function isServedAt(tags: readonly string[], service: 'lunch' | 'dinner'): boolean {
  const normalized = tags.map((t) => t.trim().toLowerCase());
  const lunch = normalized.some((t) => DAYPART_TAGS.lunch.includes(t));
  const dinner = normalized.some((t) => DAYPART_TAGS.dinner.includes(t));
  if (!lunch && !dinner) return true;
  return service === 'lunch' ? lunch : dinner;
}

export interface ScreenBrand {
  slug: string;
  name: string;
  logoUrl: string | null;
  /** Couleur d'accent du restaurant — seul levier de personnalisation. */
  accent: string;
}

export interface ScreenProduct {
  id: string;
  name: string;
  description: string;
  /** Prix affichable, déjà formaté : « 8,50 € » ou « 8,50 – 12,00 € ». */
  priceLabel: string;
  /** Centimes — le plus bas si le produit a des variantes. */
  priceCents: number;
  /** Centimes — égal à `priceCents` hors fourchette. */
  priceMaxCents: number;
  photoUrl: string | null;
  /**
   * OÙ RECADRER LA PHOTO — l'écran de salle est la surface la plus large
   * (16:9) et donc celle qui coupe le plus. Sans ce point, elle centre son
   * recadrage et tranche le plat ailleurs que la vignette carrée de la caisse,
   * sur le même cliché. `null` : photo héritée ou absente, le centre s'applique
   * (`cadrageCss`).
   */
  photoPoint: PointInteret | null;
  isNew: boolean;
  /** L'écran grise la ligne et pose le bandeau « EN RUPTURE ». */
  outOfStock: boolean;
}

export interface ScreenPromo {
  id: string;
  title: string;
  description: string;
  /** « −20 % », « −2,50 € », « Offert ». */
  label: string;
}

/** Prochain service assuré — de quoi écrire « Demain · 11:30 – 14:30 ». */
export interface ScreenNextOpening {
  /** « Demain », « Mardi ». */
  dayLabel: string;
  /** AAAA-MM-JJ (heure du restaurant). */
  date: string;
  /** Toutes les plages de cette journée : « 11:30 – 14:30 ». */
  windows: string[];
  /** ISO 8601 UTC du premier service. */
  opensAt: string;
}

export interface ScreenScenePayload {
  /** Clé stable d'une résolution à l'autre — l'écran s'en sert pour ses transitions. */
  id: string;
  kind: SceneKind | 'closed';
  title: string;
  /** « 2 / 3 » quand une catégorie déborde, `null` sinon. */
  subtitle: string | null;
  durationMs: number;
  products: ScreenProduct[];
  promos: ScreenPromo[];
  /** Renseigné sur la seule scène « fermé ». */
  nextOpening: ScreenNextOpening | null;
}

/**
 * TOUT ce que l'écran doit afficher, en un seul aller-retour.
 *
 * Les libellés (prix, promotions, service, horaires) sont calculés ici : une
 * règle recopiée dans le front finit toujours par diverger de celle de l'API,
 * et un écran de salle n'a personne pour s'apercevoir de l'écart.
 */
export interface ScreenContent {
  screenId: string;
  name: string;
  orientation: ScreenOrientation;
  theme: ScreenTheme;
  brand: ScreenBrand;
  service: ScreenService;
  serviceLabel: string;
  /** Le restaurant sert-il à cet instant. */
  open: boolean;
  scenes: ScreenScenePayload[];
  /**
   * Empreinte du CONTENU seul — ni horodatage, ni heure de rechargement.
   * L'écran compare, et ne repeint que si elle a bougé.
   */
  contentHash: string;
  /** ISO 8601 UTC. */
  generatedAt: string;
  /** ISO 8601 UTC du rechargement de nuit. */
  dailyReloadAt: string;
  pollIntervalMs: number;
  timezone: string;
}

// ─── Vue back-office ───

export interface ScreenPairingView {
  code: string;
  /** ISO 8601 UTC. */
  expiresAt: string;
  expired: boolean;
}

export interface ScreenView {
  id: string;
  name: string;
  orientation: ScreenOrientation;
  orientationLabel: string;
  theme: ScreenTheme;
  themeLabel: string;
  playlist: ScreenScene[];
  sceneCount: number;
  paired: boolean;
  /** `null` dès que l'écran est appairé : le code ne sert plus à rien. */
  pairing: ScreenPairingView | null;
  /** ISO 8601 UTC. */
  lastSeenAt: string | null;
  online: boolean;
  /** « Hors ligne depuis 20 min », « Jamais connecté ». */
  statusLabel: string;
  active: boolean;
}

/** Réponse de `POST /public/screens/pair`. */
export interface ScreenPaired {
  screenId: string;
  /** Secret long, montré UNE fois : l'écran le persiste et s'en sert ensuite. */
  deviceToken: string;
  name: string;
  orientation: ScreenOrientation;
  theme: ScreenTheme;
}

/** Réponse de `POST /public/screens/heartbeat`. */
export interface ScreenHeartbeat {
  ok: true;
  /** ISO 8601 UTC. */
  at: string;
  /** L'écran compare : différent du sien ⇒ il recharge son contenu. */
  contentHash: string;
}
