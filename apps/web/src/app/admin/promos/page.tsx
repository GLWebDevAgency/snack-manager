"use client";

/**
 * Vue « Promos » (spec backoffice-restaurant §8) : codes promo CRUD branchés
 * sur l'API /promotions + colonne « À la une » / « Menu du moment » (statique,
 * sélection réelle à définir — spec §8.2/§8.3).
 */

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, ApiError } from "@/lib/api";
import { fmtEuro } from "@/lib/format";
import { cx } from "@/lib/cx";
import {
  Btn,
  Chip,
  EmptyState,
  Field,
  Icon,
  IconBtn,
  Input,
  Modal,
  Panel,
  Pill,
  Select,
  Skeleton,
  Toggle,
  useToast,
} from "@/components/ui";

// ─── Types (miroir de l'API /promotions) ───

type PromoKind = "percent" | "amount" | "offered_item";
type PromoChannel = "online" | "pos" | "phone";

type Promo = {
  _id: string;
  name: string;
  description: string;
  kind: PromoKind;
  value: number; // percent : % · amount : CENTIMES
  code: string | null;
  channels: PromoChannel[];
  startsAt: string | null;
  endsAt: string | null;
  active: boolean;
  usageCount: number;
};

const CHANNELS: { key: PromoChannel; label: string }[] = [
  { key: "online", label: "En ligne" },
  { key: "pos", label: "Comptoir" },
  { key: "phone", label: "Téléphone" },
];

const KIND_LABELS: Record<PromoKind, string> = {
  percent: "Pourcentage (-X %)",
  amount: "Montant (-X €)",
  offered_item: "Produit offert",
};

/** Produits « À la une » — démo figée, sélection réelle à définir (spec §8.2). */
const FEATURED = ["Le Boss", "Tacos sur-mesure", "Family Box", "Le Smash"];

// ─── Formatage ───

function valueLabel(p: Promo): string {
  if (p.kind === "percent") return `-${p.value.toLocaleString("fr-FR")} %`;
  if (p.kind === "amount") return `-${fmtEuro(p.value)}`;
  return "Produit offert";
}

const dFr = (iso: string) =>
  new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });

function periodLabel(p: Promo): string {
  if (p.startsAt && p.endsAt) return `Du ${dFr(p.startsAt)} au ${dFr(p.endsAt)}`;
  if (p.endsAt) return `Jusqu'au ${dFr(p.endsAt)}`;
  if (p.startsAt) return `Dès le ${dFr(p.startsAt)}`;
  return "Sans limite de durée";
}

/** yyyy-mm-dd pour <input type="date"> (heure locale). */
function toDateInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

// ─── Brouillon de la modale création / édition ───

type Draft = {
  _id?: string;
  name: string;
  description: string;
  kind: PromoKind;
  valueStr: string; // % entier ou euros « 3,50 » selon kind
  code: string;
  channels: PromoChannel[];
  startsAt: string; // yyyy-mm-dd ou ''
  endsAt: string;
};

const emptyDraft = (): Draft => ({
  name: "",
  description: "",
  kind: "percent",
  valueStr: "",
  code: "",
  channels: ["online", "pos"],
  startsAt: "",
  endsAt: "",
});

