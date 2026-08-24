"use client";

/**
 * PARAMÈTRES — l'identité de l'enseigne, éditable par le gérant.
 *
 * Longtemps, le nom, la couleur, l'adresse et les téléphones étaient
 * consommés partout (caisse, cuisine, tickets, vitrine) et éditables nulle
 * part : chaque retouche passait par un appel à Snack Manager (diagnostic
 * quatre casquettes, P2). Cette page ferme cette dépendance.
 *
 * Deux choses ne s'éditent PAS ici, et la page dit pourquoi plutôt que de
 * les cacher : le slug (c'est l'adresse publique — la changer casse la fiche
 * Google et les QR imprimés, geste d'équipe) et le logo (pas d'hébergement
 * de fichiers encore — un champ URL inviterait des liens morts).
 *
 * API : GET /tenants/me · PATCH /tenants/me/identity. Le nom et la couleur
 * repartent vers les tablettes au battement suivant, sans réappairage.
 */

import { useEffect, useState } from "react";
import { fmtEuro } from "@/lib/format";
import type { AuditEntryView } from "@sm/contracts";
import { api, type TenantMe } from "@/lib/api";
import { Btn, Field, Input, Panel, Skeleton, useToast } from "@/components/ui";

/** Sans dièse ni casse imposée à la saisie — on normalise à l'envoi. */
const normaliseCouleur = (raw: string): string => {
  const hex = raw.trim().replace(/^#?/, "#").toLowerCase();
  return /^#[0-9a-f]{6}$/.test(hex) ? hex : raw.trim();
};

/** La phrase du geste, tirée du `meta` — chiffres en euros, jamais en centimes. */
function metaLigne(e: AuditEntryView): string {
  const m = e.meta;
  if (e.action === "price.change" && typeof m.fromCents === "number" && typeof m.toCents === "number") {
    return `${String(m.name ?? "")} : ${fmtEuro(m.fromCents)} → ${fmtEuro(m.toCents)}`;
  }
  if (e.action === "order.discount" && typeof m.amount === "number") {
    return `${fmtEuro(m.amount)}${m.reason ? ` — ${String(m.reason)}` : ""}`;
  }
  if (e.action === "order.cancel") {
    return `${m.number ? `commande n° ${String(m.number)}` : ""}${m.reason ? ` — ${String(m.reason)}` : ""}`;
  }
  return "";
}

export default function SettingsPage() {
  const toast = useToast();
  const [me, setMe] = useState<TenantMe | null>(null);
  const [indisponible, setIndisponible] = useState(false);
  const [busy, setBusy] = useState(false);

  const [name, setName] = useState("");
  const [brandColor, setBrandColor] = useState("#c9a15a");
  const [address, setAddress] = useState("");
  const [phones, setPhones] = useState<string[]>(["", "", ""]);
  const [journal, setJournal] = useState<AuditEntryView[] | null>(null);

  useEffect(() => {
    api
      .get<{ entries: AuditEntryView[] }>("/audit?limit=50")
      .then((r) => setJournal(r.entries))
      .catch(() => setJournal([]));
  }, []);

  useEffect(() => {
    api
      .get<TenantMe>("/tenants/me")
      .then((t) => {
        setMe(t);
        // eslint-disable-next-line react-hooks/set-state-in-effect -- brouillon d'édition : dès que le gérant tape, ces champs divergent volontairement de `me`.
        setName(t.name);
        setBrandColor(t.brandColor || "#c9a15a");
        setAddress(t.address ?? "");
        setPhones([t.phones?.[0] ?? "", t.phones?.[1] ?? "", t.phones?.[2] ?? ""]);
      })
      .catch(() => setIndisponible(true));
  }, []);

  const couleur = normaliseCouleur(brandColor);
  const couleurValide = /^#[0-9a-f]{6}$/.test(couleur);
  const dirty =
    me !== null &&
    (name.trim() !== me.name ||
      couleur !== me.brandColor ||
      address.trim() !== (me.address ?? "") ||
      phones.filter(Boolean).join("|") !== (me.phones ?? []).join("|"));

  async function save() {
    if (!me || busy || !couleurValide || !name.trim()) return;
    setBusy(true);
    try {
      const next = await api.patch<TenantMe>("/tenants/me/identity", {
        name: name.trim(),
        brandColor: couleur,
        address: address.trim(),
        phones: phones.map((p) => p.trim()).filter(Boolean),
      });
      setMe(next);
      toast("Identité enregistrée — les tablettes suivent au prochain battement", {
        icon: "check",
      });
    } catch {
      toast("Enregistrement impossible — réessayez");
    } finally {
      setBusy(false);
    }
  }

  if (indisponible) {
    return (
      <div className="p-[26px]">
        <Panel title="Paramètres">
          <p className="text-[13px] text-mut">
            La fiche de l&apos;établissement n&apos;a pas répondu. Rechargez la page ; si ça
            persiste, appelez-nous.
          </p>
        </Panel>
      </div>
    );
  }

  return (
    <div className="flex max-w-[720px] flex-col gap-4 p-[26px]">
      <Panel
        title="L'identité de l'enseigne"
        sub="Le nom et la couleur s'appliquent partout : caisse, cuisine, tickets, page de commande."
        bodyClassName="flex flex-col gap-4"
      >
        {me === null ? (
          <>
            <Skeleton className="h-[52px]" />
            <Skeleton className="h-[52px]" />
          </>
        ) : (
          <>
            <Field label="Nom de l'enseigne" htmlFor="id-name">
              <Input id="id-name" value={name} onChange={(e) => setName(e.target.value)} required />
            </Field>

            <Field
              label="Couleur de marque"
              htmlFor="id-color"
              hint="L'accent de vos écrans et de votre page de commande — le reste de l'interface ne change pas, pour que vos équipiers gardent leurs repères."
            >
              <div className="flex items-center gap-2.5">
                <input
                  type="color"
                  aria-label="Choisir la couleur de marque"
                  value={couleurValide ? couleur : "#c9a15a"}
                  onChange={(e) => setBrandColor(e.target.value)}
                  className="size-[38px] shrink-0 cursor-pointer rounded-ctrl border border-white/12 bg-transparent p-1"
                />
                <Input
                  id="id-color"
                  value={brandColor}
                  onChange={(e) => setBrandColor(e.target.value)}
                  placeholder="#c9a15a"
                  className="w-[130px]"
                />
                {!couleurValide && (
                  <span className="text-xs font-semibold text-alertt">Format attendu : #rrggbb</span>
                )}
              </div>
            </Field>

            <Field label="Adresse du comptoir" htmlFor="id-address" hint="Telle qu'elle s'imprime sur les tickets.">
              <Input id="id-address" value={address} onChange={(e) => setAddress(e.target.value)} />
            </Field>

            <Field label="Téléphones (jusqu'à trois)" htmlFor="id-phone-0">
              <div className="flex flex-col gap-2">
                {phones.map((p, i) => (
                  <Input
                    key={i}
                    id={`id-phone-${i}`}
                    value={p}
                    placeholder={i === 0 ? "02 32 00 00 00" : ""}
                    onChange={(e) =>
                      setPhones((prev) => prev.map((x, j) => (j === i ? e.target.value : x)))
                    }
                  />
                ))}
              </div>
            </Field>

            <div className="flex items-center gap-3">
              <Btn
                variant="ink"
                icon="check"
                disabled={!dirty || busy || !couleurValide || !name.trim()}
                onClick={() => void save()}
              >
                {busy ? "Enregistrement…" : "Enregistrer"}
              </Btn>
              {!dirty && <span className="text-xs text-mut">Rien à enregistrer.</span>}
            </div>
          </>
        )}
      </Panel>

      <Panel
        title="Journal des gestes sensibles"
        sub="Annulations, remises, changements de prix — le registre NF525 de votre caisse"
        bodyClassName="flex flex-col gap-1.5"
      >
        {journal === null ? (
          <Skeleton className="h-[48px]" />
        ) : journal.length === 0 ? (
          <p className="text-[13px] text-mut">
            Aucun geste sensible enregistré — le registre se remplit à la première annulation,
            remise ou retouche de prix.
          </p>
        ) : (
          journal.map((e) => (
            <div
              key={e._id}
              className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 rounded-card border border-white/6 bg-white/3 px-3.5 py-2"
            >
              <span className="text-[13px] font-bold text-ink">{e.actionLabel}</span>
              {e.staffName && <span className="text-xs text-mut">par {e.staffName}</span>}
              <span className="min-w-0 flex-1 truncate text-xs text-mut">{metaLigne(e)}</span>
              <span className="cf-fig shrink-0 text-xs text-mut">
                {new Date(e.at).toLocaleString("fr-FR")}
              </span>
            </div>
          ))
        )}
      </Panel>

      <Panel title="Ce qui ne s'édite pas ici" bodyClassName="flex flex-col gap-2">
        <p className="text-[13px] leading-relaxed text-mut">
          <b className="text-ink">L&apos;adresse publique</b> ({me ? `${me.slug}.snackmanager.app` : "votre-slug.snackmanager.app"})
          ne se change pas seul : elle casse la fiche Google et les QR imprimés. Un appel, et on
          la migre proprement avec vous.
        </p>
        <p className="text-[13px] leading-relaxed text-mut">
          <b className="text-ink">Le logo</b> arrive bientôt — le temps de vous offrir un vrai
          hébergement d&apos;images plutôt qu&apos;un champ à liens morts.
        </p>
      </Panel>
    </div>
  );
}
