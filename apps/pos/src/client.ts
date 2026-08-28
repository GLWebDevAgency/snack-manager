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
 *
 * ─── LE MODE DÉMONSTRATION ───
 *
 * Avec `?demo=1` — et seulement ainsi — la caisse tourne entièrement dans le
 * navigateur du visiteur : transport en mémoire, carte issue d'une fixture,
 * aucune base de données touchée. Ce module est le seul endroit qui le sache ;
 * `App.tsx` et l'écran de vente n'ont pas une ligne de conditionnel.
 *
 * L'appairage et la session sont PRÉ-REMPLIS dans un magasin volatil, avant
 * qu'aucun écran ne se monte. C'est ce qui fait que le visiteur arrive
 * directement sur une caisse ouverte : ni code d'appairage, ni clavier de PIN.
 * Un patron de snack qui tombe sur un formulaire de code s'en va.
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

const DEFAULT_API = 'https://api-production-8949.up.railway.app';

/**
 * Version du bundle, rapportée par le battement de cœur. La source est le
 * `package.json` de l'app : la bumper fait partie d'une livraison qui change
 * le comportement du poste — c'est elle qui permet de répondre « cette
 * tablette tourne sur un vieux bundle » sans se déplacer.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports -- lecture de la version au build, hors graphe ES
const APP_VERSION: string = (require('../package.json') as { version: string }).version;

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

// ─── Clés de persistance locale ───

/**
 * Les clés de stockage de la caisse — définies dans `pos-state.ts`.
 *
 * Elles y vivent parce que ce module-là est PUR : `client.ts` tire React
 * Native, que la configuration de test ne sait pas analyser. La liste des clés
 * à purger au désappairage décide si les ventes d'un commerçant peuvent
 * ressortir chez un autre : elle doit être vérifiable.
 */
import { KEYS } from './pos-state';
export { KEYS };

export interface Session {
  token: string;
  staffName: string;
  staffRole: string;
  tenantName: string;
  tenantSlug: string;
  brandColor: string;
  at: number;
}

// ─────────────────────────────────────────────────────────────
// Démonstration
// ─────────────────────────────────────────────────────────────

/**
 * Ce poste est-il une démonstration ?
 *
 * Lu UNE fois, au chargement du module, depuis l'URL et rien d'autre. Ni
 * variable d'environnement, ni valeur par défaut, ni reste dans le stockage :
 * une tablette en service ne peut pas y tomber par accident (cf.
 * `client-core/src/demo/mode.ts` et son test).
 */
export const DEMO = isDemoRequested();

/** Équipier de démonstration — un prénom, comme sur une vraie caisse. */
const DEMO_STAFF = { name: 'Sarah', role: 'caisse' } as const;

const DEMO_PAIRED: PairedDevice = {
  deviceToken: 'demo',
  tenant: {
    slug: DEMO_TENANT.slug,
    name: DEMO_TENANT.name,
    brandColor: DEMO_TENANT.brandColor,
    logoUrl: DEMO_TENANT.logoUrl ?? null,
  },
  device: { id: 'demo-pos', name: 'Caisse comptoir', kind: 'pos', kindLabel: 'Caisse' },
};

/**
 * Le poste de démonstration s'ouvre DÉJÀ appairé et DÉJÀ en service.
 *
 * `App.tsx` restaure l'appairage puis la session au montage : les deux sont
 * donc semées ici, avant que quoi que ce soit ne se peigne. Le visiteur ne voit
 * jamais l'écran d'appairage ni le clavier de code — il voit une caisse.
 */
function demoSeed(): Record<string, string> {
  const session: Session = {
    token: 'demo',
    staffName: DEMO_STAFF.name,
    staffRole: DEMO_STAFF.role,
    tenantName: DEMO_TENANT.name,
    tenantSlug: DEMO_TENANT.slug,
    brandColor: DEMO_TENANT.brandColor,
    at: Date.now(),
  };
  return {
    [KEYS.device]: JSON.stringify(DEMO_PAIRED),
    [KEYS.session]: JSON.stringify(session),
  };
}