export default function PromosPage() {
  const toast = useToast();
  const [promos, setPromos] = useState<Promo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [toDelete, setToDelete] = useState<Promo | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    try {
      setPromos(await api.get<Promo[]>("/promotions"));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur de chargement");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // ─── Actions ───

  async function toggleActive(p: Promo) {
    // Bascule optimiste, rollback si l'API échoue
    setPromos((list) =>
      list?.map((x) => (x._id === p._id ? { ...x, active: !p.active } : x)) ?? null,
    );
    try {
      await api.post(`/promotions/${p._id}/toggle`);
      toast(p.active ? "Promo désactivée" : "Promo activée", { icon: "check" });
    } catch {
      setPromos((list) =>
        list?.map((x) => (x._id === p._id ? { ...x, active: p.active } : x)) ?? null,
      );
      toast("Impossible de changer l'état — réessayez");
    }
  }

  function openEdit(p: Promo) {
    setDraftError(null);
    setDraft({
      _id: p._id,
      name: p.name,
      description: p.description,
      kind: p.kind,
      valueStr:
        p.kind === "amount"
          ? (p.value / 100).toFixed(2).replace(".", ",")
          : p.kind === "percent"
            ? String(p.value)
            : "",
      code: p.code ?? "",
      channels: p.channels,
      startsAt: toDateInput(p.startsAt),
      endsAt: toDateInput(p.endsAt),
    });
  }

  async function saveDraft(e: FormEvent) {
    e.preventDefault();
    if (!draft || saving) return;
    // Valeur : % entier ou euros → CENTIMES selon le type
    let value = 0;
    if (draft.kind === "percent") {
      value = parseInt(draft.valueStr, 10);
      if (!Number.isFinite(value) || value < 1 || value > 100) {
        setDraftError("Indiquez un pourcentage entier entre 1 et 100.");
        return;
      }
    } else if (draft.kind === "amount") {
      value = Math.round(parseFloat(draft.valueStr.replace(",", ".")) * 100);
      if (!Number.isFinite(value) || value < 1) {
        setDraftError("Indiquez un montant en euros (ex. 3,50).");
        return;
      }
    }
    if (draft.channels.length === 0) {
      setDraftError("Sélectionnez au moins un canal.");
      return;
    }
    setSaving(true);
    setDraftError(null);
    const body = {
      name: draft.name.trim(),
      description: draft.description.trim(),
      kind: draft.kind,
      value,
      code: draft.code.trim() ? draft.code.trim().toUpperCase() : null,
      channels: draft.channels,
      startsAt: draft.startsAt ? new Date(`${draft.startsAt}T00:00:00`).toISOString() : null,
      endsAt: draft.endsAt ? new Date(`${draft.endsAt}T23:59:59`).toISOString() : null,
    };
    try {
      if (draft._id) await api.patch(`/promotions/${draft._id}`, body);
      else await api.post("/promotions", body);
      toast(draft._id ? "Modifications enregistrées" : "Code promo créé", { icon: "check" });
      setDraft(null);
      await load();
    } catch (e) {
      setDraftError(
        e instanceof ApiError ? e.message : "Enregistrement impossible — réessayez",
      );
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!toDelete || deleting) return;
    setDeleting(true);
    try {
      await api.del(`/promotions/${toDelete._id}`);
      toast("Code promo supprimé", { icon: "trash" });
      setToDelete(null);
      await load();
    } catch {
      toast("Suppression impossible — réessayez");
    } finally {
      setDeleting(false);
    }
  }

  // ─── États globaux ───

  if (error)
    return (
      <div className="p-[26px]">
        <div className="flex flex-col items-start gap-3 rounded-ctrl border border-alert/40 bg-alert/10 px-4 py-3">
          <p className="text-sm text-alertt">{error}</p>
          <Btn variant="ghost" size="sm" onClick={() => void load()}>
            Réessayer
          </Btn>
        </div>
      </div>
    );

  return (
    <div className="flex flex-col items-start gap-4 p-[26px] lg:flex-row">
      {/* ── Colonne gauche : codes promo (CRUD) ── */}
      <div className="w-full min-w-0 lg:flex-[1.4]">
        <Panel
          title="Codes promo"
          sub="Actifs sur le site & l'app de commande"
          actions={
            <Btn
              size="sm"
              icon="plus"
              onClick={() => {
                setDraftError(null);
                setDraft(emptyDraft());
              }}
            >
              Nouveau code
            </Btn>
          }
          bodyClassName="flex flex-col gap-2.5"
        >
          {promos === null ? (
            <>
              <Skeleton className="h-[92px]" />
              <Skeleton className="h-[92px]" />
              <Skeleton className="h-[92px]" />
            </>
          ) : promos.length === 0 ? (
            <EmptyState
              icon="tag"
              title="Aucun code promo"
              hint="Créez votre premier code pour booster les commandes en ligne et au comptoir."
              action={
                <Btn
                  size="sm"
                  icon="plus"
                  onClick={() => {
                    setDraftError(null);
                    setDraft(emptyDraft());
                  }}
                >
                  Nouveau code
                </Btn>
              }
            />
          ) : (
            promos.map((p) => (
              <article
                key={p._id}
                aria-label={`Promo ${p.code ?? p.name}`}
                className={cx(
                  "rounded-card border-[1.5px] border-dashed border-accent bg-surface px-3.5 py-3 transition-opacity duration-200",
                  !p.active && "opacity-55",
                )}
              >
                <div className="flex items-center gap-3">
                  <div
                    className="grid size-11 shrink-0 place-items-center rounded-ctrl bg-surface2 text-accent"
                    aria-hidden
                  >
                    <Icon name="tag" size={22} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-lg font-semibold tracking-[-0.03em] text-accent">
                      {p.code ?? p.name}
                    </div>
                    <div className="truncate text-sm text-mut">
                      {p.code && `${p.name} · `}
                      {valueLabel(p)}
                      {p.description && ` · ${p.description}`}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2.5">
                    <span className="text-[13px] tabular-nums text-mut">
                      {p.usageCount.toLocaleString("fr-FR")} utilisés
                    </span>
                    <Toggle
                      on={p.active}
                      onChange={() => void toggleActive(p)}
                      label={
                        p.active
                          ? `Désactiver ${p.code ?? p.name}`
                          : `Activer ${p.code ?? p.name}`
                      }
                    />
                    <IconBtn
                      icon="edit"
                      label={`Modifier ${p.code ?? p.name}`}
                      size={32}
                      iconSize={15}
                      onClick={() => openEdit(p)}
                    />
                    <IconBtn
                      icon="trash"
                      label={`Supprimer ${p.code ?? p.name}`}
                      size={32}
                      iconSize={15}
                      onClick={() => setToDelete(p)}
                    />
                  </div>
                </div>
                <div className="mt-2.5 flex flex-wrap items-center gap-1.5 pl-[56px]">
                  {CHANNELS.filter((c) => p.channels.includes(c.key)).map((c) => (
                    <Pill key={c.key}>{c.label}</Pill>
                  ))}
                  <span className="text-xs text-mut">· {periodLabel(p)}</span>
                </div>
              </article>
            ))
          )}
        </Panel>
      </div>

      {/* ── Colonne droite : À la une + Menu du moment (démo figée, spec §8.2/§8.3) ── */}
      <div className="w-full min-w-0 lg:flex-1">
        <Panel title="À la une" sub="Produits mis en avant sur l'accueil">
          <div className="flex flex-col gap-2">
            {FEATURED.map((name) => (
              <div
                key={name}
                className="flex items-center gap-2.5 rounded-ctrl bg-surface2 px-3 py-2.5"
              >
                <svg
                  viewBox="0 0 24 24"
                  width={17}
                  height={17}
                  aria-hidden="true"
                  fill="var(--cf-gold)"
                  stroke="var(--cf-gold)"
                  strokeWidth={1}
                  strokeLinejoin="round"
                  className="shrink-0"
                >
                  <path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" />
                </svg>
                <span className="min-w-0 flex-1 truncate text-[15px] font-bold text-ink">
                  {name}
                </span>
                {/* Sélection réelle à définir — toggle figé « on » (spec §8.2) */}
                <Toggle on label={`${name} à la une`} />
              </div>
            ))}
          </div>

          {/* Encart « Menu du moment » (spec §8.3) */}
          <div className="mt-4 rounded-card bg-fill p-3.5">
            <div className="text-[15px] font-bold text-gold">Menu du moment</div>
            <div className="mt-1 flex items-center gap-3">
              <p className="min-w-0 flex-1 text-sm text-[rgba(244,238,225,0.8)]">
                Bandeau « Passe en menu +2,50 € » sur l&apos;accueil client
              </p>
              <Toggle on label="Bandeau menu du moment" />
            </div>
          </div>
        </Panel>
      </div>

      {/* ── Modale création / édition ── */}
      <Modal
        open={draft !== null}
        onClose={() => setDraft(null)}
        title={draft?._id ? "Modifier le code" : "Nouveau code"}
        width={480}
        footer={
          <>
            <Btn variant="ghost" size="sm" onClick={() => setDraft(null)}>
              Annuler
            </Btn>
            <Btn size="sm" type="submit" form="promo-form" disabled={saving}>
              {saving ? "Enregistrement…" : draft?._id ? "Enregistrer" : "Créer le code"}
            </Btn>
          </>
        }
      >
        {draft && (
          <form id="promo-form" onSubmit={saveDraft} className="flex flex-col gap-3.5">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Nom" htmlFor="promo-name">
                <Input
                  id="promo-name"
                  required
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  placeholder="Offre de bienvenue"
                />
              </Field>
              <Field label="Code" htmlFor="promo-code" hint="Laisser vide : promo sans code">
                <Input
                  id="promo-code"
                  value={draft.code}
                  onChange={(e) => setDraft({ ...draft, code: e.target.value.toUpperCase() })}
                  placeholder="BIENVENUE"
                  className="uppercase"
                />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Type" htmlFor="promo-kind">
                <Select
                  id="promo-kind"
                  value={draft.kind}
                  onChange={(e) =>
                    setDraft({ ...draft, kind: e.target.value as PromoKind, valueStr: "" })
                  }
                >
                  {(Object.keys(KIND_LABELS) as PromoKind[]).map((k) => (
                    <option key={k} value={k}>
                      {KIND_LABELS[k]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field
                label={draft.kind === "amount" ? "Valeur (€)" : "Valeur (%)"}
                htmlFor="promo-value"
              >
                <Input
                  id="promo-value"
                  inputMode="decimal"
                  disabled={draft.kind === "offered_item"}
                  value={draft.kind === "offered_item" ? "" : draft.valueStr}
                  onChange={(e) => setDraft({ ...draft, valueStr: e.target.value })}
                  placeholder={
                    draft.kind === "amount"
                      ? "3,50"
                      : draft.kind === "percent"
                        ? "10"
                        : "—"
                  }
                  className="tabular-nums"
                />
              </Field>
            </div>

            <Field label="Libellé affiché" htmlFor="promo-desc">
              <Input
                id="promo-desc"
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                placeholder="-10 % sur la commande"
              />
            </Field>

            <div className="flex flex-col gap-1.5">
              <span className="block text-xs font-bold uppercase tracking-[0.04em] text-mut">
                Canaux
              </span>
              <div className="flex flex-wrap gap-1.5">
                {CHANNELS.map((c) => {
                  const on = draft.channels.includes(c.key);
                  return (
                    <Chip
                      key={c.key}
                      on={on}
                      onClick={() =>
                        setDraft({
                          ...draft,
                          channels: on
                            ? draft.channels.filter((x) => x !== c.key)
                            : [...draft.channels, c.key],
                        })
                      }
                    >
                      {c.label}
                    </Chip>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Début" htmlFor="promo-start" hint="Optionnel">
                <Input
                  id="promo-start"
                  type="date"
                  value={draft.startsAt}
                  onChange={(e) => setDraft({ ...draft, startsAt: e.target.value })}
                />
              </Field>
              <Field label="Fin" htmlFor="promo-end" hint="Optionnel">
                <Input
                  id="promo-end"
                  type="date"
                  value={draft.endsAt}
                  onChange={(e) => setDraft({ ...draft, endsAt: e.target.value })}
                />
              </Field>
            </div>

            {draftError && (
              <p className="text-xs text-alertt" role="alert">
                {draftError}
              </p>
            )}
          </form>
        )}
      </Modal>

      {/* ── Modale de suppression (destructive : fermeture explicite) ── */}
      <Modal
        open={toDelete !== null}
        onClose={() => setToDelete(null)}
        title="Supprimer le code"
        destructive
        footer={
          <>
            <Btn variant="ghost" size="sm" onClick={() => setToDelete(null)}>
              Annuler
            </Btn>
            <Btn
              size="sm"
              disabled={deleting}
              onClick={() => void confirmDelete()}
              className="text-white"
              style={{ background: "var(--cf-red)" }}
            >
              {deleting ? "Suppression…" : "Supprimer"}
            </Btn>
          </>
        }
      >
        <p>
          « {toDelete?.code ?? toDelete?.name} » sera supprimé définitivement. Les commandes
          déjà passées ne sont pas affectées.
        </p>
      </Modal>
    </div>
  );
}
