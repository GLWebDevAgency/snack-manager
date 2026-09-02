"use client";

/**
 * FACTURATION — qui paie, qui doit, et depuis combien de jours.
 *
 * La liste des clients répond à « comment va le parc ? », la file de travail à
 * « qui j'appelle aujourd'hui ? ». Cet écran-ci répond à la seule question qui
 * décide d'une suspension : « qui nous doit de l'argent, et depuis quand ? »
 *
 * ─── Le chiffre qui déclenche un geste ───
 *
 * Ce n'est ni le MRR ni le total dû — un total ne se traite pas. C'est
 * l'ANCIENNETÉ de la plus vieille créance. En dessous de trente jours, on
 * décroche son téléphone ; au-delà, on écrit ; au-delà de soixante, on coupe.
 * D'où sa place en tête, et sa couleur qui bascule au trentième jour.
 *
 * ─── Un parc à jour se DIT ───
 *
 * C'est le cas normal, et c'est le cas d'aujourd'hui. Un tableau vide laisserait
 * croire à un écran cassé ; l'écran affirme donc l'inverse, sobrement, avec le
 * nombre de clients concernés — et ne l'affirme JAMAIS si la route n'a pas
 * répondu : annoncer un parc à jour parce qu'une requête est tombée, c'est rater
 * une suspension.
 *
 * ─── Ce que l'écran ne fait pas ───
 *
 * Il n'émet pas de facture. L'émission appartient à un client précis (période,
 * nature, montant) et se joue sur sa fiche ; ici on ne fait que RECOUVRER ce
 * qui est déjà échu. Trois gestes, pas quatre : relancer (et le tracer),
 * encaisser, annuler.
 *
 * Cloisonnement : les deux routes lues traversent le parc entier et exigent
 * `sm_admin` côté API. Respect des clients de nos clients : aucun consommateur
 * n'apparaît ici — l'argent va du restaurateur vers nous.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { cx } from "@/lib/cx";
import { Card, EmptyState, Icon, Panel, Skeleton } from "@/components/ui";
import { euroRound, int } from "../crm";
import { RunMensuel } from "./RunMensuel";
import {
  EMPTY_QUEUE,
  MISE_EN_DEMEURE_DAYS,
  billingApi,
  euros,
  fmtDays,
  readPark,
  readQueue,
  recoveryStep,
  splitMrr,
  type BillingQueue,
  type OverdueRow,
  type ParkTenant,
  type Tone,
} from "./data";
import {
  BillingKpi,
  CancelModal,
  OverdueLine,
  PayModal,
  RemindModal,
  Unavailable,
} from "./ui";

/** Le geste ouvert sur une créance — une seule modale à la fois. */
type Gesture = { row: OverdueRow; kind: "relancer" | "encaisser" | "annuler" };

/**
 * Ce que chaque chiffre de tête compte EXACTEMENT — la définition qui évite
 * les mauvaises conclusions. Servie deux fois : en infobulle `title` pour la
 * souris, et en `sr-only` au bout du hint pour le clavier, le doigt et le
 * lecteur d'écran — un `title` posé sur un <div> n'est atteignable qu'au
 * survol.
 */
const DEFINITIONS = {
  mrr:
    "Somme des abonnements des clients ACTIFS sans facture échue. Les comptes suspendus et les clients en retard en sont exclus ; les essais et les clients partis ne sont facturés ni d'un côté ni de l'autre.",
  totalDu:
    "Somme des factures ÉCHUES et non réglées du parc. Une facture envoyée dont l'échéance n'est pas passée n'est pas un impayé : elle n'entre pas dans ce total.",
  retard:
    "Nombre de RESTAURANTS concernés — deux factures d'un même client ne font qu'un appel.",
  ancien:
    `Ancienneté de la plus vieille créance du parc, recalculée à chaque lecture. Au-delà de ${MISE_EN_DEMEURE_DAYS} jours, la relance téléphonique ne suffit plus.`,
} as const;

