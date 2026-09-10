"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError, type TenantMe } from "@/lib/api";
import { Btn, Panel, Skeleton } from "@/components/ui";
import { orderingApi, type Site } from "@/components/order/api";
import { EditeurDeMarque } from "../settings/EditeurDeMarque";
import { ApercuCommande, type ProductPreviewChanges } from "./ApercuCommande";
import { NomDuSite } from "./NomDuSite";
import { CarteDuSite } from "./CarteDuSite";
import { useSitePermissions } from "./site-access";
import { marqueEffective } from "@sm/contracts";
import { useAdminScopeToken, currentAdminScope, SiteEditScopeContext } from "./site-scope";
import styles from "./pilotage.module.css";

/** Le client admin garde son autorité (ou sa démo) ; seuls des GET publics alimentent l'aperçu. */
export async function loadSitePreview(slug: string, signal: AbortSignal): Promise<Site | null> {
  const nonce = Date.now();
  return orderingApi({ send: async ({ path }) => {
    try { return { status: 200, body: await api.get(`${path}${path.includes('?') ? '&' : '?'}preview=${nonce}`, { signal }) }; }
    catch (error) { if (error instanceof ApiError) return { status: error.status, body: error.body }; throw error; }
  } }).loadSite(slug);
}

export function MarqueDuSite() {
  const scope = useAdminScopeToken();
  const [loaded, setLoaded] = useState<{ tenant: TenantMe; scope: string | null } | null>(null), [error, setError] = useState(false), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!scope) return;
    const abort = new AbortController();
    void api.get<TenantMe>("/tenants/me", { signal: abort.signal }).then(me => { if (!abort.signal.aborted && currentAdminScope() === scope) { setLoaded({ tenant: me, scope }); setError(false); } })
      .catch(() => { if (!abort.signal.aborted) setError(true); });
    return () => abort.abort();
  }, [attempt, scope]);
  const tenant = loaded?.scope === scope ? loaded?.tenant : null;
  if (!tenant) return error ? <Panel title="Votre identité n’a pas pu être chargée"><Btn variant="ghost" onClick={() => setAttempt(attempt + 1)}>Réessayer le pilotage</Btn></Panel> : <Skeleton className="h-80" />;
  return <SiteEditScopeContext.Provider value={loaded?.scope ?? null}><Pilotage key={`${tenant._id}:${scope}`} tenant={tenant} onSaved={next => { if (currentAdminScope() === scope) setLoaded({ tenant: next, scope }); }} /></SiteEditScopeContext.Provider>;
}

function Pilotage({ tenant, onSaved }: { tenant: TenantMe; onSaved: (tenant: TenantMe) => void }) {
  const permissions = useSitePermissions();
  const [site, setSite] = useState<Site | null>(null), [error, setError] = useState(false), [version, setVersion] = useState(0);
  const [changes, setChanges] = useState<ProductPreviewChanges>({}), [cardDirty, setCardDirty] = useState(false), [nameDirty, setNameDirty] = useState(false), [nameBusy, setNameBusy] = useState(false), [cardBusy, setCardBusy] = useState(false), [draftName, setDraftName] = useState(tenant.name);
  const refresh = useCallback(() => setVersion(value => value + 1), []);
  useEffect(() => {
    const abort = new AbortController();
    void loadSitePreview(tenant.slug, abort.signal).then(value => { if (!abort.signal.aborted) { if (value) setSite(value); setError(!value); } })
      .catch(() => { if (!abort.signal.aborted) setError(true); });
    return () => abort.abort();
  }, [tenant.slug, version]);
  return <section className={styles.pilot} aria-label="Piloter la commande en ligne">
    <div className={styles.heading}><div><h2>Votre commande, à votre image</h2><p>Ajustez votre identité, votre accueil et la présentation de vos produits. Vérifiez le résultat avant de l’enregistrer.</p></div>
      <a className="inline-flex min-h-11 items-center gap-2 rounded-pill border border-line px-4 text-sm font-semibold" href={`/r/${encodeURIComponent(tenant.slug)}/carte`} target="_blank" rel="noopener noreferrer">Voir la page publique<span className="sr-only"> (nouvel onglet)</span></a>
    </div>
    {!permissions.brand ? <><p className="text-sm text-mut">Aperçu en lecture seule. La personnalisation est réservée au gérant et au propriétaire.</p><ApercuCommande brand={marqueEffective(tenant)} site={site} error={error} onRetry={refresh} /></> : <EditeurDeMarque me={tenant} onEnregistre={value => { onSaved(value); refresh(); }} commande={{ dirty: cardDirty || nameDirty, busy: cardBusy || nameBusy,
      identity: <NomDuSite tenant={tenant} onSaved={value => { onSaved(value); refresh(); }} onDirty={setNameDirty} onBusy={setNameBusy} onDraft={setDraftName} />,
      preview: brand => <ApercuCommande brand={brand} site={site ? { ...site, tenant: { ...site.tenant, name: draftName || site.tenant.name } } : null} error={error} onRetry={refresh} changes={changes} />,
      carte: active => permissions.menu ? <CarteDuSite tenantId={tenant._id} active={active} onSaved={refresh} onDrafts={setChanges} onDirty={setCardDirty} onBusy={setCardBusy} /> : <Panel title="Présentation de la carte"><p className="text-sm text-mut">La gestion de vos produits nécessite l’accès au module Menu.</p></Panel>,
    }} />}
  </section>;
}
