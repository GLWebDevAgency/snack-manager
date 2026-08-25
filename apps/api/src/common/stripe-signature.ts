import { createHmac, timingSafeEqual } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';

/**
 * VÉRIFICATION DE SIGNATURE STRIPE — partagée par les DEUX webhooks.
 *
 * Il en existe deux, et ils ne portent pas le même secret : celui des
 * paiements du compte plateforme, et celui des COMPTES CONNECTÉS (les
 * événements des restaurants, en charges directes). Un seul secret pour les
 * deux ferait échouer la signature d'un des deux flux — panne silencieuse où
 * les commandes payées restent « en attente » sans le moindre message.
 *
 * La vérification est faite à la main, avec `node:crypto`, et NON via
 * `stripe.webhooks.constructEvent` : le paquet `stripe` n'est pas une
 * dépendance du projet, et un webhook qui n'existerait qu'après `pnpm add
 * stripe` laisserait des commandes bloquées sans explication. L'algorithme est
 * celui, public et stable, du schéma `v1` de Stripe : HMAC-SHA256 de
 * `<timestamp>.<corps brut>`.
 *
 * `payload` DOIT être le corps BRUT (octets reçus). Un JSON re-sérialisé —
 * même sémantiquement identique — change l'ordre des clés et les échappements,
 * donc l'empreinte : la signature échouerait à tous les coups. D'où
 * `rawBody: true` dans `main.ts`.
 */

/**
 * Tolérance d'horodatage, en secondes — la valeur par défaut de Stripe. Elle
 * borne la fenêtre pendant laquelle une requête interceptée peut être rejouée
 * telle quelle. Chaque tentative de livraison de Stripe est resignée à l'heure
 * courante : un vrai rejeu Stripe (jusqu'à trois jours) passe donc toujours.
 */
export const SIGNATURE_TOLERANCE_SECONDS = 300;

/**
 * Sous-ensemble d'un événement Stripe réellement exploité — on décrit ce qu'on
 * lit, pas l'API entière, et on ne dépend d'aucun type du paquet `stripe`.
 */
export interface StripeWebhookEvent {
  id: string;
  type: string;
  data: { object: StripeWebhookObject };
  /** Présent sur les événements d'un COMPTE CONNECTÉ — absent sur la plateforme. */
  account?: string;
}

export interface StripeWebhookObject {
  id?: string;
  amount?: number;
  metadata?: Record<string, string> | null;
  last_payment_error?: { message?: string } | null;
  /** Drapeaux d'un compte connecté (`account.updated`). */
  charges_enabled?: boolean;
  payouts_enabled?: boolean;
  details_submitted?: boolean;
}

/**
 * Décode l'événement après vérification, ou lève `BadRequestException` (400) —
 * la réponse que Stripe attend pour cesser de rejouer un événement illisible.
 */
export function verifierEvenementStripe(
  payload: Buffer | string | undefined,
  signatureHeader: string | undefined,
  secret: string,
  maintenant: Date = new Date(),
): StripeWebhookEvent {
  if (payload === undefined || payload.length === 0) {
    // Symptôme classique d'un `NestFactory.create` sans `{ rawBody: true }`.
    throw new BadRequestException(
      'Corps brut absent : le webhook Stripe exige « rawBody » (voir main.ts).',
    );
  }
  if (!signatureHeader) {
    throw new BadRequestException('En-tête « stripe-signature » absent.');
  }

  const body = typeof payload === 'string' ? payload : payload.toString('utf8');
  const { timestamp, signatures } = parseSignatureHeader(signatureHeader);

  const expected = createHmac('sha256', secret).update(`${timestamp}.${body}`, 'utf8').digest('hex');
  // Plusieurs `v1` cohabitent pendant une rotation de secret : il suffit
  // qu'UNE corresponde.
  if (!signatures.some((candidate) => safeEqualHex(candidate, expected))) {
    throw new BadRequestException('Signature Stripe invalide.');
  }

  const ageSeconds = Math.abs(Math.floor(maintenant.getTime() / 1000) - timestamp);
  if (ageSeconds > SIGNATURE_TOLERANCE_SECONDS) {
    throw new BadRequestException(
      `Horodatage Stripe hors tolérance (${ageSeconds} s) — rejeu suspect ou horloge serveur décalée.`,
    );
  }

  try {
    return JSON.parse(body) as StripeWebhookEvent;
  } catch {
    // Signature valide mais corps illisible : anomalie, pas une attaque.
    throw new BadRequestException('Corps du webhook Stripe illisible.');
  }
}

function parseSignatureHeader(header: string): { timestamp: number; signatures: string[] } {
  let timestamp = Number.NaN;
  const signatures: string[] = [];

  for (const part of header.split(',')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (key === 't') timestamp = Number(value);
    else if (key === 'v1') signatures.push(value);
  }

  if (!Number.isFinite(timestamp) || signatures.length === 0) {
    throw new BadRequestException('En-tête « stripe-signature » illisible.');
  }
  return { timestamp, signatures };
}

/**
 * Comparaison à temps constant de deux empreintes hexadécimales.
 * Un `===` fuirait, par sa durée, le nombre de caractères devinés — de quoi
 * reconstruire une signature valide octet par octet.
 */
function safeEqualHex(candidate: string, expected: string): boolean {
  if (candidate.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(candidate, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    // `candidate` n'est pas de l'hexadécimal : longueurs décodées différentes.
    return false;
  }
}
