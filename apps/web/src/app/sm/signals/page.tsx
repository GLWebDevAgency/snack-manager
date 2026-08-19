"use client";

/**
 * FILE DE TRAVAIL — ce que l'équipe traite aujourd'hui.
 *
 * La liste des clients répond à « comment va le parc ? ». Cette page répond à
 * une autre question, plus étroite et plus utile le lundi matin : « qui
 * j'appelle, dans quel ordre, et pour lui dire quoi ? »
 *
 * D'où le groupement par GRAVITÉ plutôt que par client : deux appareils muets
 * chez deux restaurants différents se traitent dans le même geste, alors qu'un
 * impayé et un module dormant chez le même client ne se traitent pas du tout au
 * même moment.
 *
 * ─── Écran d'ACTION, pas tableau contemplatif ───
 *
 * Chaque ligne porte quatre choses et rien d'autre : QUI (le restaurant, sa
 * ville, sa famille de signal), QUOI (le fait, chiffré, tel que l'API le
 * rédige), DEPUIS QUAND, et LA PHRASE À DIRE quand le gérant décroche. Cette
 * dernière est la seule chose de la ligne qui se traduit en geste : elle est
 * détachée, en pleine largeur, et jamais tronquée — une consigne coupée à
 * « Appeler le comptoir : tablette débran… » ne sert à personne.
 *
 * La ligne entière ouvre la fiche du client (`href`, rendu par l'API) — c'est là
 * que se passe l'appel, avec le numéro et le bouton « suspendre ». Aucun
 * graphique ici : une file de travail se vide, elle ne se contemple pas.
 *
 * Cloisonnement : `/crm/signals` traverse tout le parc, rôle `sm_admin` exigé
 * côté API. Respect des clients de nos clients : un signal porte un
 * ÉTABLISSEMENT et un agrégat, jamais un consommateur.
 */

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { cx } from "@/lib/cx";
import { Card, Chip, Icon, Kpi, Skeleton } from "@/components/ui";
import { int } from "../crm";
import {
  clientsApi,
  fmtSignalAge,
  fmtSignalFigure,
  fmtSignalSince,
  readClientRows,
  SIGNAL_SEVERITIES,
  SIGNAL_SEVERITY_HINTS,
  SIGNAL_SEVERITY_LABELS,
  type ClientRow,
  type SignalSeverity,
} from "../clients/data";
import { SeverityPill, Unavailable } from "../clients/ui";
import {
  groupBySeverity,
  readWorkSignals,
  SIGNAL_KIND_ICONS,
  type WorkSignal,
} from "./data";

const SEVERITY_ICON: Record<SignalSeverity, "phone" | "clock" | "star"> = {
  critique: "phone",
  attention: "clock",
  info: "star",
};

/**
 * Teinte fonctionnelle d'une bande — vert, ambre, rouge, jamais l'accent laiton
 * (DA §3). L'accent sert aux actions primaires ; le rouge dit « urgent ». Les
 * confondre priverait l'écran de sa seule hiérarchie visible à un mètre.
 */
const SEVERITY_TONE: Record<
  SignalSeverity,
  { icon: string; figure: string; rail: string; row: string }
> = {
  critique: {
    icon: "text-alertt",
    figure: "border-alert/60 text-alertt",
    rail: "bg-alert",
    row: "bg-alert/6",
  },
  attention: {
    icon: "text-prept",
    figure: "border-prep/55 text-prept",
    rail: "bg-prep/70",
    row: "",
  },
  info: {
    icon: "text-mut",
    figure: "border-white/18 text-mut",
    rail: "bg-white/20",
    row: "",
  },
};

