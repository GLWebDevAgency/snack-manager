"use client";

import { useState } from "react";
import { TenantSettingsUpdateSchema } from "@sm/contracts";
import { api, type TenantMe } from "@/lib/api";
import { Btn, Field, Input, Panel, useToast } from "@/components/ui";

export function SlotSettingsPanel({ settings, onSaved }: { settings: TenantMe['settings']; onSaved: (settings: TenantMe['settings']) => void }) {
  const toast = useToast();
  const [interval, setInterval] = useState(String(settings.slotIntervalMin ?? 10));
  const [capacity, setCapacity] = useState(String(settings.slotCapacity ?? 4));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = Number(interval) !== settings.slotIntervalMin || Number(capacity) !== settings.slotCapacity;
  async function save() {
    if (busy) return;
    const parsed = TenantSettingsUpdateSchema.safeParse({ slotIntervalMin: Number(interval), slotCapacity: Number(capacity) });
    if (!parsed.success) { setError('Prévoyez un intervalle entier de 5 à 60 minutes et de 1 à 100 commandes par créneau.'); return; }
    setBusy(true); setError(null);
    try {
      const updated = await api.patch<TenantMe>('/tenants/me/settings', parsed.data);
      onSaved(updated.settings); toast('Capacité des créneaux enregistrée', { icon: 'check' });
    } catch { setError('Enregistrement impossible. Vos réglages précédents sont conservés.'); }
    finally { setBusy(false); }
  }
  return <Panel title="Créneaux de commande" sub="Une cadence adaptée à votre cuisine">
    <form onSubmit={(event) => { event.preventDefault(); void save(); }} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Intervalle (minutes)" htmlFor="slot-interval"><Input id="slot-interval" type="number" min={5} max={60} step={1} required value={interval} onChange={(e) => setInterval(e.target.value)} disabled={busy} /></Field>
        <Field label="Commandes par créneau" htmlFor="slot-capacity"><Input id="slot-capacity" type="number" min={1} max={100} step={1} required value={capacity} onChange={(e) => setCapacity(e.target.value)} disabled={busy} /></Field>
      </div>
      <p className="text-sm leading-relaxed text-mut">Cette capacité est commune au retrait et à la livraison. Le module livraison permet d’ajouter une limite spécifique et un délai estimé de transport. Les commandes déjà prises restent conservées.</p>
      {error && <p role="alert" className="text-sm text-alertt">{error}</p>}
      <Btn type="submit" disabled={busy || !dirty}>{busy ? 'Enregistrement…' : 'Enregistrer les créneaux'}</Btn>
    </form>
  </Panel>;
}
