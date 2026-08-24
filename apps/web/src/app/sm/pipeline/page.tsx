"use client";

/**
 * Pipeline commercial — une colonne par étape, les cartes se déplacent au
 * bouton (« Avancer → »), pas au glisser-déposer : sur un pipeline de quelques
 * dizaines de leads, un bouton est plus rapide, accessible au clavier et
 * impossible à rater d'un geste imprécis.
 *
 * L'écriture est OPTIMISTE : la carte change de colonne à l'instant du clic,
 * la réponse serveur ne fait que confirmer. Un aller-retour réseau ne doit pas
 * s'interposer entre l'intention et l'affichage.
 */

import { useEffect, useMemo, useState } from "react";
import {
  LEAD_STAGES,
  LEAD_STAGE_LABELS,
  PLAN_LABELS,
  nextLeadStage,
  previousLeadStage,
  proposalCents,
  type CrmLead,
  type LeadStage,
} from "@sm/contracts";
import { cx } from "@/lib/cx";
import { fmtEuro, timeAgo } from "@/lib/format";
import { Btn, Card, Icon, Input, Skeleton, useToast } from "@/components/ui";
import { crm, useHq } from "../crm";
import { LeadDrawer, NewLeadDrawer, StagePill } from "../parts";

export default function PipelinePage() {
  const toast = useToast();
  const { reload } = useHq();
  const [leads, setLeads] = useState<CrmLead[] | null>(null);
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [moving, setMoving] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    crm
      .leads()
      .then((l) => {
        if (!cancelled) setLeads(l);
      })
      .catch(() => {
        if (!cancelled) setLeads([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !leads) return leads ?? [];
    return leads.filter(
      (l) =>
        l.restaurantName.toLowerCase().includes(q) ||
        l.contact.name.toLowerCase().includes(q) ||
        l.notes.toLowerCase().includes(q),
    );
  }, [leads, query]);

  /** Remplace un lead en place — la liste ne se recharge jamais entièrement. */
  const merge = (updated: CrmLead) =>
    setLeads((prev) =>
      (prev ?? []).map((l) => (l._id === updated._id ? updated : l)),
    );

  async function move(lead: CrmLead, stage: LeadStage) {
    setMoving(lead._id);
    const before = lead;
    merge({ ...lead, stage }); // optimiste
    try {
      const updated = await crm.changeStage(lead._id, stage);
      merge(updated);
      reload();
    } catch {
      merge(before); // la carte retourne d'où elle vient
      toast("Déplacement impossible — réessayez");
    } finally {
      setMoving(null);
    }
  }

  const opened = (leads ?? []).find((l) => l._id === openId) ?? null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* ── Barre d'outils ── */}
      <div className="flex shrink-0 items-center gap-3 px-[26px] pb-3 pt-[26px]">
        <div className="relative">
          <Icon
            name="search"
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-mut"
          />
          <Input
            type="search"
            className="w-[280px] py-2.5 pl-9"
            placeholder="Rechercher un prospect…"
            aria-label="Rechercher un prospect"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <span className="text-[13px] text-mut">
          {leads === null
            ? "…"
            : `${filtered.length} lead${filtered.length > 1 ? "s" : ""}${query ? " trouvés" : ""}`}
        </span>
        <Btn
          className="ml-auto"
          variant="primary"
          size="sm"
          icon="plus"
          onClick={() => setCreating(true)}
        >
          Nouveau lead
        </Btn>
      </div>

      {/* ── Colonnes ── */}
      <div className="cf-scroll min-h-0 flex-1 overflow-auto px-[26px] pb-[26px]">
        {/*
          `w-full` EN PLUS de la largeur minimale : dans un conteneur qui
          défile, une rangée flex se dimensionne sur son contenu et restait
          collée à ses 1180 px, laissant la largeur d'écran inutilisée et des
          colonnes de 187 px où tous les noms de restaurants se coupaient.
          Avec les deux, la rangée occupe l'écran quand il y a la place et ne
          défile qu'en dessous — six colonnes lisibles réclament 1320 px.
        */}
        <div className="flex w-full min-w-[1320px] items-start gap-3">
          {LEAD_STAGES.map((stage) => {
            const column = filtered.filter((l) => l.stage === stage);
            return (
              <section
                key={stage}
                aria-label={LEAD_STAGE_LABELS[stage]}
                className={cx(
                  "flex-1 overflow-hidden rounded-panel border bg-surface",
                  // La sortie de route ne pèse pas autant que le pipeline vivant.
                  stage === "perdu" ? "border-white/6 opacity-75" : "border-line",
                )}
              >
                <header className="flex items-center justify-between gap-2 border-b border-line px-3.5 py-2.5">
                  <span
                    className={cx(
                      "truncate text-[13.5px] font-bold",
                      stage === "perdu" ? "text-mut" : "text-ink",
                    )}
                  >
                    {LEAD_STAGE_LABELS[stage]}
                  </span>
                  <span className="cf-fig grid h-5 min-w-[22px] shrink-0 place-items-center rounded-pill bg-fill px-[7px] text-xs font-extrabold text-mut">
                    {column.length}
                  </span>
                </header>

                <div className="flex min-h-[120px] flex-col gap-2.5 p-2.5">
                  {leads === null ? (
                    <>
                      <Skeleton className="h-[104px]" />
                      <Skeleton className="h-[104px]" />
                    </>
                  ) : column.length === 0 ? (
                    <p className="py-6 text-center text-[13px] text-mut">—</p>
                  ) : (
                    column.map((lead) => (
                      <LeadCard
                        key={lead._id}
                        lead={lead}
                        busy={moving === lead._id}
                        onOpen={() => setOpenId(lead._id)}
                        onMove={(to) => void move(lead, to)}
                      />
                    ))
                  )}
                </div>
              </section>
            );
          })}
        </div>
      </div>

      <LeadDrawer lead={opened} onClose={() => setOpenId(null)} onChanged={merge} />
      <NewLeadDrawer
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(lead) => setLeads((prev) => [lead, ...(prev ?? [])])}
      />
    </div>
  );
}

