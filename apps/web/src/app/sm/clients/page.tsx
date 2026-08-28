"use client";

/**
 * RESTAURANTS CLIENTS — la liste qu'on balaie avant de décrocher.
 *
 * Le signal qui compte n'est pas l'abonnement (il court encore le jour où le
 * client décroche) mais l'ACTIVITÉ : sept jours sans une seule commande sur un
 * fast-food, ce n'est pas un creux, c'est un client qui part. Quatre anomalies
 * doivent se voir SANS un clic et sans lire une valeur (DA §7) :
 *
 *   1. le client à rappeler — marqueur rouge plein à côté du nom, + filet rouge
 *      en bord de ligne ;
 *   2. le décrochage — pastille de score rouge qui bat ;
 *   3. l'appareil muet — puce « caisse hors ligne », en rouge sur la ligne ;
 *   4. le compte suspendu — pilule rouge en colonne « Statut ».
 *
 * Chaque ligne ouvre la fiche `/sm/clients/[id]`, l'écran d'appel.
 *
 * ─── D'où viennent les chiffres ───
 *
 * `GET /crm/tenants` rend l'identité et l'activité brute (30 j), mais NI le
 * score de santé, NI le statut de compte, NI la tendance. Le score vit dans
 * `/crm/tenants/:id/health` — une route par client. Trois appels différents
 * peuplent donc cette page, et l'ordre compte :
 *
 *   1. `/crm/tenants` — la liste s'affiche, complète et cliquable ;
 *   2. `/crm/signals` — UN appel pour tout le parc : il dit qui rappeler, et
 *      pourquoi. C'est lui qui allume les marqueurs rouges ;
 *   3. `/crm/tenants/:id/health` — les scores, chargés APRÈS l'affichage, en
 *      file de quatre, plafonnés, et dans l'ordre d'urgence (voir
 *      `hydrateSummaries`). Jamais cinquante requêtes en vol.
 *
 * Cloisonnement : cette liste traverse TOUS les restaurants du parc. Elle est
 * réservée au rôle `sm_admin` — garde côté API, redirection côté coquille.
 * Aucun consommateur final n'y figure : ce sont des agrégats d'établissement.
 */

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { CLIENT_RISK_DAYS, type CrmClientHealth, type TenantAccountStatus } from "@sm/contracts";
import { cx } from "@/lib/cx";
import { Card, Chip, EmptyState, Icon, Input, Kpi, Skeleton } from "@/components/ui";
import { euroRound, fmtMonth, int } from "../crm";
import {
  readWorkSignals,
  signalsByTenant,
  worstSeverity,
  type WorkSignal,
} from "../signals/data";
import {
  clientsApi,
  fmtSince,
  readClientRows,
  scoreHealth,
  SEVERITY_TEXT,
  type ClientRow,
  type SignalSeverity,
} from "./data";
import {
  AccountPill,
  CallBackFlag,
  PlanPill,
  ScorePill,
  Trend,
  Unavailable,
} from "./ui";

type Filter = "tous" | "rappeler" | "attention" | "ok" | "suspendus";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "tous", label: "Tous" },
  { key: "rappeler", label: "À rappeler" },
  { key: "attention", label: "À suivre" },
  { key: "ok", label: "Bonne santé" },
  { key: "suspendus", label: "Suspendus" },
];

/** Les décrochages d'abord : cette liste est celle des appels à passer. */
const HEALTH_RANK: Record<CrmClientHealth, number> = {
  risque: 0,
  attention: 1,
  ok: 2,
};

const BUCKET_RANK: Record<"rappeler" | "attention" | "ok", number> = {
  rappeler: 0,
  attention: 1,
  ok: 2,
};

/**
 * Une ligne, une fois recomposée depuis les trois sources.
 *
 * Chaque champ suit la même règle : la valeur de la FICHE DE SANTÉ l'emporte
 * quand elle est chargée, celle de la liste sert de repli. Jamais l'inverse —
 * la liste et la fiche doivent afficher le même chiffre.
 */
