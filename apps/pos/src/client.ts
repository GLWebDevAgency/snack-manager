/**
 * Client API du poste de caisse.
 *
 * Toute écriture passe par `client.post` / `client.patch`, donc par la file
 * offline persistée : une coupure réseau ne fait perdre aucune commande.
 * Seule l'authentification utilise `direct` (il faut un jeton avant de pouvoir
 * empiler quoi que ce soit).
 *
 * ─── L'APPAIREMENT ───
 *
 * Ce module portait jusqu'ici `TENANT_SLUG = 'classfood'` EN DUR : la caisse ne
 * savait travailler que pour un seul restaurant, et en servir un autre imposait
 * de recompiler l'application. Le poste apprend désormais son établissement
 * exactement comme les téléviseurs de salle : six caractères saisis une fois à
 * l'installation, contre un JETON D'APPAREIL qu'il conserve et qui porte, lui
 * seul, l'identité du restaurant.
 *
 * Conséquence directe : le nom, l'accent et le logo affichés par la caisse ne
 * viennent plus d'aucune constante — ils descendent du tenant appairé.
 */
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  DEVICE_TOKEN_HEADER,
  type DeviceHeartbeatResult,
  type DeviceIdentity,
  type DevicePaired,
  type DevicePinSession,
  type DeviceTenantBrand,
} from '@sm/contracts';
import { SmClient, getStore, setStore, webStore, type KeyValueStore } from '@sm/client-core';

const DEFAULT_API = 'https://api-production-8949.up.railway.app';

/** Le poste peut être pointé vers une API locale sans rebuild (clé `sm.apiUrl`). */
function resolveBaseUrl(): string {
  if (Platform.OS === 'web') {
    try {
      const override = globalThis.localStorage?.getItem('sm.apiUrl');
      if (override) return override;
    } catch {
      /* stockage bloqué : on garde l'URL par défaut */
    }
  }
  return DEFAULT_API;
}

function nativeStore(): KeyValueStore {
  return {
    getItem: (key) => AsyncStorage.getItem(key),
    async setItem(key, value) {
      await AsyncStorage.setItem(key, value);
    },
    async removeItem(key) {
      await AsyncStorage.removeItem(key);
    },
  };
}

// Doit être appelé AVANT toute construction de file de sync.
setStore(Platform.OS === 'web' ? webStore() : nativeStore());

const BASE_URL = resolveBaseUrl();

export const client = new SmClient({ baseUrl: BASE_URL });

// ─── Clés de persistance locale ───

export const KEYS = {
  session: 'sm.pos.session.v1',
  /** Appairage de l'appareil — survit à la déconnexion de l'équipier. */
  device: 'sm.pos.device.v1',
  parked: 'sm.pos.parked.v1',
  dayLog: 'sm.pos.daylog.v1',
  /** Ouverture du service courant — borne de découpe du Z. */
  serviceStart: 'sm.pos.servicestart.v1',
} as const;

export interface Session {
  token: string;
  staffName: string;
  staffRole: string;
  tenantName: string;
  tenantSlug: string;
  brandColor: string;
  at: number;
}

export interface PinLoginResponse {
  token: string;
  staff: { name: string; role: string };
  tenant: { slug: string; name: string; brandColor: string };
}

// ─────────────────────────────────────────────────────────────
// Appareil appairé
// ─────────────────────────────────────────────────────────────

export interface PairedDevice {
  /** Secret long remis à l'appairage — vaut mot de passe du poste. */
  deviceToken: string;
  tenant: DeviceTenantBrand;
  device: DeviceIdentity;
}

/**
 * Slug de l'établissement appairé.
 *
 * Exporté en liaison VIVANTE (`let`, jamais réassigné ailleurs qu'ici) : la
 * carte publique s'interroge encore par slug, et l'écran de vente le lit au
 * moment où il se monte — c'est-à-dire toujours après l'appairage, puisqu'on
 * n'atteint la vente qu'une fois le PIN validé.
 *
 * Chaîne vide tant qu'aucun appareil n'est appairé : c'est la valeur d'un poste
 * qui ne sait pas encore chez qui il travaille — surtout pas le nom d'un
 * restaurant écrit en dur, qui est précisément le défaut corrigé ici.
 */
export let TENANT_SLUG = '';

/** Appareil courant, tenu en mémoire pour éviter une lecture disque par requête. */
let current: PairedDevice | null = null;

function adopt(next: PairedDevice | null): PairedDevice | null {
  current = next;
  TENANT_SLUG = next?.tenant.slug ?? '';
  return next;
}

export const pairedDevice = (): PairedDevice | null => current;

