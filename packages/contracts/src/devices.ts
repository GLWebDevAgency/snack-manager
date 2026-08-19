import { z } from 'zod';
import { PAIRING_CODE_LENGTH } from './screens';

// ─────────────────────────────────────────────────────────────
// Appareils de terrain — la caisse et l'écran cuisine
//
// Une caisse et un écran cuisine n'ont NI compte, NI mot de passe, NI adresse
// e-mail : ce sont des tablettes posées sur un comptoir, allumées le matin et
// partagées toute la journée. Jusqu'ici la caisse portait le slug du
// restaurant EN DUR dans son code (`TENANT_SLUG = 'classfood'`), ce qui
// revenait à recompiler le produit pour chaque client — donc à n'en avoir
// qu'un.
//
// La solution existait déjà à deux mètres de là : les téléviseurs de salle
// s'appairent par un code à six caractères et repartent avec un JETON
// D'APPAREIL qui porte leur établissement. On reprend ce modèle À
// L'IDENTIQUE — même alphabet, même durée de vie, même vocabulaire — plutôt
// que d'en inventer un second : un gérant qui a installé un écran TV sait
// déjà installer une caisse.
//
// Rappel : tous les montants sont en CENTIMES (int).
// ─────────────────────────────────────────────────────────────

// ─── Nature de l'appareil ───

/**
 * Les deux surfaces de terrain. Le genre n'est pas décoratif : il dicte le
 * rôle attendu du PIN saisi ensuite (on ne tient pas la caisse depuis le
 * piano) et, côté back-office, la marche à suivre affichée.
 */
export const DEVICE_KINDS = ['pos', 'kds'] as const;
export const DeviceKindSchema = z.enum(DEVICE_KINDS);
export type DeviceKind = z.infer<typeof DeviceKindSchema>;

export const DEVICE_KIND_LABELS: Record<DeviceKind, string> = {
  pos: 'Caisse',
  kds: 'Écran cuisine',
};

/** Nom proposé à la création — le gérant n'a rien à inventer. */
export const DEVICE_KIND_PLACEHOLDERS: Record<DeviceKind, string> = {
  pos: 'Caisse comptoir',
  kds: 'Écran cuisine',
};

// ─── Cadence de terrain ───

/**
 * Battement de cœur. Une caisse muette pendant le service est un incident :
 * plus personne n'encaisse. Une minute suffit à le voir sans inonder l'API.
 */
export const DEVICE_HEARTBEAT_INTERVAL_MS = 60_000;

/**
 * Sans nouvelle depuis ce délai, le back-office affiche « hors ligne ».
 *
 * Cinq minutes, contre quinze pour un téléviseur : une clé HDMI au plafond
 * peut rater deux battements sans que personne ne s'en émeuve, alors qu'une
 * caisse éteinte en plein service se règle dans la minute.
 */
export const DEVICE_OFFLINE_AFTER_MS = 5 * 60_000;

/**
 * En-tête portant le jeton d'appareil.
 *
 * Un en-tête plutôt qu'un paramètre d'URL : contrairement au téléviseur — une
 * clé HDMI qui ne sait qu'ouvrir une adresse — la caisse et la cuisine sont
 * des applications, elles composent leurs requêtes. Un secret n'a donc aucune
 * raison de finir dans un journal d'accès.
 */
export const DEVICE_TOKEN_HEADER = 'x-device-token';

// ─── DTO back-office (owner / gérant) ───

export const DeviceCreateSchema = z.object({
  name: z.string().trim().min(1, 'Donnez un nom à cet appareil').max(60),
  kind: DeviceKindSchema,
});
export type DeviceCreate = z.infer<typeof DeviceCreateSchema>;

/** Pas de `.partial()` : ce qui n'est pas transmis ne doit pas être écrasé. */
export const DeviceUpdateSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  kind: DeviceKindSchema.optional(),
  active: z.boolean().optional(),
});
export type DeviceUpdate = z.infer<typeof DeviceUpdateSchema>;

// ─── DTO appareil ───