// Doit être appelé AVANT toute construction de file de sync.
// En démonstration le magasin est volatil : rien n'atterrit dans le navigateur
// du visiteur, et un rechargement lui rend une caisse neuve.
setStore(
  DEMO ? demoStore(demoSeed()) : Platform.OS === 'web' ? webStore() : nativeStore(),
);

const BASE_URL = resolveBaseUrl();

export const client = new SmClient({
  baseUrl: BASE_URL,
  ...(DEMO ? { transport: demoTransport() } : null),
});

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
  /**
   * Abonnement suspendu côté Snack Manager. Porté par le battement de cœur :
   * c'est l'ÉCRAN qui se verrouille (contrat `DeviceHeartbeatResult`), pas
   * l'encaissement qui échoue devant un client.
   */
  suspended?: boolean;
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
  await getStore().setItem(KEYS.device, JSON.stringify(next));
  return next;
}

/**
 * Désappairage — « Changer d'établissement », ou appareil révoqué côté serveur.
 *
 * La session de l'équipier part avec : un jeton staff émis pour un
 * établissement n'a aucun sens sur le suivant.
 */
/**
 * Branche le rapporteur d'erreurs sur le guichet public — voir
 * `client-core/error-report`. Pas en démonstration : les erreurs du visiteur
 * n'ont pas d'établissement, et la vitrine n'est pas un poste en service.
 */
export function installErrorReporting(): () => void {
  if (DEMO) return () => {};
  return installClientErrorReporter({
    source: 'pos',
    post: (body) => {
      void fetch(`${BASE_URL}/public/client-errors`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        keepalive: true,
      }).catch(() => {});
    },
  });
}

/**
 * DÉSAPPAIRER, c'est tout oublier de CET établissement.
 *
 * L'appairage, la session et la file partaient bien. Le reste — journal du
 * service, tickets mis en attente, heure d'ouverture — restait en place et
 * ressortait tel quel après ré-appairage chez un AUTRE commerçant : le Z du
 * soir mélangeait deux restaurants, et un ticket parqué chez A se rappelait
 * chez B avec ses lignes et le nom de son client.
 *
 * La liste est donc celle des clés `KEYS`, dans son ensemble, et non un
 * sous-ensemble choisi : une clé ajoutée demain doit y entrer d'office.
 */
export async function forgetPairedDevice(): Promise<void> {
  adopt(null);
  client.setToken(null);
  for (const cle of Object.values(KEYS)) await getStore().removeItem(cle);
  // La file hors-ligne part avec l'appairage. Elle n'est pas cloisonnée par
  // établissement : des mutations en attente de l'établissement A rejouées
  // après ré-appairage chez B seraient des ventes écrites chez le mauvais
  // commerçant — et sans le jeton de A, elles ne se rejoueraient de toute
  // façon jamais correctement. On assume la perte : elle est visible (le
  // badge « N en attente ») AVANT le désappairage, jamais silencieuse après.
  await client.queue.clear();
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
  // En démonstration, ces trois routes n'ont pas de correspondant : l'appareil
  // n'existe pas, il n'y a personne à qui donner signe de vie. Laisser passer
  // l'appel serait pire qu'inutile — le serveur répondrait 401 sur un jeton
  // « demo », `App.tsx` en conclurait une révocation et renverrait le visiteur
  // sur l'écran d'appairage, en pleine démonstration.
  if (DEMO) throw new DeviceError('Route indisponible en démonstration', 503);
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
  // La télémétrie qui manquait au support : version du bundle, profondeur de
  // la file hors-ligne, dernière erreur de synchronisation. De l'état de
  // machine — jamais une vente, jamais un client.
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
 * corps : la caisse n'a aucun moyen de nommer un autre restaurant.
 */
export async function pinLogin(pin: string): Promise<DevicePinSession> {
  const device = current;
  if (!device) throw new DeviceError("Cet appareil n'est pas appairé.", 401);
  return deviceFetch<DevicePinSession>('/public/devices/pin', { pin }, device.deviceToken);
}
