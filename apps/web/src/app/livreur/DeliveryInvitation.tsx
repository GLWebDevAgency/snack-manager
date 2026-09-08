"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Btn } from "@/components/ui/Btn";
import type { AccessState } from "./access-client";

export type DeliveryInvitationProps = {
  state: AccessState;
  /** Projected from the client's exact guard, including its private absence confirmation. */
  canImport: boolean;
  /** Prepares a capability in page memory only. Never associates automatically. */
  onImport: (rawLink: string) => boolean;
};

/** No clipboard API, URL navigation, persistent storage or credential in React state. */
export function DeliveryInvitation({ state, canImport, onImport }: DeliveryInvitationProps) {
  const [prepared, setPrepared] = useState(false);
  if (state.session || state.exchangePending || state.logoutPending) return null;
  if (state.hasInvitation) return prepared ? <InvitationPrepared /> : null;
  const blocked = !canImport;
  return <InvitationEntry key={blocked ? "blocked" : "ready"} disabled={blocked}
    reopen={state.reason === "browser" || state.reason === "invalid"} onImport={raw => {
    if (!onImport(raw)) return false;
    setPrepared(true); return true;
  }} />;
}

function InvitationPrepared() {
  const message = useRef<HTMLParagraphElement>(null);
  useEffect(() => { message.current?.focus(); }, []);
  return <p ref={message} tabIndex={-1} role="status" className="mt-5 rounded-card border border-line p-4 text-sm leading-6 text-mut outline-none">
    Invitation préparée. Confirmez avec « Associer ce téléphone » pour vérifier l’accès auprès du restaurant.
  </p>;
}

function InvitationEntry({ disabled, reopen, onImport }: { disabled: boolean; reopen: boolean; onImport: (raw: string) => boolean }) {
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLDivElement>(null);
  const restoreFocus = useRef(false);
  useEffect(() => {
    if (!open && restoreFocus.current) { restoreFocus.current = false; opener.current?.querySelector("button")?.focus(); }
  }, [open]);
  return <section className="mt-5" aria-label="Invitation du restaurant">
    {open && !disabled ? <InvitationForm onImport={onImport} onClose={() => { restoreFocus.current = true; setOpen(false); }} />
      : <div ref={opener}><Btn block variant="ghost" disabled={disabled} className="min-h-12 whitespace-normal" onClick={() => setOpen(true)}>Coller mon invitation</Btn></div>}
    {disabled && <p className="mt-2 text-xs leading-5 text-mut">{reopen
      ? "Fermez cette page puis rouvrez SM Livreur sans lien d’invitation. Demandez ensuite un nouveau lien au restaurant."
      : "Vérifiez d’abord votre accès en ligne avant de coller une invitation."}</p>}
  </section>;
}

function InvitationForm({ onImport, onClose }: { onImport: (raw: string) => boolean; onClose: () => void }) {
  const id = useId();
  const field = useRef<HTMLTextAreaElement>(null);
  const [hasValue, setHasValue] = useState(false);
  const [invalid, setInvalid] = useState(false);
  useEffect(() => {
    const input = field.current; input?.focus();
    return () => { if (input) input.value = ""; };
  }, []);
  function close() { if (field.current) field.current.value = ""; onClose(); }
  return <form className="rounded-card border border-line bg-ink/3 p-4" autoComplete="off"
    onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); } }}
    onSubmit={event => {
      event.preventDefault();
      const input = field.current; if (!input) return;
      const value = input.value; input.value = ""; setHasValue(false);
      try { if (onImport(value)) { onClose(); return; } } catch { /* No raw error or link in feedback. */ }
      setInvalid(true); input.focus();
    }}>
    <label htmlFor={id} className="block text-sm font-semibold">Lien d’invitation</label>
    <p id={`${id}-help`} className="mt-2 text-xs leading-5 text-mut">Copiez le lien transmis par le restaurant, puis collez-le ici. L’association demandera ensuite votre confirmation.</p>
    <textarea ref={field} id={id} rows={3} maxLength={2048} autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false}
      aria-describedby={`${id}-help${invalid ? ` ${id}-error` : ""}`} aria-invalid={invalid}
      onChange={event => { setHasValue(Boolean(event.currentTarget.value.trim())); setInvalid(false); }}
      className="mt-3 block min-h-24 w-full resize-y rounded-card border border-linefirm bg-bg px-3 py-3 text-[16px] leading-6 text-ink outline-none focus:border-focus" />
    {invalid && <p id={`${id}-error`} role="alert" className="mt-3 text-sm leading-6 text-prept">Ce lien ne peut pas être préparé. Vérifiez votre accès et utilisez une invitation destinée à cette application.</p>}
    <div className="mt-4 flex flex-col gap-2">
      <Btn type="submit" block disabled={!hasValue} className="min-h-12 whitespace-normal">Préparer cette invitation</Btn>
      <Btn block variant="ghost" className="min-h-11 whitespace-normal" onClick={close}>Fermer la saisie</Btn>
    </div>
    <p className="mt-4 text-xs leading-5 text-mut">Lien déjà utilisé dans Safari ou un autre navigateur ? Demandez une nouvelle invitation au restaurant. Ce collage ne transfère pas l’accès entre applications.</p>
  </form>;
}
