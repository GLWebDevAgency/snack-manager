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
import {
  DEMO_TENANT,
  SmClient,
  demoStore,
  demoTransport,
  getStore,
  installClientErrorReporter,
  isDemoRequested,
  setStore,
  webStore,
  type KeyValueStore,
} from '@sm/client-core';
import { API_URL, KEY_SESSION } from './config';

/** Version du bundle, rapportée par le battement — même contrat que la caisse. */
// eslint-disable-next-line @typescript-eslint/no-require-imports -- lecture de la version au build, hors graphe ES
const APP_VERSION: string = (require('../package.json') as { version: string }).version;

/**
 * Client unique de l'app. Toute écriture (changement de statut) passe par
 * `client.patch`, donc par la file offline persistée : l'interface avance
 * immédiatement, le réseau rattrape quand il revient.
 *
 * ─── L'APPAIREMENT ───
 *
 * L'écran cuisine tirait son établissement d'une constante (`TENANT_SLUG`,
 * surchargeable par `?tenant=` en développement). C'était tenable pour un
 * pilote, pas pour un produit : chaque restaurant aurait exigé son propre
 * build. La tablette apprend désormais chez qui elle travaille exactement
 * comme les téléviseurs de salle — un code à six caractères saisi une fois,
 * contre un JETON D'APPAREIL qu'elle conserve et qui porte l'établissement.
 *
 * ─── LE MODE DÉMONSTRATION ───
 *
 * Avec `?demo=1` — et seulement ainsi — l'écran cuisine tourne entièrement dans
 * le navigateur du visiteur : transport en mémoire, tickets issus d'une
 * fixture, aucune base de données touchée. Ce module est le seul endroit qui le
 * sache ; `App.tsx`, `useSession` et le tableau n'ont pas une ligne de
 * conditionnel. L'appairage et la session sont pré-remplis, si bien que le
 * visiteur tombe sur un service en cours et non sur un clavier de code.
 */

/** AsyncStorage enveloppé dans le contrat KeyValueStore du noyau. */
function nativeStore(): KeyValueStore {
  return {
    getItem: (key) => AsyncStorage.getItem(key),
    setItem: (key, value) => AsyncStorage.setItem(key, value),
    removeItem: (key) => AsyncStorage.removeItem(key),
  };
}

/** Appairage de l'appareil — survit à la déconnexion de l'équipe. */
export const KEY_DEVICE = 'sm.kds.device.v1';

// ─────────────────────────────────────────────────────────────
// Démonstration
// ─────────────────────────────────────────────────────────────

/**
 * Cet écran est-il une démonstration ?
 *
 * Lu UNE fois, au chargement du module, depuis l'URL et rien d'autre. Ni
 * variable d'environnement, ni valeur par défaut : une tablette de cuisine ne
 * peut pas y basculer par accident (cf. `client-core/src/demo/mode.ts`).
 */
export const DEMO = isDemoRequested();

const DEMO_PAIRED = {
  deviceToken: 'demo',
  tenant: {
    slug: DEMO_TENANT.slug,
    name: DEMO_TENANT.name,
    brandColor: DEMO_TENANT.brandColor,
    logoUrl: DEMO_TENANT.logoUrl ?? null,
  },
  device: { id: 'demo-kds', name: 'Écran cuisine', kind: 'kds', kindLabel: 'Écran cuisine' },
} satisfies PairedDevice;

/**
 * L'écran de démonstration s'ouvre DÉJÀ appairé et DÉJÀ en service.
 *
 * `useSession` restaure l'appairage puis la session au montage : les deux sont
 * semées ici, avant qu'aucun écran ne se peigne.
 */
function demoSeed(): Record<string, string> {
  return {
    [KEY_DEVICE]: JSON.stringify(DEMO_PAIRED),
    [KEY_SESSION]: JSON.stringify({
      token: 'demo',
      staff: { name: 'Équipe', role: 'cuisine' },
      tenant: {
        slug: DEMO_TENANT.slug,
        name: DEMO_TENANT.name,
        brandColor: DEMO_TENANT.brandColor,
      },
    }),
  };
}