/** Lecture de l'appairage persisté — appelée une fois au démarrage. */
export async function loadPairedDevice(): Promise<PairedDevice | null> {
  try {
    const raw = await getStore().getItem(KEYS.device);
    if (!raw) return adopt(null);
    const parsed = JSON.parse(raw) as PairedDevice;
    return adopt(parsed?.deviceToken && parsed.tenant?.slug ? parsed : null);
  } catch {
    // Appairage illisible : on repart sur l'écran d'appairage plutôt que de
    // laisser le poste tourner sans savoir pour qui il encaisse.
    return adopt(null);
  }
}

/**
 * Deux appairages décrivent-ils la même chose ?
 *
 * Le battement de cœur rapporte la marque toutes les minutes. Sans cette
 * comparaison, chaque battement produirait un objet neuf : une écriture disque
 * par minute pour rien, et surtout une nouvelle identité d'objet qui ferait
 * repeindre la caisse — donc casser une animation — sans qu'aucune valeur
 * n'ait changé.
 */
function sameDevice(a: PairedDevice, b: PairedDevice): boolean {
  return (
    a.deviceToken === b.deviceToken &&
    a.tenant.slug === b.tenant.slug &&
    a.tenant.name === b.tenant.name &&
    a.tenant.brandColor === b.tenant.brandColor &&
    a.tenant.logoUrl === b.tenant.logoUrl &&
    a.device.id === b.device.id &&
    a.device.name === b.device.name &&
    a.device.kind === b.device.kind
  );
}

async function persist(next: PairedDevice): Promise<PairedDevice> {
  const existing = current;
  if (existing && sameDevice(existing, next)) return existing;
  adopt(next);
  await getStore().setItem(KEYS.device, JSON.stringify(next));
  return next;
}

/**
 * Désappairage — « Changer d'établissement », ou appareil révoqué côté serveur.
 *
 * La session de l'équipier part avec : un jeton staff émis pour un
 * établissement n'a aucun sens sur le suivant.
 */
export async function forgetPairedDevice(): Promise<void> {
  adopt(null);
  client.setToken(null);
  await getStore().removeItem(KEYS.device);
  await getStore().removeItem(KEYS.session);
}

// ─────────────────────────────────────────────────────────────
// Routes appareil
// ─────────────────────────────────────────────────────────────

/**
 * Appel des routes d'appareil.
 *
 * `SmClient.direct` ne sait pas poser d'en-tête personnalisé, et le jeton
 * d'appareil n'a rien à faire dans une URL — un secret ne se journalise pas.
 * D'où cette fonction, volontairement minuscule : elle ne sert que les trois
 * routes `/public/devices/*`, qui sont publiques (aucun Bearer à joindre).
 */
async function deviceFetch<T>(path: string, body: unknown, deviceToken?: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(deviceToken ? { [DEVICE_TOKEN_HEADER]: deviceToken } : {}),
    },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => null)) as { message?: string } | null;
  if (!res.ok) {
    throw new DeviceError(data?.message ?? `Erreur ${res.status}`, res.status);
  }
  return data as T;
}

/** Erreur d'une route d'appareil — le statut sert à distinguer la révocation. */
export class DeviceError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Appairage : six caractères contre un jeton, une fois pour toutes. */
export async function pairDevice(pairingCode: string): Promise<PairedDevice> {
  const result = await deviceFetch<DevicePaired>('/public/devices/pair', { pairingCode });
  return persist({
    deviceToken: result.deviceToken,
    tenant: result.tenant,
    device: result.device,
  });
}

/**
 * Battement de cœur.
 *
 * Il dit au back-office que la caisse est vivante — une caisse muette en plein
 * service est le seul incident qui coûte de l'argent à la minute — et rapporte
 * la marque à jour : renommer l'établissement se voit ici sans réappairage.
 *
 * Renvoie `null` sur simple panne réseau (le poste continue de travailler hors
 * ligne) et lève sur révocation, seul cas où il faut vraiment réagir.
 */
export async function deviceHeartbeat(): Promise<PairedDevice | null> {
  const device = current;
  if (!device) return null;
  let beat: DeviceHeartbeatResult;
  try {
    beat = await deviceFetch<DeviceHeartbeatResult>(
      '/public/devices/heartbeat',
      {},
      device.deviceToken,
    );
  } catch (e) {
    // 401 : l'appareil a été révoqué depuis le back-office (tablette perdue).
    if (e instanceof DeviceError && e.status === 401) throw e;
    return null;
  }
  return persist({ ...device, tenant: beat.tenant, device: beat.device });
}

/**
 * Ouverture de service par PIN.
 *
 * L'établissement est déduit du jeton d'appareil, jamais transmis dans le
 * corps : la caisse n'a aucun moyen de nommer un autre restaurant.
 */
export async function pinLogin(pin: string): Promise<DevicePinSession> {
  const device = current;
  if (!device) throw new DeviceError("Cet appareil n'est pas appairé.", 401);
  return deviceFetch<DevicePinSession>('/public/devices/pin', { pin }, device.deviceToken);
}