function LeadCard({
  lead,
  busy,
  onOpen,
  onMove,
}: {
  lead: CrmLead;
  busy: boolean;
  onOpen: () => void;
  onMove: (stage: LeadStage) => void;
}) {
  const forward = nextLeadStage(lead.stage);
  const back = previousLeadStage(lead.stage);

  return (
    <Card
      className={cx(
        "p-3 transition-opacity duration-200 ease-sm",
        busy && "opacity-60",
      )}
    >
      {/*
        La carte entière ouvre la fiche ; les boutons d'étape vivent dans une
        rangée séparée, en dehors du bouton d'ouverture — un bouton dans un
        bouton n'est pas du HTML valide et casse la navigation au clavier.
      */}
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Ouvrir la fiche de ${lead.restaurantName}`}
        className="cf-press-row block w-full text-left"
      >
        <div className="flex items-start justify-between gap-2">
          <span className="min-w-0 truncate text-[14.5px] font-bold text-ink">
            {lead.restaurantName}
          </span>
          {lead.founderSeatReserved && (
            <Icon
              name="star"
              size={15}
              className="shrink-0 text-accent"
              aria-label="Place fondateur réservée"
            />
          )}
        </div>
        {(lead.contact.name || lead.contact.phone) && (
          <div className="mt-0.5 truncate text-[12.5px] text-mut">
            {[lead.contact.name, lead.contact.phone].filter(Boolean).join(" · ")}
          </div>
        )}
        {/* La proposition sur la table — la carte répond à « on lui a proposé quoi ? » sans ouvrir la fiche. */}
        {lead.proposal && (
          <div className="mt-1 truncate text-[12px] font-semibold text-accent">
            {PLAN_LABELS[lead.proposal.plan]}
            {lead.proposal.onlineOrdering && lead.proposal.plan !== "boost"
              ? " + commande en ligne"
              : ""}
            {" · "}
            {fmtEuro(proposalCents(lead.proposal).monthlyCents)}/mois
            {lead.proposal.billing === "annuel" ? " · annuel" : ""}
          </div>
        )}
        {lead.notes && (
          <p className="mt-2 line-clamp-2 text-[12.5px] leading-[1.35] text-mut">
            {lead.notes}
          </p>
        )}
        <div className="mt-2 flex items-center gap-2 text-xs text-mut">
          {lead.sequence && (
            <span className="rounded-pill bg-white/8 px-2 py-0.5 font-bold text-white/70">
              Séq. {lead.sequence}
            </span>
          )}
          <span className="truncate">
            {lead.lastTouchAt
              ? `Relancé ${timeAgo(lead.lastTouchAt)}`
              : "Jamais relancé"}
          </span>
        </div>
      </button>

      <div className="mt-2.5 flex items-center gap-1.5 border-t border-line2 pt-2.5">
        {back && (
          <button
            type="button"
            disabled={busy}
            onClick={() => onMove(back)}
            title={`Reculer sur « ${LEAD_STAGE_LABELS[back]} »`}
            aria-label={`Reculer ${lead.restaurantName} sur « ${LEAD_STAGE_LABELS[back]} »`}
            className="cf-press grid size-[30px] shrink-0 place-items-center rounded-pill border border-line bg-white/3 text-mut hover:border-white/25 hover:text-white disabled:opacity-40"
          >
            <Icon name="back" size={14} />
          </button>
        )}
        {forward ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => onMove(forward)}
            aria-label={`Avancer ${lead.restaurantName} sur « ${LEAD_STAGE_LABELS[forward]} »`}
            className="cf-press inline-flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-pill bg-btndark px-3 py-[7px] text-xs font-bold text-white hover:bg-[#333] disabled:opacity-40"
          >
            <span className="truncate">Avancer</span>
            <Icon name="arrow" size={14} className="shrink-0" />
          </button>
        ) : (
          <StagePill stage={lead.stage} className="ml-auto" />
        )}
      </div>
    </Card>
  );
}