// À faire AVANT toute lecture/écriture : sinon le noyau retombe sur un store
// mémoire qui ne survit pas au redémarrage de la tablette. En démonstration le
// magasin est volatil PAR CONSTRUCTION : rien n'atterrit dans le navigateur du
// visiteur, et un rechargement lui rend un service neuf.
setStore(
  DEMO ? demoStore(demoSeed()) : Platform.OS === 'web' ? webStore() : nativeStore(),
);

export const client = new SmClient({
  baseUrl: API_URL,
  ...(DEMO ? { transport: demoTransport() } : null),
});

// ─────────────────────────────────────────────────────────────
// Appareil appairé
// ─────────────────────────────────────────────────────────────

export interface PairedDevice {
  /** Secret long remis à l'appairage — vaut mot de passe de la tablette. */
  deviceToken: string;
  tenant: DeviceTenantBrand;
  device: DeviceIdentity;
  /**
   * Abonnement suspendu côté Snack Manager. Porté par le battement de cœur :
   * c'est l'ÉCRAN qui se verrouille (contrat `DeviceHeartbeatResult`), pas
   * la cuisine qui découvre des tickets fantômes.
   */
  suspended?: boolean;
}

/**
 * Petit magasin observable.
 *
 * L'appairage est lu à deux endroits qui ne se connaissent pas — la session
 * (pour authentifier) et l'écran d'ouverture (pour s'afficher aux couleurs du
 * restaurant). Un état React porté par l'un des deux obligerait à le faire
 * descendre par des composants qui n'en ont que faire ; un magasin auquel on
 * s'abonne évite ce câblage.
 */
let current: PairedDevice | null = null;
const listeners = new Set<() => void>();

function adopt(next: PairedDevice | null): PairedDevice | null {
  current = next;
  for (const notify of listeners) notify();
  return next;
}

export const pairedDevice = (): PairedDevice | null => current;

