import { randomBytes } from 'node:crypto';
import { Types } from 'mongoose';
import { TRACKING_TOKEN_BYTES } from '@sm/contracts';

/**
 * Jeton de suivi des routes publiques d'une commande.
 *
 * Le défaut corrigé ici : `GET /public/orders/:id`, `…/ticket` et `…/escpos`
 * exposaient le nom et le téléphone du client à qui connaissait l'ObjectId. Or
 * un ObjectId Mongo n'est pas un secret — ses 4 premiers octets sont
 * l'horodatage de création et ses 3 derniers un compteur incrémental : à
 * partir d'une commande connue, les voisines se devinent.
 *
 * Le jeton ajoute 192 bits tirés du CSPRNG du système. Il ne remplace pas
 * l'ObjectId dans l'URL, il le complète (`?t=…`) — les liens déjà distribués
 * gardent leur forme, et le back-office authentifié n'est pas concerné.
 */

/** 24 octets aléatoires → 32 caractères base64url, sans remplissage. */
export function newTrackingToken(): string {
  return randomBytes(TRACKING_TOKEN_BYTES).toString('base64url');
}

/** Longueur maximale acceptée — au-delà, la requête est du bruit, pas un jeton. */
const MAX_TOKEN_LENGTH = 128;

/**
 * Filtre Mongo d'un accès public, ou `null` si la demande n'est pas
 * recevable — id malformé, jeton absent, vide, ou d'un type inattendu.
 *
 * Le typage explicite en `string` n'est pas décoratif : Express parse
 * `?t[$ne]=x` en objet, qui deviendrait un opérateur Mongo une fois injecté
 * dans le filtre et renverrait la première commande venue.
 *
 * Un `null` doit se traduire par un 404 côté appelant, jamais par un 403 : un
 * 403 confirmerait que la commande existe, ce qui est précisément ce que le
 * jeton doit empêcher.
 */
export function trackingFilter(
  id: string,
  token: unknown,
): { _id: string; trackingToken: string } | null {
  if (typeof token !== 'string') return null;
  const trimmed = token.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_TOKEN_LENGTH) return null;
  if (!Types.ObjectId.isValid(id)) return null;
  return { _id: id, trackingToken: trimmed };
}
