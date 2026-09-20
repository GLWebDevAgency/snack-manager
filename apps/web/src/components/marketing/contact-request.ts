import type { LeadNeed } from "./notch/lead-intent";

export type ContactPayload = {
  name: string;
  restaurant: string;
  phone: string;
  email: string;
  callbackSlot: string;
  need: LeadNeed | "";
  message: string;
  platforms: boolean;
};

export type ContactAttempt = { fingerprint: string; requestId: string };
export type ContactFieldErrors = Partial<Record<"name" | "phone" | "email", string>>;

const PHONE_RE = /^[+0-9][0-9\s.\-()]{7,19}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validateContactPayload(payload: ContactPayload): ContactFieldErrors {
  const errors: ContactFieldErrors = {};
  if (payload.name.length < 2) errors.name = "Indiquez votre nom.";
  if (!PHONE_RE.test(payload.phone)) errors.phone = "Numéro de téléphone invalide.";
  if (payload.email && (payload.email.length > 160 || !EMAIL_RE.test(payload.email))) {
    errors.email = "Indiquez une adresse e-mail valide, ou laissez ce champ vide.";
  }
  return errors;
}

/** Only a durable receipt for this exact request may clear the visitor's inputs. */
export function isContactReceipt(
  body: unknown,
  expectedRequestId: string,
): body is { ok: true; stored: true; requestId: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  const receipt = body as Record<string, unknown>;
  return receipt.ok === true && receipt.stored === true
    && typeof receipt.requestId === "string"
    && UUID_RE.test(receipt.requestId)
    && receipt.requestId === expectedRequestId;
}

/** A retry after an uncertain response must identify the same logical request. */
export function contactAttempt(
  payload: ContactPayload,
  previous: ContactAttempt | null,
  uuid: () => string = () => crypto.randomUUID(),
): ContactAttempt {
  const fingerprint = JSON.stringify(payload);
  return previous?.fingerprint === fingerprint ? previous : { fingerprint, requestId: uuid() };
}
