"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { CALLBACK_SLOTS, CONTACT_EMAIL, CONTACT_PLATFORMS, CONTACT_POINTS, CTA_CALLBACK, section } from "./content";
import { LogoMark } from "../brand/Logo";
import { TickDot } from "./icons";
import { LEAD_INTENT_EVENT, LEAD_NEEDS, needFromSearch, type LeadNeed } from "./notch/lead-intent";
import { contactAttempt, isContactReceipt, validateContactPayload, type ContactAttempt, type ContactFieldErrors, type ContactPayload } from "./contact-request";

type Status = "idle" | "loading" | "done" | "error";
const UNCONFIRMED = `Nous ne pouvons pas confirmer l’enregistrement de votre demande. Réessayez, ou écrivez-nous à ${CONTACT_EMAIL}.`;
function subscribeNeed(notify: () => void) {
  window.addEventListener(LEAD_INTENT_EVENT, notify);
  window.addEventListener("popstate", notify);
  return () => { window.removeEventListener(LEAD_INTENT_EVENT, notify); window.removeEventListener("popstate", notify); };
}
const readNeed = () => needFromSearch(window.location.search);
const emptyNeed = () => "" as const;

/** The receipt confirms durable intake, independently of notification delivery. */
export function ContactSection() {
  const { title } = section("contact");
  const [status, setStatus] = useState<Status>("idle");
  const [errors, setErrors] = useState<ContactFieldErrors>({});
  const [message, setMessage] = useState("");
  const [reference, setReference] = useState<string | null>(null);
  const urlNeed = useSyncExternalStore(subscribeNeed, readNeed, emptyNeed);
  const [manualNeed, setManualNeed] = useState<LeadNeed | "" | null>(null);
  const need = manualNeed ?? urlNeed;
  const successRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const returnToForm = useRef(false);
  const submitting = useRef(false);
  const attempt = useRef<ContactAttempt | null>(null);
  useEffect(() => {
    const reset = () => {
      setManualNeed(null);
      // A new project choice must not land on a previous request's receipt.
      // Keep an in-flight request intact; only reopen a completed form.
      setStatus((current) => current === "done" ? "idle" : current);
    };
    window.addEventListener(LEAD_INTENT_EVENT, reset);
    window.addEventListener("popstate", reset);
    return () => { window.removeEventListener(LEAD_INTENT_EVENT, reset); window.removeEventListener("popstate", reset); };
  }, []);
  useEffect(() => {
    if (status === "done") successRef.current?.focus();
    if (status === "idle" && returnToForm.current) {
      formRef.current?.querySelector<HTMLInputElement>('[name="name"]')?.focus();
      returnToForm.current = false;
    }
  }, [status]);

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (submitting.current || status === "done") return;
    const form = e.currentTarget;
    const data = new FormData(form);

    const payload: ContactPayload = {
      name: String(data.get("name") ?? "").trim(),
      restaurant: String(data.get("restaurant") ?? "").trim(),
      phone: String(data.get("phone") ?? "").trim(),
      email: String(data.get("email") ?? "").trim().toLowerCase(),
      callbackSlot: String(data.get("callbackSlot") ?? ""),
      need,
      message: String(data.get("message") ?? "").trim(),
      /*
       * Une case décochée n'apparaît pas du tout dans un `FormData` : on ne
       * peut pas lire sa valeur, seulement son absence. La normalisation en
       * booléen EST la validation de ce champ — côté serveur, `route.ts` refait
       * exactement le même test (`=== true`) sans faire confiance à celui-ci.
       */
      platforms: data.get(CONTACT_PLATFORMS.name) === "on",
    };

    const next = validateContactPayload(payload);
    setErrors(next);
    if (Object.keys(next).length > 0) {
      form.querySelector<HTMLElement>(`[name="${Object.keys(next)[0]}"]`)?.focus();
      return;
    }

    submitting.current = true;
    setStatus("loading");
    setMessage("");
    try {
      const currentAttempt = contactAttempt(payload, attempt.current);
      attempt.current = currentAttempt;
      const res = await fetch("/api/contact", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        redirect: "error",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ ...payload, requestId: currentAttempt.requestId }),
        signal: AbortSignal.timeout(14000),
      });
      const body = (await res.json().catch(() => null)) as { ok?: unknown; stored?: unknown; requestId?: unknown; error?: unknown } | null;
      if (!res.ok || !isContactReceipt(body, currentAttempt.requestId)) {
        setStatus("error");
        setMessage(typeof body?.error === "string" && body.error.length <= 300 ? body.error : UNCONFIRMED);
        return;
      }
      setReference(body.requestId);
      attempt.current = null;
      setStatus("done");
      form.reset();
    } catch {
      setStatus("error");
      setMessage(UNCONFIRMED);
    } finally {
      submitting.current = false;
    }
  };

  return (
    <section className="cta-section" id="contact">
      <div className="cta-line" aria-hidden="true" />
      <div className="cta-inner rv">
        <div className="cta-logochip">
          <LogoMark size={18} />
          <span className="logo-wordmark" style={{ fontSize: 19 }}>
            Snack Manager
          </span>
        </div>
        <h2 className="h2 cta-heading" tabIndex={-1}>{title}</h2>

        <div className="ct-card rv">
          <div className="ct-left">
            <p className="ct-title">Votre projet, étape par étape</p>
            <p className="ct-sub">
              Décrivez votre priorité et choisissez le moment qui vous convient pour échanger. Nous préparons avec vous une démonstration ou un devis adapté à votre restaurant.
            </p>
            <div className="ct-points">
              {CONTACT_POINTS.map((point) => (
                <span className="ct-point" key={point}>
                  <TickDot size={13} />
                  {point}
                </span>
              ))}
            </div>
          </div>

          {status === "done" ? (
            <div className="ct-done" role="status" aria-live="polite" tabIndex={-1} ref={successRef}>
              <TickDot size={40} />
              <p className="ct-donetitle">Demande enregistrée</p>
              <p className="ct-donesub">Nous vous recontacterons aux coordonnées indiquées pour parler de votre projet.</p>
              {reference && <p className="ct-reference">Référence : <span>{reference}</span></p>}
              <button type="button" className="btn dark" onClick={() => { attempt.current = null; setReference(null); setErrors({}); returnToForm.current = true; setStatus("idle"); }}>
                Envoyer une autre demande
              </button>
            </div>
          ) : (
            <form className="ct-form" method="post" action="/api/contact" onSubmit={onSubmit} noValidate ref={formRef} aria-busy={status === "loading"}>
              <p className="ct-required">Votre nom et votre téléphone suffisent pour demander un rappel.</p>
              <fieldset className="ct-fields" disabled={status === "loading"} aria-label="Votre demande de rappel">
                <div className="ct-row">
                  <Field id="ct-name" label="Votre nom" error={errors.name}>
                    <input
                      id="ct-name"
                      name="name"
                      type="text"
                      autoComplete="name"
                      placeholder="Votre prénom et votre nom"
                      required
                      maxLength={120}
                      aria-invalid={errors.name ? true : undefined}
                      aria-describedby={errors.name ? "ct-name-err" : undefined}
                    />
                  </Field>
                  <Field id="ct-resto" label="Votre restaurant" optional>
                    <input
                      id="ct-resto"
                      name="restaurant"
                      type="text"
                      autoComplete="organization"
                      maxLength={160}
                      placeholder="Nom du restaurant et ville"
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
                      maxLength={32}
                      aria-invalid={errors.phone ? true : undefined}
                      aria-describedby={errors.phone ? "ct-tel-err" : undefined}
                    />
                  </Field>
                  <Field id="ct-email" label="E-mail" error={errors.email} optional>
                    <input
                      id="ct-email"
                      name="email"
                      type="email"
                      inputMode="email"
                      autoComplete="email"
                      autoCapitalize="none"
                      spellCheck={false}
                      placeholder="nom@restaurant.fr"
                      maxLength={160}
                      aria-invalid={errors.email ? true : undefined}
                      aria-describedby={`ct-email-help${errors.email ? " ct-email-err" : ""}`}
                    />
                    <p className="ct-help" id="ct-email-help">Pour recevoir une réponse écrite si nécessaire.</p>
                  </Field>
                </div>

                <div className="ct-row">
                  <Field id="ct-when" label="Quand vous rappeler ?">
                    <select id="ct-when" name="callbackSlot" defaultValue={CALLBACK_SLOTS[0].value}>
                      {CALLBACK_SLOTS.map((s) => (
                        <option key={s.value} value={s.value}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field id="ct-need" label="Votre priorité" optional>
                    <select id="ct-need" name="need" value={need} onChange={(event) => setManualNeed(event.target.value as LeadNeed | "")}>
                      <option value="">Choisir un besoin</option>
                      {Object.entries(LEAD_NEEDS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                  </Field>
                </div>
                <Field id="ct-msg" label="Un mot sur votre besoin" optional>
                  <textarea
                    id="ct-msg"
                    name="message"
                    rows={3}
                    maxLength={1800}
                    placeholder="Votre équipement, le nombre de produits de votre carte, les supports souhaités, votre date de lancement…"
                  />
                </Field>

                {/* La case à cocher, et sa raison d'être écrite juste dessous. */}
                <div className="ct-check">
                  <label className="ct-checkrow" htmlFor="ct-platforms">
                    <input
                      id="ct-platforms"
                      name={CONTACT_PLATFORMS.name}
                      type="checkbox"
                      aria-describedby="ct-platforms-help"
                    />
                    <span className="ct-checklabel">{CONTACT_PLATFORMS.label}</span>
                  </label>
                  <p className="ct-checkhelp" id="ct-platforms-help">
                    {CONTACT_PLATFORMS.help}
                  </p>
                </div>
              </fieldset>

              {status === "error" ? (
                <p className="ct-alert" role="alert">
                  {message}
                </p>
              ) : null}

              <button type="submit" className="btn light ct-submit" disabled={status === "loading"}>
                {status === "loading" ? "Envoi en cours…" : CTA_CALLBACK}
              </button>
              <p className="ct-privacy">Vos coordonnées servent au traitement de votre demande. Aucune inscription à une liste de diffusion.</p>
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
