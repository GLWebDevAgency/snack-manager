"use client";

import { useState } from "react";
import { CALLBACK_SLOTS, CONTACT_EMAIL, FOUNDER_SEATS_LEFT } from "./content";
import { LogoMark, TickDot } from "./icons";

type Status = "idle" | "loading" | "done" | "error";
type FieldName = "name" | "phone";

const PHONE_RE = /^[+0-9][0-9\s.\-()]{7,19}$/;

/**
 * Le bloc de conversion : bandeau CTA + formulaire de rappel.
 *
 * Contrairement à la maquette (qui ne faisait que basculer un état visuel), le
 * formulaire poste réellement sur `/api/contact` — validation côté client
 * doublée côté serveur, honeypot invisible (`company`), états chargement /
 * succès / erreur explicites.
 */
export function ContactSection() {
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
      email: "",
      callbackSlot: String(data.get("callbackSlot") ?? ""),
      message: String(data.get("message") ?? "").trim(),
      company: String(data.get("company") ?? ""),
    };

    const next: Partial<Record<FieldName, string>> = {};
    if (payload.name.length < 2) next.name = "Indiquez votre nom.";
    if (!PHONE_RE.test(payload.phone)) next.phone = "Numéro de téléphone invalide.";
    setErrors(next);
    if (Object.keys(next).length > 0) {
      form.querySelector<HTMLElement>(`[name="${Object.keys(next)[0]}"]`)?.focus();
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
      setMessage(`Connexion impossible. Vérifiez votre réseau et réessayez, ou écrivez-nous à ${CONTACT_EMAIL}.`);
    }
  };

  return (
    <section className="cta-section" id="contact">
      <div className="cta-line" aria-hidden="true" />
      <div className="cta-inner rv">
        <div className="cta-logochip">
          <LogoMark width={18} height={18} />
          <span className="logo-wordmark" style={{ fontSize: 19 }}>
            Snack Manager
          </span>
        </div>
        <h2 className="h2 cta-heading">Prêt à reprendre le contrôle de votre service ?</h2>

        <div className="ct-card rv">
          <div className="ct-left">
            <p className="ct-title">On vous rappelle</p>
            <p className="ct-sub">
              Laissez vos coordonnées — on vous rappelle sous 24 h ouvrées pour caler une démo de 30 min, dans votre
              restaurant ou en visio.
            </p>
            <div className="ct-points">
              <span className="ct-point">
                <TickDot size={13} />
                Sans engagement, sans carte bancaire
              </span>
              <span className="ct-point">
                <TickDot size={13} />
                On repart avec vos chiffres du simulateur
              </span>
              <span className="ct-point">
                <TickDot size={13} />
                Offre fondateur : {FOUNDER_SEATS_LEFT} places restantes
              </span>
            </div>
            <p className="ct-alt">
              Vous préférez écrire ?{" "}
              <a href={`mailto:${CONTACT_EMAIL}`} className="ct-maillink">
                {CONTACT_EMAIL}
              </a>
            </p>
          </div>

          {status === "done" ? (
            <div className="ct-done" role="status" aria-live="polite">
              <TickDot size={40} />
              <p className="ct-donetitle">C&apos;est noté !</p>
              <p className="ct-donesub">On vous rappelle sous 24 h ouvrées sur le créneau choisi.</p>
              <button type="button" className="btn dark" onClick={() => setStatus("idle")}>
                Envoyer une autre demande
              </button>
            </div>
          ) : (
            <form className="ct-form" onSubmit={onSubmit} noValidate>
              <div className="ct-row">
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

              <div className="ct-row">
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
                <Field id="ct-when" label="Quand vous rappeler ?">
                  <select id="ct-when" name="callbackSlot" defaultValue={CALLBACK_SLOTS[0].value}>
                    {CALLBACK_SLOTS.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>

              <Field id="ct-msg" label="Un mot sur votre besoin" optional>
                <textarea
                  id="ct-msg"
                  name="message"
                  rows={3}
                  placeholder="Ex : 2 caisses, gros rush le midi, pas encore de commande en ligne…"
                />
              </Field>

              {/* Honeypot : masqué visuellement, hors de l'ordre de tabulation. */}
              <div className="ct-hp" aria-hidden="true">
                <label htmlFor="ct-company">Ne remplissez pas ce champ</label>
                <input id="ct-company" name="company" type="text" tabIndex={-1} autoComplete="off" />
              </div>

              {status === "error" ? (
                <p className="ct-alert" role="alert">
                  {message}
                </p>
              ) : null}

              <button type="submit" className="btn light ct-submit" disabled={status === "loading"}>
                {status === "loading" ? "Envoi en cours…" : "Être rappelé"}
              </button>
              <p className="ct-privacy">Vos coordonnées servent uniquement à ce rappel — jamais revendues.</p>
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
  optional,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  optional?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="ct-field" data-invalid={error ? "true" : undefined}>
      <label htmlFor={id}>
        {label} {optional ? <em>(optionnel)</em> : null}
      </label>
      {children}
      {error ? (
        <span className="ct-err" id={`${id}-err`}>
          {error}
        </span>
      ) : null}
    </div>
  );
}
