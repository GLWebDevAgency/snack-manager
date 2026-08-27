"use client";

/**
 * Vue « Promos » (spec backoffice-restaurant §8) : codes promo CRUD branchés
 * sur l'API /promotions. La colonne « À la une / Menu du moment » (démo figée
 * de la spec §8.2/§8.3) a été retirée le 24/08/2026 — voir le commentaire à
 * son ancien emplacement.
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
  minSubtotalCents: number;
  maxDiscountCents: number;
  maxUsage: number;
  offeredProductId: string | null;
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
  /** Panier minimum, en euros saisis (« 25 »). Vide = aucune condition. */
  minStr: string;
  /** Plafond de la remise, en euros saisis. Vide = non plafonnée. */
  maxStr: string;
  /** Nombre d'utilisations. Vide = illimité. */
  usageStr: string;
  /** Le produit offert — `offered_item` seulement. */
  offeredProductId: string;
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
  minStr: "",
  maxStr: "",
  usageStr: "",
  offeredProductId: "",
  startsAt: "",
  endsAt: "",
});

export default function PromosPage() {
  const toast = useToast();
  const [promos, setPromos] = useState<Promo[] | null>(null);
  /**
   * La carte, uniquement pour désigner le produit offert.
   *
   * Sans elle, « produit offert » restait inapplicable : le formulaire
   * proposait la nature, et la promotion créée ne disait jamais QUOI offrir.
   * Chargée en parallèle et non bloquante — une carte indisponible n'empêche
   * pas de créer un pourcentage.
   */
  const [carte, setCarte] = useState<{ _id: string; name: string; price: number }[]>([]);
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
    // eslint-disable-next-line react-hooks/set-state-in-effect -- chargement asynchrone : sans cet appel `promos` reste null, aucune promotion n'est affichée et les bascules optimistes de `toggleActive` retombent sur `?? null`, donc sans effet visible.
    void load();
  }, [load]);

  useEffect(() => {
    // Best-effort ASSUMÉ : la carte ne sert qu'au choix du produit offert. Une
    // panne de `/menu` doit laisser créer un pourcentage, pas bloquer l'écran.
    void (async () => {
      try {
        const menu = await api.get<{
          categories?: { products?: { _id: string; name?: string; price?: number }[] }[];
          uncategorized?: { _id: string; name?: string; price?: number }[];
        }>("/menu");
        const tous = [
          ...(menu.categories ?? []).flatMap((c) => c.products ?? []),
          ...(menu.uncategorized ?? []),
        ];
        setCarte(
          tous
            .map((p) => ({ _id: String(p._id), name: p.name ?? "", price: p.price ?? 0 }))
            .sort((a, b) => a.name.localeCompare(b.name, "fr")),
        );
      } catch {
        /* la carte reste vide : le champ le dit à l'écran */
      }
    })();
  }, []);

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
      minStr: p.minSubtotalCents > 0 ? (p.minSubtotalCents / 100).toFixed(2).replace(".", ",") : "",
      maxStr: p.maxDiscountCents > 0 ? (p.maxDiscountCents / 100).toFixed(2).replace(".", ",") : "",
      usageStr: p.maxUsage > 0 ? String(p.maxUsage) : "",
      offeredProductId: p.offeredProductId ?? "",
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
    // « Produit offert » sans produit désigné ne peut RIEN offrir. Le refus
    // vient ici plutôt qu'au moment de la commande, où il serait découvert par
    // un client à qui l'offre a été promise.
    if (draft.kind === "offered_item" && !draft.offeredProductId) {
      setDraftError("Choisissez le produit offert.");
      return;
    }
    // Vide vaut « pas de borne », jamais « borne à zéro » : un plafond de 0 €
    // annulerait la promotion en silence.
    const enCents = (v: string): number => {
      const net = v.trim().replace(",", ".");
      if (net === "") return 0;
      const n = Number(net);
      return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0;
    };
    const entier = (v: string): number => {
      const n = parseInt(v.trim(), 10);
      return Number.isFinite(n) && n > 0 ? n : 0;
    };
    setSaving(true);
    setDraftError(null);
    const body = {
      name: draft.name.trim(),
      description: draft.description.trim(),
      kind: draft.kind,
      value,
      code: draft.code.trim() ? draft.code.trim().toUpperCase() : null,
      channels: draft.channels,
      minSubtotalCents: enCents(draft.minStr),
      maxDiscountCents: enCents(draft.maxStr),
      maxUsage: entier(draft.usageStr),
      offeredProductId: draft.kind === "offered_item" ? draft.offeredProductId : null,
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
      <div className="p-4 md:p-[26px]">
        <div className="flex flex-col items-start gap-3 rounded-ctrl border border-alert/40 bg-alert/10 px-4 py-3">
          <p className="text-sm text-alertt">{error}</p>
          <Btn variant="ghost" size="sm" onClick={() => void load()}>
            Réessayer
          </Btn>
        </div>
      </div>
    );

  return (
    <div className="flex flex-col items-start gap-4 p-4 md:p-[26px] lg:flex-row">
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
                /*
                 * Tuile de niveau « élément » posée sur la carte : l'ancien
                 * cadre pointillé accent répétait la couleur de marque sur
                 * toute la colonne. L'accent ne reste que sur le code (DA §3).
                 */
                className={cx(
                  "rounded-card border border-white/8 bg-[image:var(--cf-elev-gradient)] px-3.5 py-3 transition-opacity duration-200 ease-sm",
                  !p.active && "opacity-50",
                )}
              >
                {/*
                  Sous `sm`, le bloc compteur + bascule + actions descend sous
                  le code : sur la même ligne, il ne laissait au code —
                  l'information no 1 de la tuile — que quelques pixels.
                */}
                <div className="flex flex-wrap items-center gap-3">
                  <div
                    className="grid size-11 shrink-0 place-items-center rounded-ctrl border border-white/8 bg-black/25 text-accent"
                    aria-hidden
                  >
                    <Icon name="tag" size={22} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-lg font-extrabold tracking-[-0.02em] text-accent">
                      {p.code ?? p.name}
                    </div>
                    <div className="truncate text-sm text-mut">
                      {p.code && `${p.name} · `}
                      {valueLabel(p)}
                      {p.description && ` · ${p.description}`}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2.5 max-sm:w-full max-sm:pl-[56px]">
                    {/*
                      Le compteur BOUGE enfin. Il affichait « 0 utilisés » à
                      vie : rien n'appliquait les promotions, donc rien ne
                      l'incrémentait. Avec un quota, on montre le reste — c'est
                      ce que le gérant regarde, pas le cumul.
                    */}
                    <span
                      className={`cf-fig text-[13px] max-sm:mr-auto ${
                        p.maxUsage > 0 && p.usageCount >= p.maxUsage ? "text-alertt" : "text-mut"
                      }`}
                      title={
                        p.maxUsage > 0
                          ? `${p.usageCount} sur ${p.maxUsage} utilisations`
                          : "Utilisations illimitées"
                      }
                    >
                      {p.maxUsage > 0
                        ? p.usageCount >= p.maxUsage
                          ? "Épuisée"
                          : `${(p.maxUsage - p.usageCount).toLocaleString("fr-FR")} restantes`
                        : `${p.usageCount.toLocaleString("fr-FR")} utilisés`}
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
                      /* `!` : IconBtn fige son côté en style inline — seule une
                         classe importante ramène la cible aux 44 px tactiles. */
                      className="max-lg:!size-11"
                      onClick={() => openEdit(p)}
                    />
                    <IconBtn
                      icon="trash"
                      label={`Supprimer ${p.code ?? p.name}`}
                      size={32}
                      iconSize={15}
                      className="max-lg:!size-11"
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

      {/*
        La colonne « À la une / Menu du moment » a été RETIRÉE (24/08/2026) :
        c'était une démo figée — des toggles « on » qui n'écrivaient rien
        (spec §8.2/§8.3, « sélection réelle à définir »). Un réglage qui a
        l'air de marcher et ne fait rien est pire qu'un réglage absent : le
        gérant croit avoir mis son burger en avant, le client ne le voit pas,
        et c'est nous qu'on appelle. La colonne reviendra le jour où la
        sélection s'écrit en base et s'affiche réellement sur l'accueil.
      */}

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
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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

            {/*
              LE PRODUIT OFFERT — sans lui, la nature ne pouvait rien offrir.
              « Produit offert » figurait à la liste des types depuis l'origine
              et le modèle ne disait jamais lequel : la promotion créée était
              inapplicable, sans qu'aucun écran ne le signale.
            */}
            {draft.kind === "offered_item" && (
              <Field
                label="Produit offert"
                htmlFor="promo-offered"
                hint={
                  carte.length === 0
                    ? "Carte indisponible — réessayez dans un instant"
                    : "Offert quand il figure dans la commande"
                }
              >
                <Select
                  id="promo-offered"
                  value={draft.offeredProductId}
                  disabled={carte.length === 0}
                  onChange={(e) => setDraft({ ...draft, offeredProductId: e.target.value })}
                >
                  <option value="">Choisir…</option>
                  {carte.map((p) => (
                    <option key={p._id} value={p._id}>
                      {p.name} — {fmtEuro(p.price)}
                    </option>
                  ))}
                </Select>
              </Field>
            )}

            {/*
              LES TROIS BORNES — celles qui manquaient, et sans lesquelles une
              promotion se découvre sur la marge du mois plutôt qu'à l'écran.

              Laisser vide vaut « pas de limite », jamais « limite à zéro » :
              un plafond de 0 € annulerait la promotion en silence.
            */}
            <div className="grid grid-cols-3 gap-3 max-md:grid-cols-1">
              <Field
                label="Panier minimum"
                htmlFor="promo-min"
                hint="Vide = aucune condition"
              >
                <Input
                  id="promo-min"
                  inputMode="decimal"
                  placeholder="25,00"
                  value={draft.minStr}
                  onChange={(e) => setDraft({ ...draft, minStr: e.target.value })}
                  className="tabular-nums"
                />
              </Field>
              <Field
                label="Remise maximum"
                htmlFor="promo-max"
                hint={draft.kind === "percent" ? "Recommandé sur un %" : "Vide = non plafonnée"}
              >
                <Input
                  id="promo-max"
                  inputMode="decimal"
                  placeholder="10,00"
                  value={draft.maxStr}
                  onChange={(e) => setDraft({ ...draft, maxStr: e.target.value })}
                  className="tabular-nums"
                />
              </Field>
              <Field
                label="Utilisations"
                htmlFor="promo-usage"
                hint="Vide = illimité"
              >
                <Input
                  id="promo-usage"
                  inputMode="numeric"
                  placeholder="100"
                  value={draft.usageStr}
                  onChange={(e) => setDraft({ ...draft, usageStr: e.target.value })}
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
