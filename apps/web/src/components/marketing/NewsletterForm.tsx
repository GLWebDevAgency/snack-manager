"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import styles from "./newsletter.module.css";

type Feedback = { kind: "error" | "pending"; message: string; field?: "email" | "consent" } | null;
const UNAVAILABLE = "Le service ne peut pas confirmer votre demande pour le moment. Vérifiez votre messagerie avant toute nouvelle tentative.";

export function NewsletterForm() {
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const feedbackRef = useRef<HTMLParagraphElement>(null);
  const submitting = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const restoreEmailFocus = useRef(false);
  const pending = feedback?.kind === "pending";

  useEffect(() => {
    if (feedback) feedbackRef.current?.focus();
    else if (restoreEmailFocus.current) {
      restoreEmailFocus.current = false;
      formRef.current?.querySelector<HTMLInputElement>('input[name="email"]')?.focus();
    }
  }, [feedback]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || pending) return;
    const data = new FormData(event.currentTarget);
    const email = String(data.get("email") ?? "").trim();
    const consent = data.get("consent") === "yes";
    if (email.length > 254 || !/^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]{2,}$/.test(email)) {
      setFeedback({ kind: "error", field: "email", message: "Indiquez une adresse e-mail valide." });
      return;
    }
    if (!consent) {
      setFeedback({ kind: "error", field: "consent", message: "Cochez la case si vous souhaitez recevoir nos nouveautés et nos offres par e-mail." });
      return;
    }
    submitting.current = true;
    setBusy(true);
    setFeedback(null);
    try {
      const result = await fetch("/api/newsletter", {
        method: "POST", credentials: "same-origin", cache: "no-store", redirect: "error",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ email, consent: true, newsletterWebsite: String(data.get("newsletterWebsite") ?? "") }),
        signal: AbortSignal.timeout(28000),
      });
      const body: unknown = await result.json();
      if (result.status === 202 && body && typeof body === "object"
        && (body as Record<string, unknown>).ok === true && (body as Record<string, unknown>).pending === true) {
        setFeedback({ kind: "pending", message: "Demande reçue. Consultez votre messagerie et cliquez sur le lien de confirmation pour finaliser votre inscription. Pensez aussi aux courriers indésirables." });
      } else {
        setFeedback({ kind: "error", message: result.status === 429
          ? "Trop de demandes ont été reçues. Vérifiez votre messagerie et patientez quelques minutes avant de réessayer."
          : result.status === 400 ? "Vérifiez votre adresse e-mail et votre consentement." : UNAVAILABLE });
      }
    } catch {
      setFeedback({ kind: "error", message: UNAVAILABLE });
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return <div className={`foot-newsletter ${styles.newsletter}`}>
    <p className="subheading foot-newsletterlabel">Les nouvelles de Snack Manager</p>
    <form className={`foot-form ${styles.form}`} ref={formRef} method="post" action="/api/newsletter" onSubmit={submit} noValidate aria-busy={busy}>
      <label className={styles.emailLabel} htmlFor={`${id}-email`}>Votre adresse e-mail</label>
      <div className={styles.entry}>
        <input id={`${id}-email`} type="email" name="email" placeholder="nom@email.com" className="foot-input" autoComplete="email" inputMode="email" maxLength={254} required disabled={busy || pending} aria-invalid={feedback?.field === "email" || undefined} aria-describedby={`${id}-privacy ${id}-feedback`} />
        <button type="submit" className="foot-subscribe" disabled={busy || pending}>{busy ? "Envoi…" : pending ? "En attente" : "M’inscrire"}</button>
      </div>
      <div className={styles.honeypot} aria-hidden="true">
        <label htmlFor={`${id}-website`}>Laissez ce champ vide</label>
        <input id={`${id}-website`} name="newsletterWebsite" type="text" tabIndex={-1} autoComplete="off" />
      </div>
      <label className={styles.consent} htmlFor={`${id}-consent`}>
        <input id={`${id}-consent`} name="consent" type="checkbox" value="yes" required disabled={busy || pending} aria-invalid={feedback?.field === "consent" || undefined} aria-describedby={`${id}-privacy ${id}-feedback`} />
        <span>J’accepte de recevoir par e-mail les nouveautés et les offres de Snack Manager.</span>
      </label>
      <p id={`${id}-privacy`} className={styles.privacy}>Votre inscription nécessite une confirmation par e-mail. Envoi et gestion de l’abonnement via Brevo. Désinscription possible depuis chaque e-mail.</p>
      <p id={`${id}-feedback`} ref={feedbackRef} className={styles.feedback} data-kind={feedback?.kind} role="status" aria-live="polite" aria-atomic="true" tabIndex={-1} hidden={!busy && !feedback}>{busy ? "Envoi de votre demande…" : feedback?.message}</p>
      {pending && <button type="button" className={styles.reset} onClick={() => { formRef.current?.reset(); restoreEmailFocus.current = true; setFeedback(null); }}>Utiliser une autre adresse</button>}
    </form>
  </div>;
}
