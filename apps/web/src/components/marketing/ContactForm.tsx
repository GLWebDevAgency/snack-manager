"use client";

import { useState } from "react";
import { CALLBACK_SLOTS, CONTACT_EMAIL, FOUNDER_SEATS_LEFT } from "./content";
import { MkIcon, MkTick } from "./icons";

type Status = "idle" | "loading" | "done" | "error";
type FieldName = "name" | "phone" | "email";

const PHONE_RE = /^[+0-9][0-9\s.\-()]{7,19}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Formulaire de rappel → POST /api/contact.
 *
 * Validation côté client (doublée côté serveur), états chargement / succès /
 * erreur explicites, et un honeypot invisible (`company`) : les robots
 * remplissent tout, un humain ne voit jamais ce champ.
 */
export function ContactForm() {
  const [status, setStatus] = useState<Status>("idle");
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [message, setMessage] = useState("");

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);

    const payload = {
      name: String(data.get("name") ?? "").trim(),
      restaurant: String(data.get("restaurant") ?? "").trim(),
      phone: String(data.get("phone") ?? "").trim(),
      email: String(data.get("email") ?? "").trim(),
      callbackSlot: String(data.get("callbackSlot") ?? ""),
      message: String(data.get("message") ?? "").trim(),
      company: String(data.get("company") ?? ""),
    };

    const next: Partial<Record<FieldName, string>> = {};
    if (payload.name.length < 2) next.name = "Indiquez votre nom.";
    if (!PHONE_RE.test(payload.phone)) next.phone = "Numéro de téléphone invalide.";
    if (payload.email && !EMAIL_RE.test(payload.email)) next.email = "Adresse e-mail invalide.";
    setErrors(next);
    if (Object.keys(next).length > 0) {
      const first = form.querySelector<HTMLElement>(`[name="${Object.keys(next)[0]}"]`);
      first?.focus();
      return;
    }

    setStatus("loading");
    setMessage("");
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!res.ok || !body?.ok) {
        setStatus("error");
        setMessage(
          body?.error ??
            `Impossible d'enregistrer votre demande pour le moment. Réessayez, ou écrivez-nous à ${CONTACT_EMAIL}.`,
        );
        return;
      }
      setStatus("done");
      form.reset();
    } catch {
      setStatus("error");
      setMessage(
        `Connexion impossible. Vérifiez votre réseau et réessayez, ou écrivez-nous à ${CONTACT_EMAIL}.`,
      );
    }
  };

  return (
    <section className="mk-section" id="contact">
      <div className="mk-wrap">
        <div className="mk-head mk-head--center" data-rv>
          <span className="mk-eyebrow">Contact</span>
          <h2 className="mk-h2">Prêt à reprendre le contrôle de votre service ?</h2>
        </div>

        <div className="mk-panel mk-contact" style={{ marginTop: 32, maxWidth: 940, marginInline: "auto" }} data-rv>
          <div>
            <h3 className="mk-h3">On vous rappelle</h3>
            <p className="mk-body" style={{ marginTop: 10 }}>
              Laissez vos coordonnées — on vous rappelle sous 24 h ouvrées pour caler une démo de 30 minutes, dans
              votre restaurant ou en visio.
            </p>

            <ul className="mk-contact-list" style={{ marginTop: 20 }}>
              <li>
                <MkTick className="mk-tick" />
                Sans engagement, sans carte bancaire
              </li>
              <li>
                <MkTick className="mk-tick" />
                On repart avec vos chiffres, pas avec une plaquette
              </li>
              <li>
                <MkTick className="mk-tick" />
                Offre fondateur : {FOUNDER_SEATS_LEFT} places restantes
              </li>
            </ul>

            <p className="mk-body" style={{ marginTop: 20, paddingTop: 18, borderTop: "1px solid rgba(255,255,255,.06)" }}>
              Vous préférez écrire ?{" "}
              <a className="mk-link" href={`mailto:${CONTACT_EMAIL}`}>
                {CONTACT_EMAIL}
              </a>
            </p>
          </div>

          {status === "done" ? (
            <div className="mk-done" role="status" aria-live="polite">
              <span className="mk-done-ico" aria-hidden="true">
                <MkIcon name="check" size={24} strokeWidth={2.4} />
              </span>
              <strong style={{ fontSize: 19, fontWeight: 700, letterSpacing: "-0.02em" }}>C&apos;est noté !</strong>
              <p className="mk-body" style={{ maxWidth: 320 }}>
                On vous rappelle sous 24 h ouvrées sur le créneau choisi. En attendant, rien à installer, rien à
                préparer.
              </p>
              <button type="button" className="mk-btn mk-btn--quiet" onClick={() => setStatus("idle")}>
                Envoyer une autre demande
              </button>
            </div>
          ) : (
            <form className="mk-form" onSubmit={onSubmit} noValidate>
              <div className="mk-form-row">
                <Field id="ct-name" label="Votre nom" error={errors.name}>
                  <input
                    id="ct-name"
                    name="name"
                    type="text"
                    autoComplete="name"
                    placeholder="Karim B."
                    required
                    aria-invalid={errors.name ? true : undefined}
                    aria-describedby={errors.name ? "ct-name-err" : undefined}
                  />
                </Field>
                <Field id="ct-resto" label="Votre restaurant">
                  <input
                    id="ct-resto"
                    name="restaurant"
                    type="text"
                    autoComplete="organization"
                    placeholder="Class'Food — Rouen"
                  />
                </Field>
              </div>

              <div className="mk-form-row">
                <Field id="ct-tel" label="Téléphone" error={errors.phone}>
                  <input
                    id="ct-tel"
                    name="phone"
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    placeholder="06 12 34 56 78"
                    required
                    aria-invalid={errors.phone ? true : undefined}
                    aria-describedby={errors.phone ? "ct-tel-err" : undefined}
                  />
                </Field>
                <Field id="ct-email" label="E-mail (optionnel)" error={errors.email}>
                  <input
                    id="ct-email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    placeholder="karim@classfood.fr"
                    aria-invalid={errors.email ? true : undefined}
                    aria-describedby={errors.email ? "ct-email-err" : undefined}
                  />
                </Field>
              </div>

              <Field id="ct-when" label="Quand vous rappeler ?">
                <select id="ct-when" name="callbackSlot" defaultValue={CALLBACK_SLOTS[0].value}>
                  {CALLBACK_SLOTS.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </Field>

              <Field id="ct-msg" label="Un mot sur votre besoin (optionnel)">
                <textarea
                  id="ct-msg"
                  name="message"
                  rows={3}
                  placeholder="Ex : 2 caisses, gros rush le midi, pas encore de commande en ligne…"
                />
              </Field>

              {/* Honeypot anti-spam : masqué visuellement et retiré de l'ordre de tabulation. */}
              <div className="mk-hp" aria-hidden="true">
                <label htmlFor="ct-company">Ne remplissez pas ce champ</label>
                <input id="ct-company" name="company" type="text" tabIndex={-1} autoComplete="off" />
              </div>

              {status === "error" ? (
                <p className="mk-alert" data-tone="error" role="alert">
                  {message}
                </p>
              ) : null}

              <button type="submit" className="mk-btn mk-btn--primary mk-btn--block" disabled={status === "loading"}>
                {status === "loading" ? "Envoi en cours…" : "Être rappelé"}
              </button>

              <p className="mk-form-note">
                Vos coordonnées servent uniquement à ce rappel — jamais revendues, jamais utilisées pour autre chose.
              </p>
            </form>
          )}
        </div>
      </div>
    </section>
  );
}

function Field({
  id,
  label,
  error,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mk-field" data-invalid={error ? "true" : undefined}>
      <label htmlFor={id}>{label}</label>
      {children}
      {error ? (
        <span className="mk-err" id={`${id}-err`}>
          {error}
        </span>
      ) : null}
    </div>
  );
}
