"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { DeliverySettingsSchema, type DeliverySettings } from "@sm/contracts";
import { api } from "@/lib/api";
import { Btn, EmptyState, Field, Input, Panel, Pill, Skeleton, Textarea, Toggle, useToast } from "@/components/ui";
import { newDeliveryZone, parseDeliveryDraft, toDeliveryDraft, type DeliveryDraft, type DeliveryZoneDraft } from "./delivery-draft";
import { ZonePricingFields } from "./ZonePricingFields";
import { DeliveryOperatorsPanel } from "./DeliveryOperatorsPanel";

export default function DeliveryPage() {
  const toast = useToast();
  const [draft, setDraft] = useState<DeliveryDraft | null>(null);
  const [saved, setSaved] = useState<DeliveryDraft | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);

  const load = useCallback(async () => {
    setLoadError(false);
    try {
      const response = await api.get<DeliverySettings>("/delivery/settings");
      const next = toDeliveryDraft(DeliverySettingsSchema.parse(response));
      setDraft(next);
      setSaved(next);
    } catch { setLoadError(true); }
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrate la configuration distante et sa référence de comparaison ensemble.
    void load();
  }, [load]);

  function updateZone(id: string, patch: Partial<DeliveryZoneDraft>) {
    setDraft((current) => current ? { ...current, zones: current.zones.map((zone) => zone.id === id ? { ...zone, ...patch } : zone) } : current);
  }

  async function save() {
    if (!draft || saving) return;
    const parsed = parseDeliveryDraft(draft);
    if (!parsed.success) {
      setError(parsed.message);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const response = await api.patch<DeliverySettings>("/delivery/settings", parsed.data);
      const next = toDeliveryDraft(DeliverySettingsSchema.parse(response));
      setDraft(next);
      setSaved(next);
      toast("Livraison enregistrée", { icon: "check" });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "L’enregistrement n’a pas abouti. Réessayez.");
    } finally { setSaving(false); }
  }

  if (loadError) return <EmptyState title="La livraison n’a pas pu être chargée" hint="Vérifiez votre connexion puis réessayez." action={<Btn onClick={() => void load()}>Réessayer</Btn>} />;
  if (!draft) return <div className="space-y-4 p-4 md:p-[26px]"><Skeleton className="h-40" /><Skeleton className="h-72" /></div>;

  return (
    <div className="mx-auto flex max-w-[1120px] flex-col gap-5 p-4 pb-28 md:p-[26px]">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div><p className="text-[11px] font-bold uppercase tracking-[0.16em] text-mut">Commande en ligne</p><h1 className="mt-1 text-3xl font-semibold tracking-[-0.04em] text-ink">Votre livraison, à vos conditions.</h1><p className="mt-2 max-w-[640px] text-sm leading-relaxed text-mut">Définissez où vous livrez, à quel prix et combien de commandes votre équipe peut prendre en charge.</p></div>
        <Pill variant="out">Livraison par votre restaurant</Pill>
      </header>

      <div className="grid items-start gap-4 lg:grid-cols-[1.5fr_1fr]">
        <Panel title="Zones de livraison" sub="Chaque code postal couvre toute la commune ou le secteur postal correspondant." actions={<Btn variant="ghost" size="sm" icon="plus" disabled={draft.zones.length >= 30 || saving} onClick={() => {
          const zone = newDeliveryZone(`zone-${crypto.randomUUID().slice(0, 8)}`);
          setDraft(current => current ? { ...current, zones: [...current.zones, zone] } : current);
        }}>Ajouter</Btn>}>
          {draft.zones.length === 0 ? <EmptyState icon="home" title="Commencez par votre première zone" hint="Ajoutez un ou plusieurs codes postaux, puis choisissez vos frais et votre minimum de commande." /> : (
            <div className="flex flex-col gap-4">
              {draft.zones.map((zone, index) => (
                <fieldset key={zone.id} disabled={saving} className="min-w-0 rounded-card border border-line bg-surface2 p-4">
                  <legend className="px-1 text-xs font-semibold text-mut">Zone {index + 1}</legend>
                  <div className="flex flex-col gap-3">
                    <Field label="Nom de la zone" htmlFor={`${zone.id}-name`}><Input id={`${zone.id}-name`} value={zone.name} maxLength={60} placeholder="Centre-ville" onChange={(event) => updateZone(zone.id, { name: event.target.value })} /></Field>
                    <Field label="Codes postaux" htmlFor={`${zone.id}-codes`} hint="Séparez les codes par une virgule. Un code postal ne peut appartenir qu’à une seule zone."><Textarea id={`${zone.id}-codes`} value={zone.postalCodes} rows={2} placeholder="69001, 69002" onChange={(event) => updateZone(zone.id, { postalCodes: event.target.value })} /></Field>
                    <ZonePricingFields zone={zone} onChange={next => updateZone(zone.id, next)} />
                    <div className="flex justify-end"><Btn variant="ghost" size="sm" icon="trash" onClick={() => setDraft({ ...draft, zones: draft.zones.filter((item) => item.id !== zone.id), enabled: draft.zones.length === 1 ? false : draft.enabled })}>Retirer cette zone</Btn></div>
                  </div>
                </fieldset>
              ))}
            </div>
          )}
        </Panel>
        <div className="flex flex-col gap-4">
          <Panel title="Capacité de votre équipe" sub="Des délais réalistes pour chaque commande.">
            <div className="flex flex-col gap-4">
              <Field label="Délai minimum avant livraison (min)" htmlFor="delivery-lead" hint="Préparation et trajet compris. Entre 20 et 180 minutes."><Input id="delivery-lead" type="number" min={20} max={180} step={5} value={draft.leadTimeMin} disabled={saving} onChange={(event) => setDraft({ ...draft, leadTimeMin: Number(event.target.value) })} /></Field>
              <Field label="Livraisons maximum par créneau" htmlFor="delivery-capacity" hint="La capacité de la cuisine est également respectée."><Input id="delivery-capacity" type="number" min={1} max={50} step={1} value={draft.slotCapacity} disabled={saving} onChange={(event) => setDraft({ ...draft, slotCapacity: Number(event.target.value) })} /></Field>
              <p className="rounded-card border border-line bg-surface2 p-3.5 text-[13px] leading-relaxed text-mut"><strong className="font-semibold text-ink">Capacité des prochaines journées.</strong> Le nombre maximum de livraisons par créneau ne change pas pour les journées déjà préparées, même sans commande. La nouvelle capacité s’applique aux journées encore non préparées.</p>
              <p className="text-[13px] leading-relaxed text-mut">Les créneaux sont préparés à partir de vos horaires et de vos fermetures exceptionnelles. <Link href="/admin/hours" className="font-semibold text-ink underline underline-offset-4">Gérer les horaires</Link></p>
            </div>
          </Panel>
          <Panel title="Ouvrir la livraison">
            <div className="flex items-center justify-between gap-4"><div><p className="text-sm font-semibold text-ink">Proposer la livraison</p><p className="mt-1 text-[13px] text-mut">Le retrait reste disponible.</p></div><Toggle label="Proposer la livraison" on={draft.enabled} disabled={saving || draft.zones.length === 0} onChange={(enabled) => setDraft({ ...draft, enabled })} /></div>
            <p className="mt-4 text-[13px] leading-relaxed text-mut">La livraison s’affiche lorsque vos réglages sont enregistrés et votre encaissement en ligne est actif. Vos clients paient en ligne avant le départ du livreur.</p>
          </Panel>
          <div className="rounded-card border border-line bg-surface2 p-4 text-[13px] leading-relaxed text-mut"><p className="font-semibold text-ink">Votre équipe assure la livraison.</p><p className="mt-1">Aucun transporteur externe ni suivi GPS n’est inclus. Depuis Commandes, indiquez le départ du livreur puis confirmez la remise au client.</p></div>
        </div>
      </div>

      <DeliveryOperatorsPanel />

      <div className="sticky bottom-4 z-10 flex flex-wrap items-center justify-between gap-3 rounded-panel border border-line bg-surface p-4 shadow-card">
        <div aria-live="polite"><p className="text-sm font-semibold text-ink">{dirty ? "Modifications à enregistrer" : "Vos réglages sont à jour"}</p>{error && <p role="alert" className="mt-1 text-[13px] text-alertt">{error}</p>}</div>
        <div className="flex gap-2">{dirty && <Btn variant="ghost" disabled={saving} onClick={() => { setDraft(saved); setError(null); }}>Annuler</Btn>}<Btn disabled={!dirty || saving} aria-busy={saving} icon="check" onClick={() => void save()}>{saving ? "Enregistrement…" : "Enregistrer et publier"}</Btn></div>
      </div>
    </div>
  );
}