type Row = {
  client: ClientRow;
  score: number | null;
  verdict: string;
  /** Fiche de santé demandée, pas encore revenue. */
  pending: boolean;
  tone: CrmClientHealth;
  accountStatus: TenantAccountStatus | null;
  trendPct: number | null;
  trendDays: number;
  lastActivityAt: string | null;
  devicesOffline: number | null;
  signals: WorkSignal[];
  worst: SignalSeverity | null;
  /** Signal critique, accès coupé ou décrochage : ce client passe devant. */
  callBack: boolean;
  /**
   * Le seau qui range le client — et qui sert AUSSI de filtre, de compteur et
   * de critère de tri.
   *
   * Un seul calcul pour les quatre usages : la première version rangeait un
   * client au score correct mais porteur d'un signal « à surveiller » dans
   * « Bonne santé », parce que le filtre regardait la santé et la ligne
   * affichait le signal. Deux réponses à la même question sur le même écran.
   */
  bucket: Bucket;
};

type Bucket = "rappeler" | "attention" | "ok";

function bucketOf(
  callBack: boolean,
  worst: SignalSeverity | null,
  tone: CrmClientHealth,
): Bucket {
  if (callBack) return "rappeler";
  if (worst === "attention" || tone === "attention") return "attention";
  return "ok";
}

