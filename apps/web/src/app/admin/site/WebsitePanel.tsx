"use client";

import { useEffect, useRef, useState } from "react";
import { WebsiteUrlSchema } from "@sm/contracts";
import { api, type TenantMe } from "@/lib/api";
import { Btn, Field, Input, Panel, useToast } from "@/components/ui";
import { useSiteEditScope } from "./site-scope";

export function WebsitePanel() {
  const scope = useSiteEditScope(), scopeRef = useRef(scope);
  const alive = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const toast = useToast();
  const [url, setUrl] = useState("");
  const [saved, setSaved] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void api.get<TenantMe>("/tenants/me").then((tenant) => {
      if (cancelled || !scopeRef.current.current()) return;
      const current = tenant.websiteUrl ?? "";
      setUrl(current); setSaved(current); setLoaded(true);
    }).catch(() => { if (!cancelled) setError("Impossible de charger le site vitrine. Rechargez la page pour réessayer."); });
    return () => { cancelled = true; };
  }, []);

  async function save() {
    if (!loaded || busy || !scope.current()) return;
    const next = url.trim();
    if (next && !WebsiteUrlSchema.safeParse(next).success) {
      setError("Saisissez une adresse HTTPS valide, par exemple https://classfood.fr."); return;
    }
    setBusy(true); setError(null);
    try {
      await api.patch("/tenants/me/identity", { websiteUrl: next || null });
      if (!alive.current || !scope.current()) return;
      setSaved(next); setUrl(next); toast("Lien du site vitrine enregistré", { icon: "check" });
    } catch { if (alive.current && scope.current()) setError("Enregistrement impossible. Votre lien précédent est conservé."); }
    finally { if (alive.current && scope.current()) setBusy(false); }
  }

  return <Panel title="Votre site vitrine" sub="Votre identité, votre adresse, votre site sur mesure">
    <p className="text-sm leading-relaxed text-mut">Le site vitrine présente votre restaurant. Il reste indépendant de la commande en ligne : ses boutons « Commander » peuvent ouvrir votre module personnalisé, si vous l’avez souscrit.</p>
    <form className="mt-4 space-y-3" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <Field label="Adresse du site vitrine (facultative)" htmlFor="website-url">
        <Input id="website-url" type="url" placeholder="https://classfood.fr" autoComplete="url" value={url} disabled={!loaded || busy} aria-invalid={Boolean(error)} aria-describedby={error ? "website-error" : undefined} onChange={(event) => setUrl(event.target.value)} />
      </Field>
      {error && <p id="website-error" role="alert" className="text-sm text-mut">{error}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <Btn type="submit" disabled={!loaded || busy || url.trim() === saved}>{busy ? "Enregistrement…" : "Enregistrer"}</Btn>
        {saved && <a href={saved} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center text-sm font-semibold text-ink underline">Voir le site<span className="sr-only"> (nouvel onglet)</span></a>}
      </div>
    </form>
    <p className="mt-4 text-xs leading-relaxed text-mut">Gardez votre domaine principal pour la vitrine ; utilisez par exemple commander.votrerestaurant.fr pour la commande. Ne remplacez pas les réglages DNS d’un site déjà en ligne.</p>
  </Panel>;
}