export const PairDeviceSchema = z.object({
  pairingCode: z
    .string()
    .trim()
    .min(1, 'Saisissez le code affiché dans le back-office')
    .max(32)
    .toUpperCase(),
});
export type PairDevice = z.infer<typeof PairDeviceSchema>;

/**
 * Jeton d'appareil transmis dans le CORPS.
 *
 * Il reste accepté là en plus de l'en-tête : la file de synchronisation hors
 * ligne de la caisse rejoue des corps JSON persistés, et une tablette qui
 * rattrape son retard ne doit pas dépendre d'en-têtes reconstruits.
 */
export const DeviceTokenBodySchema = z.object({
  deviceToken: z.string().min(1).max(200).optional(),
});
export type DeviceTokenBody = z.infer<typeof DeviceTokenBodySchema>;

/**
 * Connexion par PIN DEPUIS un appareil appairé.
 *
 * Aucun `tenantSlug` : l'établissement est déduit du jeton d'appareil, jamais
 * du corps. C'est toute la différence avec l'ancienne forme — un slug envoyé
 * par le client se devine, un jeton de 32 octets non.
 */
export const DevicePinLoginSchema = z.object({
  pin: z.string().regex(/^\d{4,6}$/, 'Le code compte 4 à 6 chiffres'),
  /** Repli quand l'en-tête n'est pas disponible (rejeu hors ligne). */
  deviceToken: z.string().min(1).max(200).optional(),
});
export type DevicePinLogin = z.infer<typeof DevicePinLoginSchema>;

// ─── Identité renvoyée à l'appareil ───

/**
 * Tout ce dont la caisse a besoin pour se peindre aux couleurs du
 * restaurant : plus AUCUNE constante côté application.
 */
export interface DeviceTenantBrand {
  slug: string;
  name: string;
  /** Accent de marque — seul levier de personnalisation (charte DA §3). */
  brandColor: string;
  logoUrl: string | null;
}

export interface DeviceIdentity {
  id: string;
  name: string;
  kind: DeviceKind;
  kindLabel: string;
}

/** Réponse de `POST /public/devices/pair`. */
export interface DevicePaired {
  /** Secret long, montré UNE fois : l'appareil le persiste et s'en sert ensuite. */
  deviceToken: string;
  tenant: DeviceTenantBrand;
  device: DeviceIdentity;
}

/**
 * Réponse de `POST /public/devices/heartbeat`.
 *
 * Elle renvoie la marque à chaque battement : renommer le restaurant ou
 * changer sa couleur dans le back-office se voit sur la caisse au battement
 * suivant, sans réappairage ni redémarrage.
 */
export interface DeviceHeartbeatResult {
  ok: true;
  /** ISO 8601 UTC. */
  at: string;
  tenant: DeviceTenantBrand;
  device: DeviceIdentity;
}

/** Réponse de `POST /public/devices/pin` — même forme que l'ancien `/auth/pin`. */
export interface DevicePinSession {
  token: string;
  staff: { name: string; role: string };
  tenant: DeviceTenantBrand;
  device: DeviceIdentity;
}

// ─── Vue back-office ───

export interface DevicePairingView {
  code: string;
  /** ISO 8601 UTC. */
  expiresAt: string;
  expired: boolean;
}

export interface DeviceView {
  id: string;
  name: string;
  kind: DeviceKind;
  kindLabel: string;
  paired: boolean;
  /** `null` dès que l'appareil est appairé : le code ne sert plus à rien. */
  pairing: DevicePairingView | null;
  /** ISO 8601 UTC. */
  lastSeenAt: string | null;
  online: boolean;
  /** « En ligne », « Hors ligne depuis 12 min », « En attente d'appairage ». */
  statusLabel: string;
  active: boolean;
}

/**
 * Le code saisi a-t-il la bonne longueur ?
 *
 * Exporté pour l'appairage côté appareil : le pavé tactile désactive son
 * bouton de validation tant que les six caractères ne sont pas là, plutôt que
 * d'envoyer une requête vouée au refus.
 */
export const isDevicePairingCodeComplete = (code: string): boolean =>
  code.length === PAIRING_CODE_LENGTH;