export default function ClientsPage() {
  const [clients, setClients] = useState<ClientRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [signals, setSignals] = useState<WorkSignal[] | null>(null);
  const [filter, setFilter] = useState<Filter>("tous");
  const [q, setQ] = useState("");

  useEffect(() => {
    let cancelled = false;
    clientsApi
      .list()
      .then((raw) => {
        if (!cancelled) setClients(readClientRows(raw));
      })
      .catch(() => {
        if (cancelled) return;
        setClients([]);
        setFailed(true);
      });
    // La file de signaux n'est pas indispensable à la liste : elle l'annote.
    // Son absence (service à l'arrêt) ne doit rien empêcher — d'où une liste
    // vide plutôt qu'un `null` qui bloquerait l'hydratation des scores.
    clientsApi
      .signals()
      .then((raw) => {
        if (!cancelled) setSignals(readWorkSignals(raw));
      })
      .catch(() => {
        if (!cancelled) setSignals([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /** Signaux ouverts par établissement — le plus grave en tête. */
  const byTenant = useMemo(() => signalsByTenant(signals ?? []), [signals]);

  // ── Les scores, une fois la liste peinte ──
  //
  // L'ordre attend que les DEUX premières routes aient répondu : il dépend des
  // signaux, et commencer sans eux reviendrait à dépenser le budget sur les
  // clients qui vont bien.

  /**
   * Les clients dont la fiche est DEMANDÉE — dérivé, jamais stocké.
   *
   * C'est ce qui distingue « score en cours de lecture » de « hors budget » sur
   * la pastille. Le déduire de l'ordre plutôt que de le poser dans un état
   * évite un rendu en cascade au montage : la file de rendu ne doit pas dépendre
   * d'un effet qui lui écrirait dessus.
   */


  /*
   * PLUS D'HYDRATATION CLIENT PAR CLIENT.
   *
   * L'écran rappelait `/crm/tenants/:id/health` pour chaque ligne — jusqu'à
   * `SUMMARY_BUDGET` requêtes à l'ouverture de la liste. Deux conséquences.
   *
   * D'abord `/crm/tenants` rend DÉJÀ tout ce qui était demandé : score,
   * verdict, statut de compte, tendance, appareils muets. Le calcul avait été
   * rapatrié dans la liste précisément pour supprimer ces appels, et l'écran a
   * continué de les faire.
   *
   * Ensuite, et c'est le plus grave : `tenantHealth` journalise une
   * CONSULTATION DE DOSSIER (`recordDetailView`). Ouvrir la liste en
   * fabriquait donc des dizaines, sur des clients que personne n'avait
   * ouverts — le journal d'administration devenait illisible, et il est
   * précisément ce qu'on relit quand on cherche qui a consulté quoi.
   */

  const rows = useMemo<Row[]>(() => {
    return (clients ?? []).map((c) => {
      const sig = byTenant.get(c._id) ?? [];
      const worst = worstSeverity(sig);
      const score = c.score;
      // Le signal porte lui aussi le statut du compte, et il arrive parfois
      // avant la liste : « suspendu » s'affiche donc tout de suite.
      const accountStatus = sig[0]?.accountStatus ?? c.accountStatus;
      const tone = scoreHealth(score) ?? c.health;
      const callBack =
        worst === "critique" || accountStatus === "suspended" || tone === "risque";
      return {
        client: c,
        score,
        verdict: c.verdictLabel,
        // Plus rien à attendre : la ligne arrive complète.
        pending: false,
        tone,
        accountStatus,
        trendPct: c.trendPct,
        trendDays: 30,
        lastActivityAt: c.lastActivityAt,
        devicesOffline: c.devicesOffline,
        signals: sig,
        worst,
        callBack,
        bucket: bucketOf(callBack, worst, tone),
      };
    });
  }, [clients, byTenant]);

  const sorted = useMemo(
    () =>
      [...rows].sort(
        (a, b) =>
          BUCKET_RANK[a.bucket] - BUCKET_RANK[b.bucket] ||
          (b.signals[0]?.gravity ?? -1) - (a.signals[0]?.gravity ?? -1) ||
          HEALTH_RANK[a.tone] - HEALTH_RANK[b.tone] ||
          (a.score ?? 50) - (b.score ?? 50) ||
          b.client.orders30d - a.client.orders30d,
      ),
    [rows],
  );

  const needle = q.trim().toLowerCase();
  const shown = sorted.filter((r) => {
    const c = r.client;
    if (needle && !`${c.name} ${c.city} ${c.slug}`.toLowerCase().includes(needle)) {
      return false;
    }
    if (filter === "tous") return true;
    if (filter === "suspendus") return r.accountStatus === "suspended";
    return r.bucket === filter;
  });

  const mrr = rows
    .filter((r) => r.client.orders30d > 0)
    .reduce((n, r) => n + r.client.mrrCents, 0);
  const toCall = rows.filter((r) => r.bucket === "rappeler").length;
  const suspended = rows.filter((r) => r.accountStatus === "suspended").length;
  const watch = rows.filter((r) => r.bucket === "attention").length;
  const healthy = rows.filter((r) => r.bucket === "ok").length;
  const mute = rows.reduce((n, r) => n + (r.devicesOffline ?? 0), 0);
  const critical = (signals ?? []).filter((s) => s.severity === "critique").length;

  if (clients === null) {
    return (
      <div className="flex flex-col gap-4 p-[26px] max-md:p-4">
        <div className="grid grid-cols-2 gap-3 md:flex md:gap-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-[124px] md:flex-1" />
          ))}
        </div>
        <Skeleton className="h-[320px]" />
      </div>
    );
  }

  const counts: Record<Filter, number> = {
    tous: rows.length,
    rappeler: toCall,
    attention: watch,
    ok: healthy,
    suspendus: suspended,
  };

  return (
    <div className="flex flex-col gap-4 p-[26px] max-md:p-4">
      {/* ── Les quatre chiffres du parc — 2 × 2 sous `md` (DA §7 : rien ne
          descend sous 13 px, donc jamais quatre cartes écrasées de front) ── */}
      <div className="grid grid-cols-2 items-stretch gap-3 md:flex md:gap-4">
        <Kpi label="Restaurants clients" value={int(rows.length)} icon="user" />
        <Kpi
          label="Actifs sur 30 jours"
          value={int(rows.filter((r) => r.client.orders30d > 0).length)}
          icon="check"
        />
        <Kpi
          label="À rappeler"
          value={int(toCall)}
          icon="phone"
          delta={
            toCall > 0
              ? {
                  dir: "down",
                  text:
                    critical > 0
                      ? `${int(critical)} signal${critical > 1 ? "s" : ""} critique${critical > 1 ? "s" : ""} ouvert${critical > 1 ? "s" : ""}`
                      : `sans commande depuis ${CLIENT_RISK_DAYS} j`,
                }
              : undefined
          }
        />
        <Kpi label="MRR estimé" value={euroRound(mrr)} icon="euro" />
      </div>

      {failed && (
        <Unavailable
          title="Parc clients indisponible"
          hint="L'API n'a pas répondu à /crm/tenants. Rechargez la page — si le problème persiste, vérifiez que le service tourne."
        />
      )}

      {/* ── Filtres, recherche, accès à la file de travail ── */}
      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => {
          const count = counts[f.key];
          return (
            <Chip key={f.key} on={filter === f.key} onClick={() => setFilter(f.key)}>
              {f.label}
              {count > 0 && (
                <span
                  className={cx(
                    "cf-fig rounded-pill px-1.5 text-[11px] font-extrabold",
                    f.key === "rappeler"
                      ? "bg-alert text-white"
                      : f.key === "suspendus"
                        ? "bg-alert/70 text-white"
                        : "bg-white/12 text-white",
                  )}
                >
                  {count}
                </span>
              )}
            </Chip>
          );
        })}

        <div className="relative ml-auto max-md:order-first max-md:ml-0 max-md:w-full">
          <Icon
            name="search"
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-mut"
          />
          <Input
            aria-label="Rechercher un restaurant"
            placeholder="Rechercher un client…"
            className="w-[260px] !py-[9px] pl-9 text-[13px] max-md:w-full"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>

        <Link
          href="/sm/signals"
          className="cf-press inline-flex items-center gap-[9px] whitespace-nowrap rounded-pill border border-line bg-white/3 px-3.5 py-[9px] text-[13px] font-bold text-white hover:border-white/25 hover:bg-white/8 max-md:min-h-10"
        >
          <Icon name="bell" size={15} />
          File de travail
          {(signals?.length ?? 0) > 0 && (
            <span
              className={cx(
                "cf-fig rounded-pill px-1.5 text-[11px] font-extrabold text-white",
                critical > 0 ? "bg-alert" : "bg-white/20",
              )}
            >
              {signals!.length}
            </span>
          )}
        </Link>
      </div>

      {mute > 0 && (
        <p className="flex items-center gap-2 text-[13px] font-bold text-alertt">
          <Icon name="tv" size={15} />
          {int(mute)} appareil{mute > 1 ? "s" : ""} hors ligne sur le parc — une
          caisse muette, c&apos;est un comptoir qui n&apos;encaisse plus.
        </p>
      )}

      {/* ── Le parc ── */}
      <Card className="p-0">
        {/*
          Neuf colonnes calées au pixel, dans un conteneur qui défile
          horizontalement sous 940 px. Une largeur minimale plutôt qu'un
          empilement responsive : cette table SE BALAIE en colonnes, et des
          colonnes qui se réorganisent selon la fenêtre ne se balaient plus.
          Le défilement reste enfermé dans la carte — la page, elle, ne part
          jamais de travers.
        */}
        {/*
          Sous `md`, la table DISPARAÎT au profit d'une pile de cartes (voir
          `ClientLine`) : ni table écrasée, ni défilement horizontal de page.
          La largeur minimale ne vaut donc qu'au-dessus de `md`.
        */}
        <div className="cf-scroll overflow-x-auto">
          <div className="md:min-w-[940px]">
            {/* En-tête de table : niveau « élément » sur la carte (DA §1). */}
            <div className="flex items-center gap-2.5 bg-[image:var(--cf-elev-gradient)] px-[18px] py-3 text-[11px] font-extrabold uppercase tracking-[0.08em] text-mut max-md:hidden">
              <span className="min-w-0 flex-1">Restaurant</span>
              <span className="w-[78px] shrink-0">Formule</span>
              <span className="w-[86px] shrink-0">Statut</span>
              <span className="w-[74px] shrink-0 text-center">Santé</span>
              <span className="w-[124px] shrink-0 text-right">Commandes 30 j</span>
              <span className="w-[92px] shrink-0 text-right">CA 30 j</span>
              <span className="w-[112px] shrink-0 text-right">Dernière activité</span>
              <span className="w-[72px] shrink-0 text-right">MRR</span>
              <span className="w-[16px] shrink-0" aria-hidden />
            </div>

            {shown.length === 0 ? (
              <EmptyState
                icon="user"
                title={
                  rows.length === 0
                    ? "Aucun restaurant client"
                    : "Aucun client dans ce filtre"
                }
                hint={
                  rows.length === 0
                    ? "Les restaurants apparaissent ici dès leur mise en service."
                    : "Changez de filtre ou videz la recherche pour voir le reste du parc."
                }
              />
            ) : (
              shown.map((r) => <ClientLine key={r.client._id} row={r} />)
            )}
          </div>
        </div>
      </Card>

      <p className="text-[13px] text-mut">
        Tri par urgence — les clients à rappeler sont en tête, avec la raison de
        l&apos;appel sous leur nom. Score, verdict, tendance et appareils muets
        arrivent avec la liste : ouvrir cet écran ne consulte AUCUN dossier. À
        défaut de score, la santé retombe sur la dernière commande encaissée
        (bonne sous 2 jours, à suivre jusqu&apos;à {CLIENT_RISK_DAYS} jours, à
        risque au-delà). MRR estimé d&apos;après la formule.
      </p>
    </div>
  );
}

/**
 * Une ligne du parc.
 *
 * La ligne ENTIÈRE est le lien vers la fiche : au téléphone on vise large, pas
 * un nom de 90 px. Cible tactile ≥ 44 px de haut (DA §7).
 */
function ClientLine({ row: r }: { row: Row }) {
  const c = r.client;
  const mute = (r.devicesOffline ?? 0) > 0;
  const top = r.signals[0];

  return (
    <Link
      href={`/sm/clients/${c._id}`}
      className={cx(
        // Sous `md`, la ligne s'EMPILE en carte : identité en tête, pastilles
        // et chiffres en dessous — jamais une rangée de colonnes écrasées.
        "cf-press-row relative flex items-center gap-2.5 border-t border-line px-[18px] py-3 hover:bg-white/4 max-md:flex-wrap max-md:gap-y-2 max-md:px-4 max-md:py-3.5",
        r.callBack && "bg-alert/6",
      )}
      title={c.city ? `${c.name} — ${c.city}` : c.name}
    >
      {/*
        Filet rouge en bord de ligne : un décrochage ou une coupure se repère au
        balayage de la colonne, sans lire une seule valeur.
      */}
      {r.callBack && (
        <span className="absolute inset-y-0 left-0 w-[3px] bg-alert" aria-hidden />
      )}

      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div
          className="grid size-[30px] shrink-0 place-items-center rounded-xs bg-accent text-[13px] font-extrabold text-onaccent"
          aria-hidden
        >
          {c.name.trim().charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          {/*
            `flex-wrap`, et le nom à sa largeur naturelle plutôt qu'en
            `flex-1` : sans ça, les pastilles (« muet », « à rappeler »)
            rognaient le nom jusqu'à le faire DISPARAÎTRE dans une fenêtre
            étroite — une ligne sans nom de restaurant, sur l'écran qui sert
            justement à choisir qui appeler. Ce sont les pastilles qui passent
            à la ligne, jamais le nom.
          */}
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
            <span className="max-w-full truncate text-[14.5px] font-bold text-ink">
              {c.name}
            </span>
            {c.founderSeat && (
              <Icon
                name="star"
                size={14}
                className="shrink-0 text-accent"
                aria-label="Client fondateur"
              />
            )}
            {mute && (
              <span
                className="inline-flex shrink-0 items-center gap-1 rounded-pill border border-alert/60 px-1.5 py-px text-[10px] font-extrabold uppercase tracking-[0.04em] text-alertt"
                title="Appareil sans battement de cœur — caisse, écran cuisine ou téléviseur"
              >
                <Icon name="tv" size={11} />
                {r.devicesOffline} muet{(r.devicesOffline ?? 0) > 1 ? "s" : ""}
              </span>
            )}
            {r.callBack && <CallBackFlag reason={top?.title ?? "Client en décrochage"} />}
          </div>

          {/*
            Sous le nom : la RAISON de l'appel quand il y en a une, la fiche
            d'identité sinon. Un intitulé de signal (« Écran cuisine muet ») en
            dit plus, à cet endroit précis, que « Lyon · client depuis mars ».
            La ville reste dans l'infobulle de la ligne et dans la recherche.
          */}
          {top ? (
            <div className={cx("truncate text-xs font-semibold", SEVERITY_TEXT[top.severity])}>
              {top.kindLabel} · {top.title}
              {r.signals.length > 1 && (
                <span className="text-mut"> · +{r.signals.length - 1} autre{r.signals.length > 2 ? "s" : ""}</span>
              )}
            </div>
          ) : (
            <div className="truncate text-xs text-mut">
              {c.city ? `${c.city} · ` : ""}client depuis {fmtMonth(c.since)}
            </div>
          )}
        </div>
      </div>

      {/* ── Les colonnes calées au pixel — bureau seulement ── */}
      <div className="hidden shrink-0 items-center gap-2.5 md:flex">
        <span className="w-[78px] shrink-0">
          <PlanPill plan={c.plan} />
        </span>

        <span className="w-[86px] shrink-0">
          <AccountPill status={r.accountStatus} />
        </span>

        <span className="flex w-[74px] shrink-0 justify-center">
          <ScorePill
            score={r.score}
            health={c.health}
            pending={r.pending}
            verdict={r.verdict}
          />
        </span>

        <span className="w-[124px] shrink-0 text-right">
          <span
            className={cx(
              "cf-fig block text-sm font-extrabold leading-tight",
              c.orders30d === 0 ? "text-alertt" : "text-ink",
            )}
          >
            {int(c.orders30d)}
          </span>
          {/*
            La fenêtre est DITE quand elle n'est pas celle de la colonne : un
            client entré il y a six semaines n'a pas de 30 jours précédents à
            comparer, l'API bascule alors sur 7 jours. Afficher « −10 % » sans
            préciser la période ferait discuter deux chiffres différents.
          */}
          <Trend
            pct={r.trendPct}
            className="justify-end"
            suffix={r.trendPct !== null && r.trendDays !== 30 ? `sur ${r.trendDays} j` : undefined}
          />
        </span>

        {/* CA agrégé : arrondi à l'euro, les centimes n'apportent rien ici. */}
        <span className="cf-fig w-[92px] shrink-0 text-right text-sm font-bold text-ink">
          {euroRound(c.revenue30dCents)}
        </span>

        <span
          className={cx(
            "w-[112px] shrink-0 truncate text-right text-[13px]",
            r.tone === "risque" ? "font-bold text-alertt" : "text-mut",
          )}
          title={
            r.lastActivityAt
              ? new Date(r.lastActivityAt).toLocaleString("fr-FR")
              : "Aucune activité enregistrée"
          }
        >
          {fmtSince(r.lastActivityAt)}
        </span>

        <span className="cf-fig w-[72px] shrink-0 text-right text-sm font-extrabold text-accent">
          {euroRound(c.mrrCents)}
        </span>

        <Icon name="arrow" size={16} className="w-[16px] shrink-0 text-mut" />
      </div>

      {/*
        ── La même information, EMPILÉE — mobile seulement ──
        Pastilles d'état d'abord (elles décident de l'appel), chiffres ensuite,
        alignés sous le nom (retrait = avatar 30 px + espace 12 px). Aucune
        colonne : ce bloc se LIT, il ne se balaie pas.
      */}
      <div className="flex min-w-0 basis-full flex-wrap items-center gap-x-1.5 gap-y-1.5 pl-[42px] md:hidden">
        <ScorePill
          score={r.score}
          health={c.health}
          pending={r.pending}
          verdict={r.verdict}
        />
        <PlanPill plan={c.plan} />
        <AccountPill status={r.accountStatus} />
      </div>
      <div className="flex min-w-0 basis-full flex-wrap items-baseline gap-x-3 gap-y-1 pl-[42px] text-[12.5px] md:hidden">
        <span className="inline-flex items-baseline gap-1.5">
          <span
            className={cx(
              "cf-fig font-extrabold",
              c.orders30d === 0 ? "text-alertt" : "text-ink",
            )}
          >
            {int(c.orders30d)} <span className="font-semibold text-mut">cmd / 30 j</span>
          </span>
          <Trend
            pct={r.trendPct}
            suffix={r.trendPct !== null && r.trendDays !== 30 ? `sur ${r.trendDays} j` : undefined}
          />
        </span>
        <span className="cf-fig font-bold text-ink">
          {euroRound(c.revenue30dCents)} <span className="font-semibold text-mut">de CA</span>
        </span>
        <span className="cf-fig font-extrabold text-accent">
          {euroRound(c.mrrCents)} <span className="font-semibold text-accent/70">MRR</span>
        </span>
        {/* L'horloge dit « dernière activité » sans en-tête de colonne : un
            « 6 j » nu, hors table, ne se rattache à rien. */}
        <span
          className={cx(
            "inline-flex items-center gap-1",
            r.tone === "risque" ? "font-bold text-alertt" : "text-mut",
          )}
        >
          <Icon name="clock" size={12} aria-hidden />
          {fmtSince(r.lastActivityAt)}
          <span className="sr-only"> depuis la dernière activité</span>
        </span>
      </div>
    </Link>
  );
}
