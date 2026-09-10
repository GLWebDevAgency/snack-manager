'use client';

import { useMemo, useState } from 'react';
import type { MenuCategory } from '../order/api';
import { devicePreferenceOptions, reconcileDevicePreferences, saveDevicePreferences, type DevicePreferences } from '../order/device-preferences';
import { useDevicePreferences } from '../order/device-preferences-store';
import { clearDeviceConvenienceData } from '../order/device-preferences-clear';
import { useCustomerDetails } from '../order/useCustomerDetails';
import { phoneOk } from '../order/helpers';
import { GhostAction, PrimaryAction, Sheet, Surface, Tap } from '../order/primitives';

type Props = { open: boolean; slug: string; tenantName: string; categories: readonly MenuCategory[];
  demo?: boolean; loyaltyEnabled?: boolean; onClose: () => void };
export function DevicePreferencesSheet(props: Props) { return <Session key={props.slug} {...props} />; }
function Session({ open, slug, tenantName, categories, demo = false, loyaltyEnabled = false, onClose }: Props) {
  // This surface edits unverified local conveniences, never the account profile.
  const details = useCustomerDetails(slug, demo, open, false);
  const stored = useDevicePreferences(slug, open && !demo);
  const options = useMemo(() => devicePreferenceOptions(categories), [categories]);
  const [draft, setDraft] = useState<DevicePreferences | null>(null);
  const preferences = reconcileDevicePreferences(draft ?? stored.preferences, categories);
  const [saving, setSaving] = useState(false), [confirmClear, setConfirmClear] = useState(false);
  const [message, setMessage] = useState<string | null>(null), [error, setError] = useState<string | null>(null);
  const busy = saving || details.busy;
  const close = () => { if (busy) return; setDraft(null); setConfirmClear(false); setMessage(null); setError(null); onClose(); };
  const toggle = (kind: 'removed' | 'sauces', key: string) => {
    setDraft({ ...preferences, [kind]: preferences[kind].includes(key) ? preferences[kind].filter(item => item !== key) : [...preferences[kind], key] });
    setMessage(null); setError(null);
  };
  async function save() {
    if (demo || busy || !stored.hydrated) return;
    setSaving(true); setMessage(null); setError(null);
    try { await saveDevicePreferences(slug, preferences); setDraft(null); setMessage('Préférences enregistrées pour vos prochaines fiches produit.'); }
    catch { setError('Les préférences n’ont pas pu être enregistrées. Vos choix dans le panier sont conservés.'); }
    finally { setSaving(false); }
  }
  async function clear() {
    if (demo || busy) return;
    setSaving(true); setMessage(null); setError(null);
    try {
      const result = await clearDeviceConvenienceData(slug, loyaltyEnabled);
      setDraft(null); setConfirmClear(false);
      if (!result.failed.includes('coordonnées')) details.change({ name: '', phone: '' });
      setMessage(`${result.failed.length ? 'Effacement partiel' : 'Effacement terminé'} : ${result.forgottenReceipts} raccourci(s) oublié(s). ${result.retainedReceipts ? 'Le raccourci de la commande encore active est conservé. ' : ''}Votre panier, votre compte et les demandes à vérifier sont conservés.`);
      if (result.failed.length) setError(`L’effacement reste à vérifier pour : ${result.failed.join(', ')}. Réessayez.`);
    } catch { setError('L’effacement n’a pas pu être confirmé. Réessayez.'); }
    finally { setSaving(false); }
  }
  return <Sheet open={open} onClose={close} navigationLocked={busy} title="Cet appareil" maxHeight="94%"
    headerExtra={<p className="mt-1 text-xs text-mut">Vos habitudes · {tenantName}</p>}>
    {open && <div className="space-y-6 px-4 py-5">
      <p className="text-sm leading-6 text-mut">Ces réglages restent sur ce navigateur et concernent uniquement {tenantName}. Ils ne modifient pas votre compte client.</p>
      {demo && <p role="status" className="text-sm text-mut">La démonstration ne mémorise pas de données personnelles.</p>}
      {message && <p role="status" className="rounded-card bg-accentwash p-3 text-sm leading-6">{message}</p>}
      {(error || stored.error) && <p role="alert" className="rounded-card border border-alertt/30 p-3 text-sm leading-6 text-alertt">{error || stored.error}</p>}
      <section aria-label="Mes coordonnées sur cet appareil" className="space-y-3"><h3 className="text-lg font-bold">Mes coordonnées</h3>
        <p className="text-xs leading-5 text-mut">Préremplissage facultatif pendant sept jours. Ces coordonnées ne valent pas vérification de votre identité.</p>
        <label className="block text-sm font-semibold">Prénom et nom à mémoriser<input autoComplete="name" value={details.customer.name} maxLength={80} disabled={busy || demo}
          onChange={event => details.change({ ...details.customer, name: event.target.value })} className="mt-2 min-h-12 w-full rounded-ctrl border border-line bg-surface2 px-3 text-base text-ink" /></label>
        <label className="block text-sm font-semibold">Téléphone à mémoriser<input autoComplete="tel" type="tel" value={details.customer.phone} maxLength={32} disabled={busy || demo}
          onChange={event => details.change({ ...details.customer, phone: event.target.value })} className="mt-2 min-h-12 w-full rounded-ctrl border border-line bg-surface2 px-3 text-base text-ink" /></label>
        {details.message && <p role="status" className="text-xs leading-5 text-mut">{details.message}</p>}
        <GhostAction disabled={busy || demo || details.customer.name.trim().length < 2 || !phoneOk(details.customer.phone)} onClick={() => void details.save()}>Mémoriser ces coordonnées</GhostAction>
        {details.remembered && <Tap disabled={busy} onClick={() => void details.forget()} className="min-h-11 text-sm font-semibold text-alertt">Oublier ces coordonnées</Tap>}
      </section>
      <section aria-label="Mes préférences de commande" className="space-y-4"><h3 className="text-lg font-bold">Mes préférences</h3>
        <p className="text-xs leading-5 text-mut">Elles préparent vos nouvelles fiches, uniquement lorsque les choix existent encore. Vérifiez toujours la composition et le prix avant d’ajouter. Vos articles déjà au panier ne changent pas.</p>
        {(['removed', 'sauces'] as const).map(kind => <fieldset key={kind} disabled={busy || demo || !stored.hydrated} className="space-y-2"><legend className="mb-2 text-sm font-bold">{kind === 'removed' ? 'Ce que je retire' : 'Sauces favorites'}</legend>
          {options[kind].length ? <div className="flex flex-wrap gap-2">{options[kind].map(item => <label key={item.key} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-pill border border-line bg-surface2 px-3 text-sm"><input type="checkbox" checked={preferences[kind].includes(item.key)} onChange={() => toggle(kind, item.key)} className="h-4 w-4 accent-[var(--cf-accent)]" />{kind === 'removed' ? `Sans ${item.label.toLocaleLowerCase('fr')}` : item.label}</label>)}</div>
            : <p className="text-xs leading-5 text-mut">Aucun choix correspondant sur la carte actuelle.</p>}
        </fieldset>)}
        <PrimaryAction disabled={busy || demo || !stored.hydrated || draft === null} loading={saving && !confirmClear} onClick={() => void save()}>Enregistrer mes préférences</PrimaryAction>
        <p className="text-xs text-mut">Conservées sept jours après votre enregistrement.</p>
      </section>
      <Surface className="space-y-3 p-4"><h3 className="text-lg font-bold">Effacer mes données sur cet appareil</h3>
        <p className="text-xs leading-5 text-mut">Efface les coordonnées mémorisées, préférences et raccourcis invités de ce restaurant{loyaltyEnabled ? ', ainsi que l’accès local à la carte fidélité' : ''}. Le compte, ses commandes, les points fidélité et le panier restent conservés. Les demandes encore à vérifier et leur accès de reprise ne sont jamais effacés ici.</p>
        {confirmClear ? <div role="group" aria-label="Confirmer l’effacement sur cet appareil" className="space-y-2"><GhostAction disabled={busy} onClick={() => setConfirmClear(false)}>Garder mes données</GhostAction><PrimaryAction disabled={busy || demo} loading={saving} onClick={() => void clear()}>Confirmer l’effacement</PrimaryAction></div>
          : <Tap disabled={busy || demo} onClick={() => setConfirmClear(true)} className="min-h-12 w-full rounded-pill border border-alertt/30 px-4 text-sm font-bold text-alertt">Effacer ces données</Tap>}
      </Surface>
    </div>}
  </Sheet>;
}
