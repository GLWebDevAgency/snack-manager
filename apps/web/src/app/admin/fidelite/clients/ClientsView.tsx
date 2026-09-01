"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import type {
  LoyaltyMemberSummary,
  LoyaltyProgramView,
  LoyaltyRewardView,
} from "@sm/contracts";
import { Btn, Card, EmptyState, Icon, Panel, Pill, Select, Skeleton } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import { loyaltyApi } from "../data";
import { CreateMemberDrawer } from "./CreateMemberDrawer";
import { MemberDrawer } from "./MemberDrawer";
import {
  reconcileLoyaltyMemberList,
  type LoyaltyMemberStatusFilter,
} from "./member-list-state";
import { createLatestRequestCoordinator } from "./latest-request";

type StatusFilter = LoyaltyMemberStatusFilter;

const STATUS_LABEL = {
  active: { label: "Active", className: "border-ok/30 bg-ok/10 text-okt" },
  blocked: { label: "Bloquée", className: "border-alert/30 bg-alert/10 text-alertt" },
  anonymized: { label: "Anonymisée", className: "text-mut" },
} as const;

export function ClientsView({ initialMemberId }: { initialMemberId: string | null }) {
  const [listRequests] = useState(createLatestRequestCoordinator);
  const [phoneRequests] = useState(createLatestRequestCoordinator);
  const [program, setProgram] = useState<LoyaltyProgramView | null | undefined>(undefined);
  const [rewards, setRewards] = useState<LoyaltyRewardView[]>([]);
  const [members, setMembers] = useState<LoyaltyMemberSummary[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusFilter>("all");
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [phone, setPhone] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(initialMemberId);

  const queryFor = useCallback(
    (cursor?: string) => ({
      limit: 30,
      ...(status === "all" ? {} : { status }),
      ...(cursor ? { cursor } : {}),
    }),
    [status],
  );

  const loadMembers = useCallback(async () => {
    const ticket = listRequests.start();
    setError(null);
    setMembers(null);
    setNextCursor(null);
    setLoadingMore(false);
    try {
      const page = await loyaltyApi.listMembers(queryFor(), ticket.signal);
      if (!ticket.isCurrent()) return;
      setMembers(page.items);
      setNextCursor(page.nextCursor);
    } catch (cause) {
      if (!ticket.isCurrent()) return;
      setError(cause instanceof ApiError ? cause.message : "Chargement des clients impossible.");
    } finally {
      listRequests.finish(ticket);
    }
  }, [listRequests, queryFor]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([loyaltyApi.getProgram(), loyaltyApi.listRewards()])
      .then(([nextProgram, nextRewards]) => {
        if (cancelled) return;
        setProgram(nextProgram);
        setRewards(nextRewards);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof ApiError ? cause.message : "Chargement de la fidélité impossible.");
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- changement de filtre = nouvelle page API, avec curseur remis à zéro.
    void loadMembers();
    return () => listRequests.cancel();
  }, [listRequests, loadMembers]);

  useEffect(
    () => () => phoneRequests.cancel(),
    [phoneRequests],
  );

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    const ticket = listRequests.start();
    const cursor = nextCursor;
    setLoadingMore(true);
    try {
      const page = await loyaltyApi.listMembers(queryFor(cursor), ticket.signal);
      if (!ticket.isCurrent()) return;
      setMembers((current) => [...(current ?? []), ...page.items.filter((item) => !current?.some((existing) => existing.id === item.id))]);
      setNextCursor(page.nextCursor);
    } catch (cause) {
      if (!ticket.isCurrent()) return;
      setError(cause instanceof ApiError ? cause.message : "La suite de la liste n'a pas pu être chargée.");
    } finally {
      if (ticket.isCurrent()) setLoadingMore(false);
      listRequests.finish(ticket);
    }
  }

  function changeStatus(nextStatus: StatusFilter) {
    if (nextStatus === status) return;
    // Invalidation synchrone : aucun résultat de l'ancien filtre ne peut se
    // publier entre le geste dans le select et l'effet de la prochaine passe.
    listRequests.cancel();
    phoneRequests.cancel();
    setSearching(false);
    setMembers(null);
    setNextCursor(null);
    setLoadingMore(false);
    setError(null);
    setStatus(nextStatus);
  }

  async function resolvePhone(event: FormEvent) {
    event.preventDefault();
    if (searching || !phone.trim()) return;
    const ticket = phoneRequests.start();
    const requestedStatus = status;
    setSearching(true);
    setSearchError(null);
    try {
      const found = await loyaltyApi.resolveMember(
        { by: "phone", phone: phone.trim() },
        ticket.signal,
      );
      if (!ticket.isCurrent()) return;
      setMembers((current) =>
        reconcileLoyaltyMemberList(current ?? [], found, requestedStatus),
      );
      setPhone("");
      setSelectedId(found.id);
    } catch (cause) {
      if (!ticket.isCurrent()) return;
      setSearchError(
        cause instanceof ApiError && cause.status === 404
          ? "Aucune carte ne correspond exactement à ce numéro."
          : cause instanceof ApiError
            ? cause.message
            : "Recherche impossible — réessayez.",
      );
    } finally {
      if (ticket.isCurrent()) setSearching(false);
      phoneRequests.finish(ticket);
    }
  }

  const displayed = members?.length ?? 0;
  const activeRewards = useMemo(() => rewards.filter((reward) => reward.active), [rewards]);

  if (program === undefined || members === null) {
    if (error) {
      return <div className="p-4 md:p-[26px]"><div className="rounded-card border border-alert/40 bg-alert/10 p-4"><p className="text-sm text-alertt" role="alert">{error}</p><Btn variant="ghost" size="sm" className="mt-3" onClick={() => void loadMembers()}>Réessayer</Btn></div></div>;
    }
    return <div className="p-4 md:p-[26px]"><Skeleton className="h-[120px]" /><Skeleton className="mt-4 h-[430px]" /></div>;
  }

  if (!program) {
    return <div className="p-4 md:p-[26px]"><Card><EmptyState icon="user" title="Le programme n'est pas encore configuré" hint="Publiez les règles avant d'inscrire le premier client." action={<Link href="/admin/fidelite/programme" className="cf-press inline-flex rounded-pill bg-accent px-5 py-3 text-sm font-bold text-onaccent">Configurer le programme</Link>} /></Card></div>;
  }

  const unitPlural = program.unitLabelPlural;
  const unitSingular = program.unitLabelSingular;

  return (
    <div className="p-4 md:p-[26px]">
      <Card className="mb-4 p-[18px]">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-[0.07em] text-accent">Accès comptoir confidentiel</p>
            <h2 className="mt-1 text-lg font-extrabold tracking-[-0.03em] text-ink">Retrouver une carte par téléphone</h2>
            <p className="mt-1 text-xs leading-5 text-mut">Recherche exacte uniquement. Le numéro reste dans le corps chiffré de la requête et n’entre jamais dans l’URL.</p>
          </div>
          <form onSubmit={resolvePhone} className="flex w-full flex-col gap-2 sm:flex-row lg:max-w-[520px]">
            <input
              aria-label="Téléphone exact du client"
              type="tel"
              inputMode="tel"
              autoComplete="off"
              placeholder="06 12 34 56 78"
              value={phone}
              disabled={searching}
              onChange={(event) => setPhone(event.target.value)}
              className="min-w-0 flex-1 rounded-ctrl border border-white/8 bg-white/5 px-3.5 py-3 text-base font-medium text-white outline-none placeholder:text-mut/70 hover:border-white/16 focus:border-accent sm:text-sm"
            />
            <Btn type="submit" icon="search" disabled={searching || !phone.trim()}>{searching ? "Recherche…" : "Rechercher"}</Btn>
          </form>
        </div>
        {searchError && <p className="mt-3 text-xs text-alertt" role="alert">{searchError}</p>}
      </Card>

      <Panel
        title="Clients fidélité"
        sub={`${displayed.toLocaleString("fr-FR")} affiché${displayed > 1 ? "s" : ""}${nextCursor ? " · suite disponible" : ""}`}
        actions={<Btn size="sm" icon="plus" onClick={() => setCreateOpen(true)}>Inscrire un client</Btn>}
        bodyClassName="-mx-[18px] -mb-[18px]"
      >
        <div className="flex items-center justify-between gap-3 border-b border-line2 px-[18px] pb-3.5">
          <label className="flex items-center gap-2 text-xs font-semibold text-mut">
            État
            <Select className="w-[150px] py-2" value={status} onChange={(event) => changeStatus(event.target.value as StatusFilter)}>
              <option value="all">Toutes les cartes</option>
              <option value="active">Actives</option>
              <option value="blocked">Bloquées</option>
              <option value="anonymized">Anonymisées</option>
            </Select>
          </label>
          <span className="hidden text-xs text-mut sm:block">Téléphones masqués · aucun numéro complet ni secret QR affiché</span>
        </div>

        {members.length === 0 ? (
          <EmptyState icon="user" title={status === "all" ? "Aucun client inscrit" : "Aucune carte dans cet état"} hint={status === "all" ? "Créez une carte QR-only ou associez un téléphone pour une récupération rapide." : "Changez le filtre pour retrouver les autres cartes."} action={status === "all" ? <Btn size="sm" icon="plus" onClick={() => setCreateOpen(true)}>Inscrire le premier client</Btn> : undefined} />
        ) : (
          <>
            <div className="grid grid-cols-1 gap-3 p-[18px] lg:hidden">
              {members.map((member) => (
                <button key={member.id} type="button" onClick={() => setSelectedId(member.id)} className="cf-press rounded-card border border-white/8 bg-[image:var(--cf-elev-gradient)] p-4 text-left hover:border-white/20">
                  <div className="flex items-start gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-pill bg-accent/12 text-sm font-black text-accent" aria-hidden>{member.alias.charAt(0).toUpperCase()}</span><span className="min-w-0 flex-1"><span className="flex items-start justify-between gap-2"><span className="truncate text-sm font-extrabold text-ink">{member.alias}</span><Pill className={STATUS_LABEL[member.status].className}>{STATUS_LABEL[member.status].label}</Pill></span><span className="mt-1 block text-xs text-mut">{member.maskedPhone ?? "Carte QR uniquement"}</span><span className="mt-3 flex items-end justify-between gap-3"><span className="text-xs text-mut">{member.lastActivityAt ? `Actif ${timeAgo(member.lastActivityAt)}` : `Inscrit ${timeAgo(member.joinedAt)}`}</span><strong className="cf-fig text-lg text-ink">{member.balanceUnits.toLocaleString("fr-FR")} <span className="text-[11px] text-mut">{member.balanceUnits === 1 ? unitSingular : unitPlural}</span></strong></span></span></div>
                </button>
              ))}
            </div>

            <div className="hidden overflow-x-auto lg:block">
              <table className="w-full border-collapse text-left text-sm">
                <thead><tr className="border-b border-line2 bg-white/[0.025] text-[11px] uppercase tracking-[0.06em] text-mut"><th className="px-[18px] py-3 font-semibold">Client</th><th className="px-4 py-3 font-semibold">Carte</th><th className="px-4 py-3 font-semibold">Dernière activité</th><th className="px-4 py-3 text-right font-semibold">Solde</th><th className="px-[18px] py-3"><span className="sr-only">Ouvrir</span></th></tr></thead>
                <tbody className="divide-y divide-line2">
                  {members.map((member) => (
                    <tr key={member.id} className="hover:bg-white/[0.025]"><td className="px-[18px] py-3.5"><div className="font-bold text-ink">{member.alias}</div><div className="mt-0.5 text-xs text-mut">{member.maskedPhone ?? "QR uniquement"}</div></td><td className="px-4 py-3.5"><Pill className={STATUS_LABEL[member.status].className}>{STATUS_LABEL[member.status].label}</Pill></td><td className="px-4 py-3.5 text-[13px] text-mut">{member.lastActivityAt ? timeAgo(member.lastActivityAt) : "Aucune activité"}</td><td className="cf-fig whitespace-nowrap px-4 py-3.5 text-right font-extrabold text-ink">{member.balanceUnits.toLocaleString("fr-FR")} <span className="text-xs font-semibold text-mut">{member.balanceUnits === 1 ? unitSingular : unitPlural}</span></td><td className="px-[18px] py-3.5 text-right"><button type="button" onClick={() => setSelectedId(member.id)} className="cf-press inline-flex items-center gap-1 rounded-pill px-3 py-2 text-xs font-bold text-accent hover:bg-white/5">Ouvrir <Icon name="arrow" size={14} /></button></td></tr>
                  ))}
                </tbody>
              </table>
            </div>

            {nextCursor && <div className="border-t border-line2 p-4 text-center"><Btn variant="ghost" size="sm" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? "Chargement…" : "Afficher la suite"}</Btn></div>}
          </>
        )}
      </Panel>

      {createOpen && (
        <CreateMemberDrawer
          onClose={() => setCreateOpen(false)}
          onCreated={(member) => {
            if (!member) {
              void loadMembers();
              return;
            }
            setMembers((current) =>
              reconcileLoyaltyMemberList(current ?? [], member, status),
            );
          }}
        />
      )}
      {selectedId && <MemberDrawer key={selectedId} memberId={selectedId} program={program} rewards={activeRewards} onClose={() => setSelectedId(null)} onChanged={(member) => setMembers((current) => reconcileLoyaltyMemberList(current ?? [], member, status))} />}
    </div>
  );
}