export default function SignalsPage() {
  const [signals, setSignals] = useState<WorkSignal[] | null>(null);
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [failed, setFailed] = useState(false);
  const [only, setOnly] = useState<SignalSeverity | "tous">("tous");

  useEffect(() => {
    let cancelled = false;
    clientsApi
      .signals()
      .then((raw) => {
        if (!cancelled) setSignals(readWorkSignals(raw));
      })
      .catch(() => {
        if (cancelled) return;
        setSignals([]);
        setFailed(true);
      });
    // Le parc sert d'annuaire : un signal peut ne porter qu'un `tenantId`, et
    // « 6a84…5ba9 » ne se dit pas au téléphone. Il donne aussi la ville, utile
    // pour situer un appel, et le nombre de restaurants CALMES — c'est lui qui
    // rend l'écran vide rassurant plutôt que suspect.
    clientsApi
      .list()
      .then((raw) => {
        if (!cancelled) setClients(readClientRows(raw));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const directory = useMemo(
    () => new Map(clients.map((c) => [c._id, c])),
    [clients],
  );

  const grouped = useMemo(() => groupBySeverity(signals ?? []), [signals]);

  if (signals === null) {
    return (
      <div className="flex flex-col gap-4 p-[26px]">
        <div className="flex gap-4">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-[124px] flex-1" />
          ))}
        </div>
        <Skeleton className="h-[300px]" />
      </div>
    );
  }

  const total = signals.length;
  /** Combien de RESTAURANTS à appeler — le chiffre qui dit la charge du matin. */
  const tenants = new Set(signals.map((s) => s.tenantId || s.key)).size;
  const shown = SIGNAL_SEVERITIES.filter((s) => only === "tous" || only === s);

  return (
    <div className="flex flex-col gap-4 p-[26px]">
      {/*
        La coquille `/sm` titre d'après sa propre table de navigation, qui ne
        connaît pas encore cette page : on repose donc un titre ici plutôt que
        de laisser l'en-tête annoncer autre chose.
      */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-2xl font-extrabold tracking-[-0.03em] text-ink">
            File de travail
          </h2>
          <p className="mt-0.5 text-sm text-mut">
            {total === 0
              ? "Les signaux du parc, groupés par gravité — du plus urgent au simple prétexte d'appel."
              : /* « signal » fait « signaux » : le pluriel anglais s'était glissé ici. */
                `${int(total)} signa${total > 1 ? "ux" : "l"} ouvert${total > 1 ? "s" : ""} sur ${int(tenants)} restaurant${tenants > 1 ? "s" : ""} — du plus urgent au simple prétexte d'appel.`}
          </p>
        </div>
        <Link
          href="/sm/clients"
          className="cf-press inline-flex items-center gap-[9px] whitespace-nowrap rounded-pill border border-line bg-white/3 px-3.5 py-[9px] text-[13px] font-bold text-white hover:border-white/25 hover:bg-white/8"
        >
          <Icon name="user" size={15} />
          Restaurants clients
        </Link>
      </div>

      <div className="flex items-stretch gap-4">
        {SIGNAL_SEVERITIES.map((s) => (
          <Kpi
            key={s}
            label={SIGNAL_SEVERITY_LABELS[s]}
            value={int(grouped[s].length)}
            icon={SEVERITY_ICON[s]}
            delta={
              s === "critique" && grouped[s].length > 0
                ? { dir: "down", text: "à traiter aujourd'hui" }
                : undefined
            }
          />
        ))}
      </div>

      {failed && (
        <Unavailable
          title="File de signaux indisponible"
          hint="La route /crm/signals n'a pas répondu. En attendant, la liste des clients reste la porte d'entrée : elle remonte les décrochages en tête."
        />
      )}

      {total > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <Chip on={only === "tous"} onClick={() => setOnly("tous")}>
            Tout
            <span className="cf-fig rounded-pill bg-white/12 px-1.5 text-[11px] font-extrabold">
              {total}
            </span>
          </Chip>
          {SIGNAL_SEVERITIES.map((s) => (
            <Chip key={s} on={only === s} onClick={() => setOnly(s)}>
              {SIGNAL_SEVERITY_LABELS[s]}
              {/*
                Une bande VIDE reste neutre : un « 0 » en rouge attire l'œil
                pour dire qu'il n'y a rien à voir, et la couleur d'alerte perd
                son sens à force de s'allumer sans motif (DA §3).
              */}
              <span
                className={cx(
                  "cf-fig rounded-pill px-1.5 text-[11px] font-extrabold",
                  grouped[s].length === 0
                    ? "bg-white/8 text-mut"
                    : s === "critique"
                      ? "bg-alert text-white"
                      : s === "attention"
                        ? "bg-prep/80 text-black"
                        : "bg-white/12",
                )}
              >
                {grouped[s].length}
              </span>
            </Chip>
          ))}
        </div>
      )}

      {total === 0 && !failed ? (
        <AllClear parkSize={clients.length} />
      ) : (
        shown.map((severity) => {
          const rows = grouped[severity];
          if (rows.length === 0) return null;
          return (
            <SeverityGroup
              key={severity}
              severity={severity}
              signals={rows}
              directory={directory}
            />
          );
        })
      )}

      {total > 0 && (
        <p className="text-[13px] text-mut">
          Gravité, ordre d&apos;appel et consigne viennent de l&apos;API (
          <span className="cf-fig">/crm/signals</span>) : bande d&apos;abord,
          gravité chiffrée ensuite, puis le plus ancien — un signal qui traîne
          depuis dix jours est un client qu&apos;on a déjà laissé attendre. La
          ligne détachée dit ce qu&apos;on fait du signal ; l&apos;appel, lui, se
          passe sur la fiche.
        </p>
      )}
    </div>
  );
}

/**
 * PARC SAIN — l'écran doit RASSURER, pas ressembler à une panne.
 *
 * Un vide sans explication se lit comme un service à l'arrêt : on a déjà vu
 * l'équipe recharger la page pour vérifier. D'où le contraire d'un état vide :
 * un titre affirmatif, le nombre de restaurants réellement passés en revue, et
 * la liste NOMMÉE de ce qui a été vérifié — c'est cette énumération qui
 * transforme « rien ne s'affiche » en « tout va bien ». Vert fonctionnel, sans
 * pictogramme d'alerte (DA §3).
 */
function AllClear({ parkSize }: { parkSize: number }) {
  const checked = [
    "aucun accès coupé",
    "aucun impayé",
    "aucun décrochage d'activité",
    "aucun appareil muet",
    "aucune rupture d'appro",
    "aucun module dormant",
  ];

  return (
    <Card className="p-0">
      <div className="flex flex-col items-center gap-3 px-[18px] py-10 text-center">
        <div
          className="grid size-12 place-items-center rounded-card border border-ok/45 bg-ok/12 text-okt"
          aria-hidden
        >
          <Icon name="check" size={22} />
        </div>
        <div>
          <p className="text-[15px] font-extrabold text-ink">
            Parc sain — rien à traiter aujourd&apos;hui
          </p>
          <p className="mt-1 max-w-[440px] text-[13px] text-mut">
            {/* « Les 1 restaurant » : le singulier prend son propre tour de phrase. */}
            {parkSize > 1
              ? `Les ${int(parkSize)} restaurants du parc ont été passés en revue à l'instant.`
              : parkSize === 1
                ? "Le seul restaurant du parc a été passé en revue à l'instant."
                : "Le parc a été passé en revue à l'instant."}{" "}
            La file est vide parce qu&apos;elle a tourné, pas parce qu&apos;elle
            est en panne.
          </p>
        </div>

        <ul className="mt-1 flex flex-wrap items-center justify-center gap-1.5">
          {checked.map((c) => (
            <li
              key={c}
              className="inline-flex items-center gap-1.5 rounded-pill border border-ok/30 bg-ok/8 px-2.5 py-1 text-[12px] font-semibold text-okt"
            >
              <Icon name="check" size={12} />
              {c}
            </li>
          ))}
        </ul>

        <p className="mt-1 text-[13px] text-mut">
          Le bon moment pour appeler un client qui va bien.
        </p>
        <Link
          href="/sm/clients"
          className="cf-press mt-1 inline-flex items-center gap-[9px] rounded-pill bg-btndark px-3.5 py-[9px] text-[13px] font-bold text-white hover:bg-[#333]"
        >
          <Icon name="phone" size={15} />
          Choisir un client à appeler
        </Link>
      </div>
    </Card>
  );
}

function SeverityGroup({
  severity,
  signals,
  directory,
}: {
  severity: SignalSeverity;
  signals: WorkSignal[];
  directory: Map<string, ClientRow>;
}) {
  return (
    <Card className="p-0">
      <div className="flex items-center gap-3 bg-[image:var(--cf-elev-gradient)] px-[18px] py-3">
        <SeverityPill severity={severity} />
        <span className="cf-fig text-[13px] font-extrabold text-ink">
          {int(signals.length)}
        </span>
        <span className="min-w-0 flex-1 truncate text-[13px] text-mut">
          {SIGNAL_SEVERITY_HINTS[severity]}
        </span>
      </div>

      {/*
        Largeur minimale plus basse que la table des clients : ici les blocs
        sont du TEXTE, qui se replie proprement. On ne défile que si la fenêtre
        descend sous la largeur où les deux colonnes cessent d'être lisibles
        côte à côte.
      */}
      <ul className="cf-scroll overflow-x-auto [&>li]:min-w-[560px]">
        {signals.map((s) => (
          <SignalRow key={s.key} signal={s} client={directory.get(s.tenantId)} />
        ))}
      </ul>
    </Card>
  );
}

/**
 * Une ligne = un appel.
 *
 * La ligne entière est le lien vers la fiche, comme dans la liste des clients :
 * on vise large en décrochant. Le « Ouvrir la fiche » à droite n'est pas un
 * second lien, c'est l'affordance de celui-ci.
 *
 * La consigne (`action`) passe SOUS les deux colonnes, en pleine largeur : c'est
 * la phrase la plus longue de la ligne et la seule qui doit se lire en entier.
 * Coincée dans une colonne, elle se faisait tronquer — soit exactement
 * l'information qu'on venait chercher.
 */
function SignalRow({
  signal: s,
  client,
}: {
  signal: WorkSignal;
  client: ClientRow | undefined;
}) {
  const name = s.tenantName || client?.name || "Restaurant inconnu";
  const tone = SEVERITY_TONE[s.severity];
  // Une unité qui ne se résume pas ne s'invente pas : sans suffixe sûr, la
  // pastille chiffrée disparaît et le `detail` porte seul le chiffre — il le
  // porte déjà, rédigé par l'API.
  const figure = fmtSignalFigure(s);
  const age = fmtSignalAge(s.ageDays);

  return (
    <li>
      <Link
        href={s.href}
        className={cx(
          "cf-press-row relative block border-t border-line px-[18px] py-3.5 hover:bg-white/4",
          tone.row,
        )}
      >
        {s.severity !== "info" && (
          <span
            className={cx("absolute inset-y-0 left-0 w-[3px]", tone.rail)}
            aria-hidden
          />
        )}

        <div className="flex items-start gap-3.5">
          {/* ── Qui, et de quelle famille ── */}
          <div className="flex min-w-0 basis-[230px] items-start gap-2.5">
            <Icon
              name={SIGNAL_KIND_ICONS[s.kind]}
              size={17}
              className={cx("mt-px shrink-0", tone.icon)}
            />
            <div className="min-w-0">
              <div className="truncate text-[14px] font-bold text-ink">{name}</div>
              <div className="truncate text-[11px] font-extrabold uppercase tracking-[0.06em] text-mut">
                {s.kindLabel}
                {client?.city && ` · ${client.city}`}
              </div>
            </div>
          </div>

          {/* ── Quoi, chiffres à l'appui ── */}
          <div className="min-w-0 flex-1">
            <div className="text-[13.5px] font-bold text-ink">{s.title}</div>
            {s.detail && (
              <div className="mt-0.5 text-xs leading-[1.45] text-mut">{s.detail}</div>
            )}
          </div>

          {/* ── Le chiffre, l'ancienneté, la sortie ── */}
          <div className="flex shrink-0 flex-col items-end gap-1.5">
            {figure && (
              <span
                className={cx(
                  "cf-fig whitespace-nowrap rounded-pill border-[1.5px] px-2 py-px text-[12px] font-extrabold",
                  tone.figure,
                )}
                title={`${s.value} ${s.unit}`}
              >
                {figure}
              </span>
            )}
            {age && (
              <span
                className="whitespace-nowrap text-[12.5px] text-mut"
                title={fmtSignalSince(s.since)}
              >
                {age}
              </span>
            )}
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[13px] font-bold text-accent">
              Ouvrir la fiche
              <Icon name="arrow" size={15} />
            </span>
          </div>
        </div>

        {/*
          LA PHRASE À DIRE, détachée par un filet et jamais tronquée : c'est la
          seule chose de cette ligne qui se traduit en geste, elle ne doit pas se
          confondre avec le constat qui la précède. Elle vient de l'API
          (`action`) — c'est elle qui connaît le montant de l'ardoise ou les
          jours d'essai restants.
        */}
        <p className="mt-2 border-l-2 border-white/15 pl-2.5 text-[13px] font-semibold leading-[1.45] text-ink/90">
          <span className="mr-1.5 text-[11px] font-extrabold uppercase tracking-[0.06em] text-mut">
            À dire
          </span>{" "}
          {s.action}
        </p>
      </Link>
    </li>
  );
}
