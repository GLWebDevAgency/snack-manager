"use client";

/**
 * Vue « Votre site web ».
 *
 * Deux adresses mènent à la même page de commande :
 *  — le sous-domaine Snack Manager, actif dès l'ouverture du compte ;
 *  — le nom de domaine du restaurant, qui demande UN enregistrement DNS.
 *
 * L'écran est écrit pour quelqu'un qui n'a jamais ouvert une zone DNS. D'où
 * l'ordre : on montre d'abord l'adresse qui marche déjà, on ne parle de CNAME
 * qu'ensuite, et chaque valeur à recopier a son bouton « Copier ».
 *
 * API : GET/POST /site/domains · POST /site/domains/:id/check · DELETE /site/domains/:id
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { cx } from "@/lib/cx";
import { timeAgo } from "@/lib/format";
import {
  Btn,
  EmptyState,
  Field,
  Icon,
  Input,
  Modal,
  Panel,
  Pill,
  Skeleton,
  useToast,
} from "@/components/ui";
import { CopyBtn, DnsInstructionCard, DomainStatusBadge } from "./parts";
import { apexSuggestion, type DomainView, type SiteAddresses } from "./types";
import { WebsitePanel } from "./WebsitePanel";
import { useAdminCapabilities } from "../access";

/** Lien externe stylé en bouton fantôme (les `Btn` sont des `<button>`). */
function OpenLink({ url, label }: { url: string; label: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer noopener"
      aria-label={label}
      className="inline-flex shrink-0 items-center justify-center gap-[9px] whitespace-nowrap rounded-pill border border-line bg-transparent px-3.5 py-[9px] text-xs font-semibold tracking-[-0.2px] text-white transition-colors duration-200 ease-sm hover:bg-white/6 active:translate-y-px"
    >
      Ouvrir
      <Icon name="arrow" size={15} />
    </a>
  );
}