export function subscribeDevice(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Lecture de l'appairage persisté — appelée une fois au démarrage. */
export async function loadPairedDevice(): Promise<PairedDevice | null> {
  try {
    const raw = await getStore().getItem(KEY_DEVICE);
    if (!raw) return adopt(null);
    const parsed = JSON.parse(raw) as PairedDevice;
    return adopt(parsed?.deviceToken && parsed.tenant?.slug ? parsed : null);
  } catch {
    // Appairage illisible : on redemande le code plutôt que de laisser une
    // cuisine afficher les tickets d'on ne sait qui.
    return adopt(null);
  }
}

/**
 * Deux appairages décrivent-ils la même chose ?
 *
 * Ce n'est pas une optimisation : le battement de cœur rapporte la marque
 * toutes les minutes, et republier un objet neuf à chaque fois réveillerait
 * tous les abonnés — donc l'effet qui pilote le battement, qui relancerait un
 * battement, en boucle. Le magasin ne prévient que lorsque quelque chose a
 * VRAIMENT bougé.
 */
function sameDevice(a: PairedDevice | null, b: PairedDevice): boolean {
  return (
    a !== null &&
    a.deviceToken === b.deviceToken &&
    // `?? false` : les appairages persistés avant ce champ n'en ont pas, et
    // « absent » veut dire « pas suspendu » — pas « différent à chaque fois ».
    (a.suspended ?? false) === (b.suspended ?? false) &&
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
  await getStore().setItem(KEY_DEVICE, JSON.stringify(next));
  return next;
}

/**
 * Désappairage — « Changer d'établissement », ou appareil révoqué côté serveur.
 *
 * La session de l'équipe part avec : un jeton émis pour un établissement n'a
 * aucun sens sur le suivant.
 */
/**
 * Branche le rapporteur d'erreurs sur le guichet public — voir
 * `client-core/error-report`. Pas en démonstration : les erreurs du visiteur
 * n'ont pas d'établissement, et la vitrine n'est pas une cuisine en service.
 */
export function installErrorReporting(): () => void {
  if (DEMO) return () => {};
  return installClientErrorReporter({
    source: 'kds',
    post: (body) => {
      void fetch(`${API_URL}/public/client-errors`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        keepalive: true,
      }).catch(() => {});
    },
  });
}

export async function forgetPairedDevice(): Promise<void> {
  adopt(null);
  client.setToken(null);
  await getStore().removeItem(KEY_DEVICE);
  await getStore().removeItem(KEY_SESSION);
  // La file hors-ligne part avec l'appairage : non cloisonnée par
  // établissement, elle rejouerait sinon les gestes de l'établissement A
  // sous l'établissement B après ré-appairage. Perte assumée et visible
  // (compteur « N en attente ») avant le geste, jamais silencieuse après.
  await client.queue.clear();
}

// ─────────────────────────────────────────────────────────────
// Routes appareil
// ─────────────────────────────────────────────────────────────

/** Erreur d'une route d'appareil — le statut sert à distinguer la révocation. */
export class DeviceError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/**
 * Appel des routes d'appareil.
 *
 * `SmClient.direct` ne sait pas poser d'en-tête personnalisé, et le jeton
 * d'appareil n'a rien à faire dans une URL — un secret ne se journalise pas.
 * D'où cette fonction, volontairement minuscule : elle ne sert que les trois
 * routes `/public/devices/*`, qui sont publiques (aucun Bearer à joindre).
 */
async function deviceFetch<T>(path: string, body: unknown, deviceToken?: string): Promise<T> {
  // En démonstration, ces trois routes n'ont pas de correspondant : l'appareil
  // n'existe pas. Laisser passer l'appel serait pire qu'inutile — le serveur
  // répondrait 401 sur un jeton « demo », `useSession` en conclurait une
  // révocation et fermerait la session en pleine démonstration.
  if (DEMO) throw new DeviceError('Route indisponible en démonstration', 503);
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(deviceToken ? { [DEVICE_TOKEN_HEADER]: deviceToken } : {}),
    },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => null)) as { message?: string } | null;
  if (!res.ok) throw new DeviceError(data?.message ?? `Erreur ${res.status}`, res.status);
  return data as T;
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
 * Il dit au back-office que l'écran cuisine est vivant, et rapporte la marque
 * à jour : renommer l'établissement se voit ici sans réappairage. Renvoie
 * `null` sur simple panne réseau (la cuisine continue de travailler hors
 * ligne) et lève sur révocation, seul cas où il faut vraiment réagir.
 */
export async function deviceHeartbeat(): Promise<PairedDevice | null> {
  const device = current;
  if (!device) return null;
  // La télémétrie qui manquait au support : version du bundle, profondeur de
  // la file hors-ligne, dernière erreur de synchronisation. De l'état de
  // machine — jamais un ticket, jamais un client.
  const queue = client.queue.getState();
  let beat: DeviceHeartbeatResult;
  try {
    beat = await deviceFetch<DeviceHeartbeatResult>(
      '/public/devices/heartbeat',
      {
        appVersion: APP_VERSION,
        queueDepth: queue.pending,
        lastError: (queue.lastError ?? '').slice(0, 300),
      },
      device.deviceToken,
    );
  } catch (e) {
    // 401 : l'appareil a été révoqué depuis le back-office (tablette perdue).
    if (e instanceof DeviceError && e.status === 401) throw e;
    return null;
  }
  return persist({
    ...device,
    tenant: beat.tenant,
    device: beat.device,
    suspended: beat.suspended === true,
  });
}

/**
 * Ouverture de service par PIN.
 *
 * L'établissement est déduit du jeton d'appareil, jamais transmis dans le
 * corps : la tablette n'a aucun moyen de nommer un autre restaurant.
 */
export async function pinLogin(pin: string): Promise<DevicePinSession> {
  const device = current;
  if (!device) throw new DeviceError("Cet appareil n'est pas appairé.", 401);
  return deviceFetch<DevicePinSession>('/public/devices/pin', { pin }, device.deviceToken);
}
