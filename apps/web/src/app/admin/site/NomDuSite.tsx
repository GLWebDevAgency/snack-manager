"use client";
import { useEffect, useRef, useState } from "react";
import { TenantIdentityUpdateSchema } from "@sm/contracts";
import { api, type TenantMe } from "@/lib/api";
import { useSiteEditScope } from "./site-scope";
import { Btn, Field, Input, Panel } from "@/components/ui";
import { clearNameDraft, readNameDraft, writeNameDraft, type NameDraft } from "./name-draft";

export function NomDuSite({ tenant, onSaved, onDirty, onBusy, onDraft }: { tenant: TenantMe; onSaved: (tenant: TenantMe) => void; onDirty: (dirty: boolean) => void; onBusy: (busy: boolean) => void; onDraft: (name: string) => void }) {
  const scope = useSiteEditScope();
  const [name, setName] = useState(tenant.name), [saved, setSaved] = useState(tenant.name);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), [ack, setAck] = useState(false);
  const [draftReady, setDraftReady] = useState(false), [recovery, setRecovery] = useState<NameDraft | null>(null);
  const alive = useRef(false), lock = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const dirty = name.trim() !== saved;
  useEffect(() => {
    let current = true;
    void Promise.resolve().then(() => {
      if (!current) return;
      const stored = readNameDraft(tenant._id); setDraftReady(true);
      if (!stored || stored.draft.trim() === tenant.name) return;
      if (stored.base === tenant.name) setName(stored.draft); else setRecovery(stored);
    });
    return () => { current = false; };
    // Le parent remonte l'éditeur à chaque établissement/session, pas à chaque ACK.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant._id]);
  useEffect(() => { if (!draftReady || recovery) return; if (dirty) writeNameDraft(tenant._id, saved, name); else clearNameDraft(tenant._id); }, [draftReady, recovery, dirty, tenant._id, saved, name]);
  useEffect(() => { onDirty(dirty); onBusy(busy); onDraft(name); }, [dirty, busy, onDirty, onBusy, onDraft, name]);
  async function save() {
    if (lock.current || !dirty || !scope.current()) return;
    const parsed = TenantIdentityUpdateSchema.safeParse({ name: name.trim() });
    if (!parsed.success) { setError("Saisissez un nom de restaurant valide."); return; }
    lock.current = true; setBusy(true); setError(null); setAck(false);
    try {
      const next = await api.patch<TenantMe>("/tenants/me/identity", parsed.data);
      if (!alive.current || !scope.current()) return;
      clearNameDraft(tenant._id); setName(next.name); setSaved(next.name); setAck(true); onSaved(next);
    } catch { if (alive.current) setError("Le nom n’a pas pu être enregistré. Votre saisie est conservée."); }
    finally { lock.current = false; if (alive.current) setBusy(false); }
  }
  if (!scope.valid) return null;
  return <Panel title="Le nom de votre restaurant" sub="Il accompagne votre logo sur la commande, la caisse et vos autres écrans.">
    {recovery && <div className="mb-4 space-y-2"><p className="text-sm text-mut">Le nom a changé depuis votre brouillon. Le nom en ligne est conservé tant que vous ne reprenez pas votre saisie.</p><div className="flex flex-wrap gap-2">
      <Btn variant="ghost" onClick={() => { clearNameDraft(tenant._id); setRecovery(null); }}>Garder le nom en ligne</Btn>
      <Btn onClick={() => { setName(recovery.draft); setRecovery(null); }}>Reprendre le nom saisi</Btn>
    </div></div>}
    <form onSubmit={event => { event.preventDefault(); void save(); }} className="space-y-3">
      <Field label="Nom affiché" htmlFor="site-restaurant-name"><Input id="site-restaurant-name" value={name} disabled={busy} maxLength={80} onChange={event => { setName(event.target.value); setAck(false); }} /></Field>
      <div className="flex flex-wrap items-center gap-3"><Btn type="submit" disabled={!dirty || busy}>{busy ? "Enregistrement…" : "Enregistrer le nom"}</Btn>{dirty && <Btn variant="ghost" disabled={busy} onClick={() => { setName(saved); setError(null); setAck(false); clearNameDraft(tenant._id); }}>Annuler le nom</Btn>}{ack && <span role="status" className="text-xs text-mut">Nom enregistré.</span>}</div>
      {error && <p role="alert" className="text-sm text-alertt">{error}</p>}
    </form>
  </Panel>;
}
