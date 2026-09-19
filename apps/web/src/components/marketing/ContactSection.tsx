"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { CALLBACK_SLOTS, CONTACT_EMAIL, CONTACT_PLATFORMS, CONTACT_POINTS, CTA_CALLBACK, section } from "./content";
import { LogoMark } from "../brand/Logo";
import { TickDot } from "./icons";
import { LEAD_INTENT_EVENT, LEAD_NEEDS, needFromSearch, type LeadNeed } from "./notch/lead-intent";

type Status = "idle" | "loading" | "done" | "error";
type FieldName = "name" | "phone";

const PHONE_RE = /^[+0-9][0-9\s.\-()]{7,19}$/;
function subscribeNeed(notify: () => void) {
  window.addEventListener(LEAD_INTENT_EVENT, notify);
  window.addEventListener("popstate", notify);
  return () => { window.removeEventListener(LEAD_INTENT_EVENT, notify); window.removeEventListener("popstate", notify); };
}
const readNeed = () => needFromSearch(window.location.search);
const emptyNeed = () => "" as const;

/**
 * Le bloc de conversion : bandeau CTA + formulaire de rappel.
 *
 * Contrairement à la maquette (qui ne faisait que basculer un état visuel), le
 * formulaire poste réellement sur `/api/contact` — validation côté client
 * doublée côté serveur, états chargement /
 * succès / erreur explicites. CETTE MÉCANIQUE NE BOUGE PAS.
 *
 * TROIS RETOUCHES, ET UNE SEULE AJOUTE QUELQUE CHOSE. Le titre cesse
 * d'interroger — le message de succès dit déjà ce qu'on fait, autant l'annoncer
 * dans le `h2`. Le décompte de places est parti : il affirmait trois
 * clients signés que nous n'avons pas, c'était le seul énoncé de la page qu'un
 * prospect pouvait vérifier d'un coup de téléphone. Et une case à cocher entre,
 * qui est l'atterrissage du service d'optimisation des pages de plateformes :
 * ce n'est PAS une question que le visiteur se pose sur cette page, mais le
 * formulaire est le seul endroit où c'est NOUS qui posons les questions — et
 * une question qu'on pose devient légitime. Sa ligne d'aide n'est pas
 * décorative : une case sans motif est une friction, une case avec sa phrase
 * est une question.
 */
export function ContactSection() {
  const { title } = section("contact");
  const [status, setStatus] = useState<Status>("idle");
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [message, setMessage] = useState("");
  const urlNeed = useSyncExternalStore(subscribeNeed, readNeed, emptyNeed);
  const [manualNeed, setManualNeed] = useState<LeadNeed | "" | null>(null);
  const need = manualNeed ?? urlNeed;
  const successRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const returnToForm = useRef(false);
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
    const form = e.currentTarget;
    const data = new FormData(form);

    const payload = {
      name: String(data.get("name") ?? "").trim(),
      restaurant: String(data.get("restaurant") ?? "").trim(),
      phone: String(data.get("phone") ?? "").trim(),
      email: "",
      callbackSlot: String(data.get("callbackSlot") ?? ""),
      message: [need ? `Besoin : ${LEAD_NEEDS[need]}` : "", String(data.get("message") ?? "").trim()].filter(Boolean).join("\n"),
      /*
       * Une case décochée n'apparaît pas du tout dans un `FormData` : on ne
       * peut pas lire sa valeur, seulement son absence. La normalisation en
       * booléen EST la validation de ce champ — côté serveur, `route.ts` refait
       * exactement le même test (`=== true`) sans faire confiance à celui-ci.
       */
      platforms: data.get(CONTACT_PLATFORMS.name) === "on",
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
              Décrivez votre priorité. Nous vous rappelons sous 24 h ouvrées pour préparer une démonstration ou un devis adapté à votre restaurant.
            </p>
            <div className="ct-points">
              {CONTACT_POINTS.map((point) => (
                <span className="ct-point" key={point}>
                  <TickDot size={13} />
                  {point}
                </span>
              ))}
            </div>
            <p className="ct-alt">
              Vous préférez écrire ?{" "}
              <a href={`mailto:${CONTACT_EMAIL}`} className="ct-maillink">
                {CONTACT_EMAIL}
              </a>
            </p>
          </div>

          {status === "done" ? (
            <div className="ct-done" role="status" aria-live="polite" tabIndex={-1} ref={successRef}>
              <TickDot size={40} />
              <p className="ct-donetitle">C&apos;est noté !</p>
              <p className="ct-donesub">On vous rappelle sous 24 h ouvrées sur le créneau choisi.</p>
              <button type="button" className="btn dark" onClick={() => { returnToForm.current = true; setStatus("idle"); }}>
                Envoyer une autre demande
              </button>
            </div>
          ) : (
            <form className="ct-form" onSubmit={onSubmit} noValidate ref={formRef}>
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
                <Field id="ct-resto" label="Votre restaurant">
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

              <Field id="ct-need" label="Votre priorité" optional>
                <select id="ct-need" name="need" value={need} onChange={(event) => setManualNeed(event.target.value as LeadNeed | "")}>
                  <option value="">Choisir un besoin</option>
                  {Object.entries(LEAD_NEEDS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </Field>
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

              {status === "error" ? (
                <p className="ct-alert" role="alert">
                  {message}
                </p>
              ) : null}

              <button type="submit" className="btn light ct-submit" disabled={status === "loading"}>
                {status === "loading" ? "Envoi en cours…" : CTA_CALLBACK}
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