export default function SitePage() {
  const toast = useToast();
  const online = useAdminCapabilities().includes("online");

  const [loadState, setLoadState] = useState<"loading" | "error" | "ready">(
    "loading",
  );
  const [data, setData] = useState<SiteAddresses | null>(null);

  // Formulaire d'ajout
  const [draft, setDraft] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  // Actions par domaine
  const [checkingId, setCheckingId] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<DomainView | null>(null);
  const [deleting, setDeleting] = useState(false);

  // `loading` est déjà l'état initial : le chargement ne le repositionne pas,
  // sinon l'effet écrirait un état de façon synchrone à chaque montage.
  const load = useCallback(async () => {
    if (!online) return;
    try {
      setData(await api.get<SiteAddresses>("/site/domains"));
      setLoadState("ready");
    } catch {
      setLoadState("error");
    }
  }, [online]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- chargement asynchrone : les domaines viennent du réseau (« loading » est déjà l'état initial, justement pour éviter une écriture au montage). Sans cet appel, la page reste sur son squelette et `retry`, qui repose sur le même `load`, ne relance plus rien.
    void load();
  }, [load]);

  const retry = () => {
    setLoadState("loading");
    void load();
  };

  // Correction proposée AVANT l'envoi : « classfood.fr » → « commander.classfood.fr ».
  const suggestion = useMemo(() => apexSuggestion(draft), [draft]);

  async function addDomain() {
    const hostname = draft.trim();
    if (!hostname || adding) return;
    setAdding(true);
    setFormError(null);
    try {
      await api.post<{ domain: DomainView }>("/site/domains", { hostname });
      setDraft("");
      // Rechargement complet : l'ajout change aussi le domaine « principal ».
      setData(await api.get<SiteAddresses>("/site/domains"));
      toast("Domaine ajouté — posez maintenant l'enregistrement DNS", {
        icon: "check",
      });
    } catch (e) {
      // Le message de l'API est déjà rédigé pour le restaurateur (il vient de
      // la règle métier) : on l'affiche tel quel plutôt que de le reformuler.
      setFormError(
        e instanceof ApiError || e instanceof Error
          ? e.message
          : "Ajout impossible — réessayez",
      );
    } finally {
      setAdding(false);
    }
  }

  async function checkDomain(domain: DomainView) {
    if (checkingId) return;
    setCheckingId(domain.id);
    try {
      const updated = await api.post<DomainView>(
        `/site/domains/${domain.id}/check`,
      );
      setData((prev) =>
        prev
          ? {
              ...prev,
              domains: prev.domains.map((d) =>
                d.id === updated.id ? updated : d,
              ),
            }
          : prev,
      );
      toast(
        updated.status === "active"
          ? "Votre domaine est actif"
          : `État : ${updated.statusLabel.toLowerCase()}`,
        { icon: updated.status === "active" ? "check" : undefined },
      );
    } catch (e) {
      toast(
        e instanceof Error ? e.message : "Vérification impossible — réessayez",
      );
    } finally {
      setCheckingId(null);
    }
  }

  async function confirmDelete() {
    if (!toDelete || deleting) return;
    setDeleting(true);
    try {
      await api.del(`/site/domains/${toDelete.id}`);
      setData((prev) =>
        prev
          ? { ...prev, domains: prev.domains.filter((d) => d.id !== toDelete.id) }
          : prev,
      );
      toast(`« ${toDelete.hostname} » détaché`, { icon: "check" });
      setToDelete(null);
    } catch (e) {
      toast(
        e instanceof Error ? e.message : "Suppression impossible — réessayez",
      );
    } finally {
      setDeleting(false);
    }
  }

  // ─── Chargement / erreur ───

  if (!online) return <div className="max-w-3xl p-4 md:p-[26px]"><WebsitePanel /></div>;

  if (loadState === "loading")
    return (
      <div className="grid grid-cols-1 items-start gap-4 p-4 md:p-[26px] xl:grid-cols-[1.25fr_0.75fr]">
        <div className="flex flex-col gap-4">
          <Skeleton className="h-[180px]" />
          <Skeleton className="h-[340px]" />
        </div>
        <Skeleton className="h-[300px]" />
      </div>
    );

  if (loadState === "error" || !data)
    return (
      <div className="p-4 md:p-[26px]">
        <EmptyState
          icon="search"
          title="Impossible de charger vos adresses"
          hint="Vérifiez votre connexion puis réessayez."
          action={
            <Btn variant="ghost" size="sm" onClick={retry}>
              Réessayer
            </Btn>
          }
        />
      </div>
    );

  return (
    <div className="grid grid-cols-1 items-start gap-4 p-4 md:p-[26px] xl:grid-cols-[1.25fr_0.75fr]">
      <div className="flex min-w-0 flex-col gap-4">
        <WebsitePanel />
        {/* ── Carte « Votre adresse » : toujours active ── */}
        <Panel
          title="Votre adresse"
          sub="En ligne dès aujourd'hui, sans rien configurer"
          actions={<Pill className="bg-ok text-white">Active</Pill>}
        >
          <div className="flex flex-wrap items-center gap-3 rounded-card border border-line2 bg-surface2 px-3.5 py-3">
            {/* Minimum de 200 px : l'adresse est l'information no 1 — sur un
                téléphone, les boutons passent dessous plutôt que la tronquer. */}
            <div className="min-w-[200px] flex-1">
              <div className="truncate font-mono text-[17px] font-extrabold tracking-[-0.02em] text-ink">
                {data.subdomain.hostname}
              </div>
              <div className="mt-0.5 text-[13px] text-mut">
                Page de commande de votre établissement
              </div>
            </div>
            <CopyBtn value={data.subdomain.url} what="L'adresse" />
            <OpenLink
              url={data.subdomain.url}
              label={`Ouvrir ${data.subdomain.hostname} dans un nouvel onglet`}
            />
          </div>
          <p className="mt-3 text-[13px] text-mut">
            Collez-la dans votre bio Instagram, sur vos flyers ou sur votre fiche
            Google&nbsp;: elle fonctionne déjà et restera valable même si vous
            ajoutez votre propre nom de domaine.
          </p>
        </Panel>

        {/* ── Carte « Votre nom de domaine » ── */}
        <Panel
          title="Votre nom de domaine"
          sub="Servez la même page depuis une adresse à vous"
        >
          {data.domains.length === 0 ? (
            <EmptyState
              icon="tag"
              title="Aucun domaine personnalisé"
              hint="Vous avez déjà un nom de domaine (chez OVH, Gandi, Ionos…) ? Rattachez-le ci-dessous : vos clients commanderont sur votre propre adresse."
            />
          ) : (
            <ul className="flex flex-col gap-3">
              {data.domains.map((d) => (
                <li
                  key={d.id}
                  className="rounded-card border border-line2 bg-surface p-3.5"
                >
                  <div className="flex flex-wrap items-center gap-2.5">
                    <div className="min-w-[180px] flex-1">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <span className="truncate font-mono text-[15px] font-bold text-ink">
                          {d.hostname}
                        </span>
                        {d.isPrimary && <Pill variant="out">Principal</Pill>}
                      </div>
                      <div className="mt-0.5 truncate text-[13px] text-mut">
                        {d.detail ??
                          (d.lastCheckedAt
                            ? `Dernière vérification ${timeAgo(d.lastCheckedAt)}`
                            : "Jamais vérifié")}
                      </div>
                    </div>
                    <DomainStatusBadge status={d.status} label={d.statusLabel} />
                    {d.status === "active" && (
                      <OpenLink
                        url={d.url}
                        label={`Ouvrir ${d.hostname} dans un nouvel onglet`}
                      />
                    )}
                    <Btn
                      variant="ghost"
                      size="sm"
                      icon="check"
                      disabled={checkingId !== null}
                      onClick={() => void checkDomain(d)}
                    >
                      {checkingId === d.id
                        ? "Vérification…"
                        : "Vérifier maintenant"}
                    </Btn>
                    <button
                      type="button"
                      onClick={() => setToDelete(d)}
                      aria-label={`Détacher « ${d.hostname} »`}
                      title="Détacher"
                      className="grid size-8 shrink-0 place-items-center rounded-ctrl text-mut transition-colors duration-200 hover:text-alertt"
                    >
                      <Icon name="trash" size={15} />
                    </button>
                  </div>

                  {/* L'instruction reste affichée tant que le domaine n'est pas
                      actif — c'est exactement le moment où le client la cherche. */}
                  {d.status !== "active" && (
                    <div className="mt-3">
                      <DnsInstructionCard dns={d.dns} />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}

          {/* ── Ajout ── */}
          <div
            className={cx(
              "flex flex-col gap-2.5",
              data.domains.length > 0 && "mt-4 border-t border-line2 pt-4",
            )}
          >
            <Field
              label="Ajouter un nom de domaine"
              htmlFor="domain-hostname"
              error={formError}
              hint="Indiquez un sous-domaine, par exemple « commander.mon-restaurant.fr »."
            >
              <div className="flex flex-wrap items-center gap-2.5">
                <Input
                  id="domain-hostname"
                  value={draft}
                  disabled={adding}
                  onChange={(e) => {
                    setDraft(e.target.value);
                    setFormError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void addDomain();
                  }}
                  placeholder="commander.mon-restaurant.fr"
                  className="min-w-[240px] flex-1 font-mono"
                  autoComplete="off"
                  spellCheck={false}
                />
                <Btn
                  variant="primary"
                  icon="plus"
                  disabled={adding || !draft.trim()}
                  onClick={() => void addDomain()}
                >
                  {adding ? "Ajout…" : "Ajouter"}
                </Btn>
              </div>
            </Field>

            {/* Domaine racine saisi : on explique et on corrige d'un clic. */}
            {suggestion && (
              <div className="flex flex-wrap items-center gap-2.5 rounded-card border border-line2 bg-surface2 px-3.5 py-3">
                <p className="min-w-[240px] flex-1 text-[13px] text-mut">
                  Un domaine racine comme{" "}
                  <span className="font-semibold text-ink">{draft.trim()}</span>{" "}
                  ne peut pas être redirigé vers un hébergeur sans casser vos
                  e-mails&nbsp;: utilisez un sous-domaine.
                </p>
                <Btn
                  variant="ink"
                  size="sm"
                  onClick={() => {
                    setDraft(suggestion);
                    setFormError(null);
                  }}
                >
                  Utiliser {suggestion}
                </Btn>
              </div>
            )}

          </div>
        </Panel>
      </div>

      {/* ── Colonne d'aide ── */}
      <Panel
        title="Comment ça marche ?"
        sub="Trois étapes, une seule chez votre hébergeur"
      >
        <ol className="flex flex-col gap-3.5">
          {[
            {
              t: "Vous indiquez votre sous-domaine",
              d: "Par exemple « commander.mon-restaurant.fr ». Nous le réservons et vous donnons l'enregistrement exact à créer.",
            },
            {
              t: "Vous créez un enregistrement CNAME",
              d: "Une seule ligne à ajouter dans la zone DNS de votre hébergeur. Chaque valeur a son bouton « Copier » pour éviter les fautes de frappe.",
            },
            {
              t: "Nous émettons le certificat",
              d: "Dès que le DNS est propagé, le HTTPS est installé automatiquement et votre page de commande répond sur votre adresse.",
            },
          ].map((step, i) => (
            <li key={step.t} className="flex gap-3">
              <span
                className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-pill bg-accent text-xs font-extrabold text-onaccent"
                aria-hidden
              >
                {i + 1}
              </span>
              <div className="min-w-0">
                <div className="text-sm font-bold text-ink">{step.t}</div>
                <p className="mt-0.5 text-[13px] text-mut">{step.d}</p>
              </div>
            </li>
          ))}
        </ol>

        <p className="mt-4 border-t border-line2 pt-3.5 text-[13px] text-mut">
          Votre adresse Snack Manager continue de fonctionner en parallèle&nbsp;:
          les liens déjà partagés ne cassent jamais.
        </p>
      </Panel>

      {/* ── Confirmation de détachement (destructive) ── */}
      <Modal
        open={toDelete !== null}
        onClose={() => setToDelete(null)}
        title="Détacher ce domaine"
        destructive
        footer={
          <>
            <Btn variant="ghost" onClick={() => setToDelete(null)}>
              Annuler
            </Btn>
            <Btn
              variant="ink"
              style={{ background: "var(--cf-red)" }}
              disabled={deleting}
              onClick={() => void confirmDelete()}
            >
              {deleting ? "Détachement…" : "Détacher le domaine"}
            </Btn>
          </>
        }
      >
        {toDelete && (
          <p>
            «&nbsp;{toDelete.hostname}&nbsp;» cessera de servir votre page de
            commande, et les liens déjà partagés sur cette adresse ne
            fonctionneront plus. Votre adresse{" "}
            <span className="font-semibold">{data.subdomain.hostname}</span>{" "}
            reste active. Vous pourrez rattacher ce domaine à nouveau plus tard.
          </p>
        )}
      </Modal>
    </div>
  );
}