/**
 * Le hint des chiffres quand /crm/billing/overdue est tombée : chaque carte
 * qui dépend de la file affiche « — » plutôt qu'un zéro rassurant — l'en-tête
 * interdit d'annoncer un parc à jour sur une requête tombée.
 */
const QUEUE_DOWN_HINT = "Route /crm/billing/overdue indisponible";

export default function FacturationPage() {
  const [queue, setQueue] = useState<BillingQueue | null>(null);
  const [park, setPark] = useState<ParkTenant[] | null>(null);
  const [queueFailed, setQueueFailed] = useState(false);
  const [parkFailed, setParkFailed] = useState(false);
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const [tick, setTick] = useState(0);

  const reload = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;

    // La file et le parc se lisent EN PARALLÈLE et sans se bloquer l'un
    // l'autre : le total dû doit s'afficher même le jour où la liste des
    // clients ne répond pas, et inversement. Aucune des deux n'est bloquante
    // pour l'autre.
    billingApi
      .overdue()
      .then((raw) => {
        if (cancelled) return;
        setQueue(readQueue(raw));
        setQueueFailed(false);
      })
      .catch(() => {
        if (cancelled) return;
        setQueue(EMPTY_QUEUE);
        setQueueFailed(true);
      });

    billingApi
      .park()
      .then((raw) => {
        if (cancelled) return;
        setPark(readPark(raw));
        setParkFailed(false);
      })
      .catch(() => {
        if (cancelled) return;
        setPark([]);
        setParkFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [tick]);

  const mrr = useMemo(
    () => splitMrr(park ?? [], queue ?? EMPTY_QUEUE),
    [park, queue],
  );

  if (queue === null) {
    return (
      <div className="flex flex-col gap-4 p-[26px] max-md:p-4">
        {/* Mêmes contraintes de largeur que la bande réelle : le squelette ne
            doit pas se réorganiser sous les yeux au moment où les chiffres
            arrivent. */}
        <div className="flex flex-wrap gap-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-[124px] min-w-[184px] flex-1 basis-[184px]" />
          ))}
        </div>
        <Skeleton className="h-[260px]" />
      </div>
    );
  }

  const rows = queue.rows;
  const clean = !queueFailed && rows.length === 0;
  const step = recoveryStep(queue.oldestDays);
  // Le trentième jour est la bascule : en dessous, la file se traite au
  // téléphone ; au-delà, elle se traite par écrit et le chiffre doit se voir
  // sans être cherché (DA §7).
  const oldestTone: Tone =
    queue.oldestDays >= MISE_EN_DEMEURE_DAYS ? "alert" : step ? "prep" : "mut";
  const parkKnown = park !== null && park.length > 0;
  // Trois silences distincts derrière un même « — » : le parc encore en route
  // (le squelette de tête ne couvre que la file), la route tombée, ou un parc
  // réellement vide. Chacun son libellé — aucun ne laisse croire l'autre.
  const parkHint = parkFailed
    ? "Route /crm/tenants indisponible"
    : park === null
      ? "Parc en cours de chargement…"
      : "Aucun client au parc";

  return (
    <div className="flex flex-col gap-4 p-[26px] max-md:p-4">
      {/* ── Les quatre chiffres de tête ── */}
      <div className="flex flex-wrap items-stretch gap-4 max-md:gap-3">
        {/* Sans la file, l'« encaissé » compterait tout le parc comme à
            jour — le mensonge exact que l'en-tête interdit. Donc « — ». */}
        <BillingKpi
          label="MRR encaissé"
          icon="euro"
          value={
            parkKnown && !queueFailed ? euroRound(mrr.collectedCents) : "—"
          }
          hint={
            <>
              {queueFailed
                ? QUEUE_DOWN_HINT
                : !parkKnown
                  ? parkHint
                  : mrr.atRiskCents > 0
                    ? `${euroRound(mrr.atRiskCents)} à risque sur ${euroRound(mrr.billedCents)} facturés`
                    : `${int(mrr.onTime)} client${mrr.onTime > 1 ? "s" : ""} à jour, rien à relancer`}
              <span className="sr-only"> {DEFINITIONS.mrr}</span>
            </>
          }
          title={DEFINITIONS.mrr}
        />
        {/*
          Total dû et clients en retard restent NEUTRES, même quand ils ne sont
          pas à zéro. Une couleur par carte ne guide plus rien : ce qui doit
          sauter aux yeux est la QUATRIÈME — l'ancienneté est le seul de ces
          chiffres qui décide d'un geste (DA §3, accent parcimonieux).
        */}
        <BillingKpi
          label="Total dû"
          icon="ticket"
          value={queueFailed ? "—" : queue.totalLabel}
          hint={
            <>
              {queueFailed
                ? QUEUE_DOWN_HINT
                : queue.count === 0
                  ? "Aucune facture échue"
                  : `${int(queue.count)} facture${queue.count > 1 ? "s" : ""} échue${queue.count > 1 ? "s" : ""}`}
              <span className="sr-only"> {DEFINITIONS.totalDu}</span>
            </>
          }
          title={DEFINITIONS.totalDu}
        />
        <BillingKpi
          label="Clients en retard"
          icon="user"
          value={queueFailed ? "—" : int(queue.tenants)}
          hint={
            <>
              {queueFailed
                ? QUEUE_DOWN_HINT
                : queue.tenants === 0
                  ? parkKnown
                    ? `sur ${int(mrr.clients)} client${mrr.clients > 1 ? "s" : ""} au parc`
                    : "personne à relancer"
                  : `${int(queue.tenants)} appel${queue.tenants > 1 ? "s" : ""} à passer${
                      parkKnown
                        ? ` · parc de ${int(mrr.clients)} client${mrr.clients > 1 ? "s" : ""}`
                        : ""
                    }`}
              <span className="sr-only"> {DEFINITIONS.retard}</span>
            </>
          }
          title={DEFINITIONS.retard}
        />
        <BillingKpi
          label="Plus ancien impayé"
          icon="clock"
          tone={oldestTone}
          value={queue.oldestDays > 0 ? fmtDays(queue.oldestDays) : "—"}
          hint={
            <>
              {queueFailed
                ? QUEUE_DOWN_HINT
                : queue.oldestDays === 0
                  ? "Aucune créance en cours"
                  : queue.oldestDays >= MISE_EN_DEMEURE_DAYS
                    ? // On nomme le SEUIL plutôt que de répéter le nombre de
                      // jours affiché juste au-dessus : c'est la règle franchie
                      // qui explique la couleur, pas le chiffre.
                      `Seuil des ${MISE_EN_DEMEURE_DAYS} j franchi — ${step?.geste ?? "à traiter"}`
                    : (step?.geste ?? "À traiter")}
              <span className="sr-only"> {DEFINITIONS.ancien}</span>
            </>
          }
          title={DEFINITIONS.ancien}
        />
      </div>

      {/* Facturer le mois — le geste qui alimente cette file. Placé AVANT
          elle : on facture d'abord, on recouvre ensuite. */}
      <RunMensuel onDone={reload} />

      {queueFailed && (
        <Unavailable
          icon="euro"
          title="File des impayés indisponible"
          hint="La route /crm/billing/overdue n'a pas répondu. Ne concluez pas que le parc est à jour : tant qu'elle ne répond pas, cet écran ne sait rien. La fiche de chaque client porte son ardoise."
        />
      )}

      {/* ── La file, du plus ancien au plus récent ── */}
      {clean ? (
        <Card>
          <EmptyState
            icon="check"
            title="Le parc est à jour"
            hint={
              <>
                Aucune facture échue
                {parkKnown && (
                  <>
                    {" "}
                    sur {int(mrr.clients)} client{mrr.clients > 1 ? "s" : ""}
                  </>
                )}
                . Personne ne nous doit d&apos;argent aujourd&apos;hui
                {parkKnown && mrr.collectedCents > 0 && (
                  <>
                    {" "}
                    et {euroRound(mrr.collectedCents)} d&apos;abonnement mensuel
                    rentrent sans relance
                  </>
                )}
                . Les échéances à venir se lisent sur la fiche de chaque client.
              </>
            }
            action={
              <Link
                href="/sm/clients"
                className="cf-press inline-flex items-center gap-[9px] whitespace-nowrap rounded-pill border border-line bg-white/3 px-3.5 py-[9px] text-[13px] font-bold text-white hover:border-white/25 hover:bg-white/8"
              >
                <Icon name="user" size={15} />
                Restaurants clients
              </Link>
            }
          />
        </Card>
      ) : rows.length > 0 ? (
        <Panel
          title="File de recouvrement"
          sub="Du plus ancien au plus récent — on commence toujours par la créance la plus vieille."
          actions={
            <span
              className={cx(
                "cf-fig whitespace-nowrap rounded-pill border-[1.5px] px-[9px] py-[3px] text-[11px] font-extrabold uppercase tracking-[0.06em]",
                queue.oldestDays >= MISE_EN_DEMEURE_DAYS
                  ? "border-alert/60 text-alertt"
                  : "border-prep/55 text-prept",
              )}
            >
              {int(queue.count)} facture{queue.count > 1 ? "s" : ""} ·{" "}
              {euros(queue.totalCents)}
            </span>
          }
          bodyClassName="-mx-[18px] -mb-[18px]"
        >
          {/*
            Défilement horizontal borné plutôt que repli : cette file est une
            TABLE dont les colonnes se lisent l'une en face de l'autre — une
            ancienneté qui passe sous le nom du client ne se balaie plus.
          */}
          {/* 1000 px : la ligne porte désormais TROIS gestes — en dessous, les
              boutons passeraient sous le montant et la table ne se balaierait
              plus en colonnes. Bureau seulement : sous `md`, chaque créance
              devient une CARTE empilée (voir `OverdueLine`) — un téléphone ne
              balaie pas des colonnes, il lit des fiches. */}
          <ul className="cf-scroll overflow-x-auto md:[&>li]:min-w-[1000px]">
            {rows.map((row) => (
              <OverdueLine
                key={row.id}
                row={row}
                onRemind={(r) => setGesture({ row: r, kind: "relancer" })}
                onPay={(r) => setGesture({ row: r, kind: "encaisser" })}
                onCancel={(r) => setGesture({ row: r, kind: "annuler" })}
              />
            ))}
          </ul>
        </Panel>
      ) : null}

      {/* ── Ce que l'écran affirme, et d'où il le tient ── */}
      <p className="text-[13px] leading-[1.5] text-mut">
        « En retard » ne se stocke pas, il se calcule :{" "}
        <span className="cf-fig">/crm/billing/overdue</span> recompare chaque
        échéance à l&apos;heure qu&apos;il est, à chaque ouverture de cet écran —
        cette file ne peut donc pas être périmée, même si rien ne tourne la nuit.
        Une facture envoyée dont l&apos;échéance n&apos;est pas passée n&apos;y
        figure pas : ce n&apos;est pas un impayé, c&apos;est un encaissement à
        venir. Une facture ne se supprime jamais — elle s&apos;annule avec un
        motif, et son numéro reste consommé.
      </p>

      {/* ── Les gestes ── */}
      {gesture?.kind === "relancer" && (
        <RemindModal
          key={`remind-${gesture.row.id}`}
          row={gesture.row}
          onClose={() => setGesture(null)}
          onDone={reload}
        />
      )}
      {gesture?.kind === "encaisser" && (
        <PayModal
          key={`pay-${gesture.row.id}`}
          row={gesture.row}
          onClose={() => setGesture(null)}
          onDone={reload}
        />
      )}
      {gesture?.kind === "annuler" && (
        <CancelModal
          key={`cancel-${gesture.row.id}`}
          row={gesture.row}
          onClose={() => setGesture(null)}
          onDone={reload}
        />
      )}
    </div>
  );
}
