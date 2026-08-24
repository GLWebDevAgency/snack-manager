"use client";

/**
 * LES SECTIONS DE LA FICHE CLIENT — dans l'ordre où on en parle au téléphone.
 *
 *   santé → adoption → parc d'appareils → approvisionnement → conseil → notes
 *
 * Chaque section répond à une question de l'appel : « comment il va ? », « il
 * paie quoi qu'il n'utilise pas ? », « sa tablette répond ? », « il va manquer
 * de quoi ? », « qu'est-ce que je lui apporte ? », « qu'a-t-on déjà dit ? ».
 *
 * Densité assumée : cet écran s'ouvre en parlant, pas en flânant. Priorité à
 * l'information utile sur la décoration — sans déroger à la charte (surfaces
 * stratifiées, accent parcimonieux, couleurs fonctionnelles inchangées).
 *
 * RESPECT DES CLIENTS DE NOS CLIENTS : aucune section ne liste un consommateur.
 * Ce qui s'affiche ici, ce sont des agrégats d'établissement — nombre de
 * commandes, chiffre d'affaires, panier moyen, créneaux. Le fichier client du
 * restaurateur lui appartient.
 */

import Link from "next/link";
import { useState } from "react";
import {
  ADMIN_LOG_ACTION_LABELS,
  CLIENT_HEALTH_LABELS,
  type AdminLogEntry,
} from "@sm/contracts";
import { cx } from "@/lib/cx";
import { fmtEuro, timeAgo } from "@/lib/format";
import { Btn, Icon, Input, Panel, useToast } from "@/components/ui";
import { euroRound, fmtDay, int } from "../../crm";
import {
  clientsApi,
  fmtInsightFigure,
  fmtSignalAge,
  fmtSignalFigure,
  fmtSignalSince,
  fmtSince,
  scoreHealth,
  HEALTH_TEXT,
  SEVERITY_BORDER,
  SEVERITY_RANK,
  SUPPLY_ALERT_LABELS,
  type ActivityWindow,
  type ClientFile,
  type ClientSignal,
  type HealthComponent,
  type ModuleAdoption,
  type ParkDevice,
  type Recommendation,
  type SupplyAlertKind,
  type TenantActivity,
} from "../data";
import { Eyebrow, Meter, ScorePill, Trend, Unavailable } from "../ui";

// ─────────────────────────────────────────────────────────────
// Santé
// ─────────────────────────────────────────────────────────────

/**
 * Le score et SA DÉCOMPOSITION.
 *
 * Un score seul ne se dit pas au téléphone : « vous êtes à 42 » n'aide
 * personne. Ce qui aide, c'est « 42, parce que vos commandes ont baissé d'un
 * tiers et que votre écran cuisine n'a pas battu depuis trois jours ». La
 * décomposition n'est donc pas un détail replié, c'est la section.
 */
export function HealthSection({ file }: { file: ClientFile }) {
  const tone = scoreHealth(file.score) ?? file.health;
  const has = file.components.length > 0 || file.activity !== null;

  return (
    <Panel
      title="Santé du compte"
      sub="Score sur 100 et ce qui le compose"
      actions={<ScorePill score={file.score} health={file.health} />}
    >
      {!has ? (
        <Unavailable
          icon="chart"
          title="Score non calculé"
          hint={
            file.offline.has("health")
              ? "La route /crm/tenants/:id/health n'a pas répondu. La santé affichée retombe sur la dernière commande encaissée."
              : "L'API n'a pas encore renvoyé de décomposition pour ce client."
          }
        />
      ) : (
        // Sous `md`, le chiffre passe AU-DESSUS de sa décomposition : deux
        // colonnes dans 358 px utiles écraseraient les jauges.
        <div className="flex items-start gap-4 max-md:flex-col max-md:items-stretch">
          {/* ── Le chiffre ── */}
          <div className="flex w-[124px] shrink-0 flex-col items-center gap-1 rounded-card border border-white/6 bg-[image:var(--cf-elev-gradient)] p-3.5 max-md:w-full">
            <div className={cx("cf-fig text-[40px] font-extrabold leading-none", HEALTH_TEXT[tone])}>
              {file.score ?? "—"}
            </div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-mut">
              sur 100
            </div>
            <div className={cx("mt-1 text-[13px] font-bold", HEALTH_TEXT[tone])}>
              {CLIENT_HEALTH_LABELS[tone]}
            </div>
          </div>

          {/* ── Ce qui le compose ── */}
          <div className="min-w-0 flex-1">
            {file.components.length === 0 ? (
              <Unavailable
                icon="chart"
                title="Décomposition indisponible"
                hint="Le service renvoie un score global sans détail des critères."
              />
            ) : (
              <ul className="flex flex-col gap-2.5">
                {file.components.map((c) => (
                  <ComponentRow key={c.key} component={c} />
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {file.activity && <ActivityBlock activity={file.activity} />}
    </Panel>
  );
}

function ComponentRow({ component: c }: { component: HealthComponent }) {
  // Axe NON MESURÉ : la donnée manque, ce n'est pas une mauvaise note. Ni
  // chiffre ni jauge — une jauge à zéro se lirait « critique » sur un client
  // signé hier ; la phrase de l'API dit ce qui manquait.
  if (!c.measured || c.score === null) {
    return (
      <li>
        <div className="flex items-baseline justify-between gap-2">
          <span className="min-w-0 truncate text-[13px] font-bold text-ink">
            {c.label}
            <span className="ml-1.5 cf-fig text-[11px] font-semibold text-mut">
              {c.weight} %
            </span>
          </span>
          <span className="shrink-0 text-[11px] font-bold uppercase tracking-[0.04em] text-mut/70">
            non mesuré
          </span>
        </div>
        {c.detail && <p className="mt-1 text-xs leading-[1.4] text-mut">{c.detail}</p>}
      </li>
    );
  }

  const tone = scoreHealth(c.score) ?? "attention";
  return (
    <li>
      <div className="flex items-baseline justify-between gap-2">
        <span className="min-w-0 truncate text-[13px] font-bold text-ink">
          {c.label}
          <span className="ml-1.5 cf-fig text-[11px] font-semibold text-mut">
            {c.weight} %
          </span>
        </span>
        <span className={cx("cf-fig shrink-0 text-[13px] font-extrabold", HEALTH_TEXT[tone])}>
          {c.score}
        </span>
      </div>
      <Meter className="mt-1" value={c.score} tone={tone} />
      {c.detail && <p className="mt-1 text-xs leading-[1.4] text-mut">{c.detail}</p>}
    </li>
  );
}

/**
 * L'ACTIVITÉ COMPARÉE — les deux fenêtres du contrat, 7 jours puis 30.
 *
 * Le graphique de série journalière a DISPARU avec l'ancien lecteur : la route
 * ne rend pas de série (`CrmTenantActivity` n'en porte pas), et un graphique
 * qui attend une donnée jamais envoyée est un bloc vide déguisé en graphique.
 * S'il revient un jour, ce sera par le contrat.
 */
function ActivityBlock({ activity }: { activity: TenantActivity }) {
  return (
    <div className="mt-4 border-t border-line pt-4">
      <ActivityWindowBlock window={activity.last7d} />
      <ActivityWindowBlock window={activity.last30d} className="mt-3.5" />
    </div>
  );
}

function ActivityWindowBlock({
  window: w,
  className,
}: {
  window: ActivityWindow;
  className?: string;
}) {
  // Le panier moyen de la période PRÉCÉDENTE se déduit des deux champs que
  // l'API rend (même division que son `avgBasketCents`) — c'est une mise en
  // forme, pas une tendance inventée : aucun pourcentage n'en est tiré.
  const previousBasket =
    w.previousOrders > 0
      ? Math.round(w.previousRevenueCents / w.previousOrders)
      : null;

  return (
    <div className={className}>
      <Eyebrow>
        Activité sur {w.days} jours, comparée aux {w.days} précédents
      </Eyebrow>
      {/* Trois mesures empilées sous `md` — trois cartes de front y feraient
          tenir « Chiffre d'affaires » sur 100 px. */}
      <div className="mt-2.5 flex items-stretch gap-3 max-md:flex-col">
        <Compare
          label="Commandes"
          current={w.orders}
          previous={w.previousOrders}
          deltaPct={w.ordersDeltaPct}
          format={(n) => int(n)}
        />
        <Compare
          label="Chiffre d'affaires"
          current={w.revenueCents}
          previous={w.previousRevenueCents}
          deltaPct={w.revenueDeltaPct}
          format={euroRound}
        />
        <Compare
          label="Panier moyen"
          current={w.avgBasketCents}
          previous={previousBasket}
          format={(n) => fmtEuro(n)}
        />
      </div>
    </div>
  );
}

function Compare({
  label,
  current,
  previous,
  deltaPct,
  format,
}: {
  label: string;
  current: number;
  /** `null` = pas de période de référence à montrer. */
  previous: number | null;
  /**
   * La variation TELLE QUE L'API la rend. `null` est un REFUS (période de
   * référence trop faible pour qu'un pourcentage veuille dire quelque chose) —
   * on l'écrit, on ne recalcule JAMAIS le chiffre que l'API a refusé d'écrire.
   * Absent = la mesure n'a pas de tendance (panier moyen).
   */
  deltaPct?: number | null;
  format: (n: number) => string;
}) {
  return (
    <div className="min-w-0 flex-1 rounded-card border border-white/6 bg-[image:var(--cf-elev-gradient)] p-3">
      <div className="truncate text-[11px] font-semibold uppercase tracking-[0.06em] text-mut">
        {label}
      </div>
      <div className="cf-fig mt-1 text-xl font-extrabold text-ink">
        {format(current)}
      </div>
      <div className="mt-0.5 flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
        {deltaPct !== undefined &&
          (deltaPct === null ? (
            <span className="text-[11px] text-mut/60">tendance non mesurable</span>
          ) : (
            <Trend pct={deltaPct} />
          ))}
        {previous !== null && (
          <span className="cf-fig truncate text-[11px] text-mut">
            contre {format(previous)}
          </span>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Adoption des modules
// ─────────────────────────────────────────────────────────────

/**
 * CE QUI EST OUVERT SANS SERVIR — le sujet d'appel le plus utile.
 *
 * Ces modules-là remontent EN TÊTE et portent la seule couleur de la section :
 * un module ouvert et jamais utilisé, c'est de la formation à prévoir, ou un
 * client qui résiliera. Les deux se règlent par un appel, et cet appel
 * commence ici.
 *
 * JAMAIS « facturé » : `provisioned` dit qu'un module est OUVERT (matériel
 * appairé, surface en service), pas que la formule le facture — aucune
 * correspondance formule → modules n'existe (limite documentée en tête de
 * `signals.service.ts`, publiée dans `CRM_SIGNAL_LIMITS`). L'écran affirmait
 * ici une facturation que l'API refuse précisément d'affirmer, sur la foi d'un
 * champ `included` qu'elle n'a jamais envoyé.
 */
export function AdoptionSection({ file }: { file: ClientFile }) {
  const modules = [...file.modules].sort((a, b) => {
    const wasted = (m: ModuleAdoption) => (m.provisioned && !m.used ? 0 : m.used ? 1 : 2);
    return wasted(a) - wasted(b) || a.label.localeCompare(b.label, "fr");
  });
  const unused = modules.filter((m) => m.provisioned && !m.used);

  return (
    <Panel
      title="Adoption des modules"
      sub={
        modules.length === 0
          ? "Ce qu'il utilise, ce qu'il a ouvert sans s'en servir"
          : `${modules.filter((m) => m.used).length} module${modules.filter((m) => m.used).length > 1 ? "s" : ""} utilisé${modules.filter((m) => m.used).length > 1 ? "s" : ""} sur ${modules.length}`
      }
      actions={
        unused.length > 0 ? (
          <span className="rounded-pill border-[1.5px] border-prep/55 px-[9px] py-[3px] text-[10px] font-extrabold uppercase tracking-[0.06em] text-prept">
            {unused.length} ouvert{unused.length > 1 ? "s" : ""} jamais utilisé
            {unused.length > 1 ? "s" : ""}
          </span>
        ) : undefined
      }
    >
      {modules.length === 0 ? (
        <Unavailable
          icon="grid"
          title="Adoption indisponible"
          hint={
            file.offline.has("health")
              ? "La route /crm/tenants/:id/health n'a pas répondu : impossible de dire ce que ce client utilise."
              : "L'API n'a renvoyé aucun module pour ce client."
          }
        />
      ) : (
        <ul className="grid grid-cols-2 gap-2.5 max-md:grid-cols-1">
          {modules.map((m) => (
            <ModuleTile key={m.key} module={m} />
          ))}
        </ul>
      )}
    </Panel>
  );
}

function ModuleTile({ module: m }: { module: ModuleAdoption }) {
  const wasted = m.provisioned && !m.used;
  return (
    <li
      className={cx(
        "rounded-card border p-3",
        wasted
          ? "border-prep/45 bg-prep/8"
          : "border-white/6 bg-[image:var(--cf-elev-gradient)]",
      )}
    >
      <div className="flex items-start gap-2">
        <Icon
          name={m.used ? "check" : wasted ? "bell" : "minus"}
          size={16}
          className={cx(
            "mt-px shrink-0",
            m.used ? "text-okt" : wasted ? "text-prept" : "text-mut",
          )}
        />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-bold text-ink">{m.label}</div>
          <div
            className={cx(
              "mt-0.5 text-xs font-semibold",
              m.used ? "text-mut" : wasted ? "text-prept" : "text-mut/70",
            )}
          >
            {/* « Ouvert, jamais utilisé » — jamais « facturé » : voir l'en-tête
                de la section. Les volumes vivent dans `detail`, rédigé par
                l'API. */}
            {m.used ? "Utilisé" : wasted ? "Ouvert, jamais utilisé" : "Non ouvert"}
            {m.used && m.lastUsedAt && ` · ${fmtSince(m.lastUsedAt)}`}
          </div>
          {m.detail && (
            <p className="mt-1 text-xs leading-[1.4] text-mut">{m.detail}</p>
          )}
        </div>
      </div>
    </li>
  );
}

// ─────────────────────────────────────────────────────────────
// Parc d'appareils
// ─────────────────────────────────────────────────────────────

/**
 * TABLETTES ET ÉCRANS — l'état du matériel posé sur le comptoir.
 *
 * Une caisse muette pendant le service est un incident : plus personne
 * n'encaisse. Elle remonte donc en tête, en rouge, avec la durée du silence.
 * La révocation vit ici parce que c'est ici qu'on constate la perte — mais elle
 * passe par une modale dédiée : couper une tablette en service est un geste
 * grave, pas un bouton de liste.
 */
export function DevicesSection({
  file,
  onRevoke,
}: {
  file: ClientFile;
  onRevoke: (device: ParkDevice) => void;
}) {
  const devices = [...file.devices].sort(
    (a, b) => Number(a.online) - Number(b.online) || a.name.localeCompare(b.name, "fr"),
  );
  const offline = devices.filter((d) => !d.online).length;

  return (
    <Panel
      title="Parc d'appareils"
      sub={
        devices.length === 0
          ? "Tablettes de caisse, écrans cuisine et téléviseurs de salle"
          : `${devices.length} appareil${devices.length > 1 ? "s" : ""}${offline > 0 ? ` · ${offline} hors ligne` : " · tous en ligne"}`
      }
      bodyClassName="-mx-[18px] -mb-[18px]"
    >
      {devices.length === 0 ? (
        <div className="px-[18px] pb-[18px]">
          <Unavailable
            icon="tv"
            title="Parc indisponible"
            hint={
              file.offline.has("health")
                ? "La route /crm/tenants/:id/health n'a pas répondu : impossible de dire si les tablettes de ce client répondent."
                : "Aucun appareil appairé, ou l'API ne renvoie pas encore le parc."
            }
          />
        </div>
      ) : (
        <ul>
          {devices.map((d) => (
            <DeviceRow key={`${d.kind}-${d.id}`} device={d} onRevoke={onRevoke} />
          ))}
        </ul>
      )}
    </Panel>
  );
}

function DeviceRow({
  device: d,
  onRevoke,
}: {
  device: ParkDevice;
  onRevoke: (device: ParkDevice) => void;
}) {
  return (
    <li
      className={cx(
        // `flex-wrap` : cette carte vit dans la colonne étroite de la fiche.
        // Sans lui, le nom se faisait rogner en « Cais… » sur la ligne MÊME
        // où se trouve le bouton de révocation — on ne pouvait plus dire
        // quelle tablette on s'apprêtait à couper. L'état et l'horodatage
        // passent sous le nom plutôt que de lui voler sa place.
        "flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-line px-[18px] py-2.5",
        !d.online && "bg-alert/6",
      )}
    >
      <Icon
        name={d.kind === "screen" ? "tv" : d.kind === "kds" ? "fries" : "cart"}
        size={17}
        className="shrink-0 text-mut"
      />
      <div className="min-w-[152px] flex-1 basis-[152px]">
        {/* Le nom porte aussi son `title` : dernier filet quand la colonne est
            vraiment trop étroite, avant un geste irréversible. */}
        <div className="truncate text-[13.5px] font-bold text-ink" title={d.name}>
          {d.name}
        </div>
        <div className="truncate text-xs text-mut">
          {d.kindLabel}
          {!d.paired && " · en attente d'appairage"}
          {/* La télémétrie du battement, quand la tablette l'envoie : c'est
              elle qui remplace « fermez et rouvrez l'application » au
              téléphone par un diagnostic. */}
          {d.appVersion && ` · v${d.appVersion}`}
          {d.queueDepth !== null && d.queueDepth > 0 && ` · file : ${d.queueDepth}`}
        </div>
        {d.lastError && (
          <div className="truncate text-xs font-semibold text-alertt" title={d.lastError}>
            Dernière erreur : {d.lastError}
          </div>
        )}
      </div>

      <span
        className={cx(
          "flex shrink-0 items-center gap-1.5 text-[12.5px] font-bold",
          d.online ? "text-okt" : "text-alertt",
        )}
      >
        <span
          className={cx(
            "size-[7px] shrink-0 rounded-full",
            d.online ? "bg-ok" : "bg-alert animate-pulse",
          )}
          aria-hidden
        />
        {d.online ? "En ligne" : "Hors ligne"}
      </span>

      <span
        className="ml-auto shrink-0 truncate text-right text-[12.5px] text-mut"
        title={
          d.lastSeenAt
            ? new Date(d.lastSeenAt).toLocaleString("fr-FR")
            : "Aucun battement de cœur reçu"
        }
      >
        {fmtSince(d.lastSeenAt)}
      </span>

      <Btn
        variant="ghost"
        size="sm"
        icon="trash"
        className="shrink-0 border-alert/40 text-alertt hover:border-alert hover:bg-alert/12 max-md:min-h-11"
        onClick={() => onRevoke(d)}
      >
        Révoquer
      </Btn>
    </li>
  );
}

// ─────────────────────────────────────────────────────────────
// Approvisionnement
// ─────────────────────────────────────────────────────────────

const SUPPLY_STYLE: Record<SupplyAlertKind, string> = {
  rupture: "border-alert/60 text-alertt",
  seuil: "border-prep/55 text-prept",
  prix: "border-white/20 text-mut",
};

/** Une ligne de la section, construite depuis les COMPTEURS du contrat. */
type SupplyRow = { key: string; kind: SupplyAlertKind; name: string; detail: string };

const plural = (n: number) => (n > 1 ? "s" : "");
const fmtPct1 = (n: number) =>
  n.toLocaleString("fr-FR", { maximumFractionDigits: 1 });

/**
 * Ce qui manque déjà, ce qui va manquer, ce qui coûte plus cher qu'avant.
 *
 * `/health` rend l'appro COMPTÉE (`ruptures`, `belowPar`, `priceIncreases30d`)
 * et ne nomme que les trois plus fortes hausses de prix : la section dit les
 * nombres et nomme ce que l'API nomme — rien de plus. L'ancien lecteur
 * attendait des LISTES d'alertes et affichait « aucune rupture » devant des
 * compteurs pleins.
 *
 * `available: false` = le contexte appro (PostgreSQL) n'a pas répondu. Les
 * compteurs valent alors zéro SANS rien dire du stock réel : la section se dit
 * indisponible — annoncer un stock sain pendant une panne, c'est mentir au
 * client.
 */
export function SupplySection({ file }: { file: ClientFile }) {
  const supply = file.supply;

  if (supply === null || !supply.available) {
    return (
      <Panel title="Approvisionnement" sub="Ruptures, seuils franchis, hausses de prix">
        <Unavailable
          icon="tag"
          title="Stock indisponible"
          hint={
            supply === null
              ? "La route /crm/tenants/:id/health n'a pas répondu — ne dites pas au gérant que son stock est bon."
              : "Le contexte appro n'a pas répondu : la fiche est servie sans le volet stocks — ne dites pas au gérant que son stock est bon."
          }
        />
      </Panel>
    );
  }

  const rows: SupplyRow[] = [];
  if (supply.ruptures > 0) {
    rows.push({
      key: "ruptures",
      kind: "rupture",
      name: `${int(supply.ruptures)} ingrédient${plural(supply.ruptures)}`,
      detail: "stock épuisé — la carte se ferme produit par produit",
    });
  }
  if (supply.belowPar > 0) {
    rows.push({
      key: "seuil",
      kind: "seuil",
      name: `${int(supply.belowPar)} ingrédient${plural(supply.belowPar)}`,
      detail: "sous le seuil de réappro",
    });
  }
  for (const p of supply.topPriceIncreases) {
    rows.push({
      key: `prix-${p.supplierName}-${p.ingredientName}`,
      kind: "prix",
      name: p.ingredientName,
      detail: `${p.supplierName} · ${fmtEuro(p.previousPriceCents)} → ${fmtEuro(p.packPriceCents)} (+${fmtPct1(p.increasePct)} %)`,
    });
  }
  // L'API ne nomme que le trio de tête : le reste se dit en nombre, pas en
  // silence — sinon la section minimise ce que la fiche santé compte.
  const extraIncreases = supply.priceIncreases30d - supply.topPriceIncreases.length;
  const total = supply.ruptures + supply.belowPar + supply.priceIncreases30d;

  return (
    <Panel
      title="Approvisionnement"
      sub="Ruptures, seuils franchis, hausses de prix"
      actions={
        total > 0 ? (
          <span className="cf-fig text-[13px] font-extrabold text-ink">{total}</span>
        ) : undefined
      }
    >
      {rows.length === 0 ? (
        supply.ingredients === 0 ? (
          /* Pas de registre ≠ stock sain : sans un seul ingrédient suivi,
             « rien à signaler » ne voudrait rien dire. */
          <p className="text-[13px] text-mut">
            Aucun ingrédient suivi — le registre d&apos;appro n&apos;est pas
            monté chez ce client.
          </p>
        ) : (
          <p className="text-[13px] text-mut">
            Aucun ingrédient sous seuil, aucune rupture, aucune hausse relevée
            sur 30 jours — {int(supply.ingredients)} ingrédient
            {plural(supply.ingredients)} suivi{plural(supply.ingredients)}.
          </p>
        )
      ) : (
        <>
          <ul className="flex flex-col gap-1.5">
            {rows.map((a) => (
              <li key={a.key} className="flex items-center gap-2.5 max-md:flex-wrap">
                <span
                  className={cx(
                    "w-[104px] shrink-0 rounded-pill border-[1.5px] px-[9px] py-[3px] text-center text-[10px] font-extrabold uppercase tracking-[0.06em]",
                    SUPPLY_STYLE[a.kind],
                  )}
                >
                  {SUPPLY_ALERT_LABELS[a.kind]}
                </span>
                <span className="min-w-0 shrink-0 truncate text-[13px] font-bold text-ink">
                  {a.name}
                </span>
                {/* Le détail passe SOUS la ligne sur mobile, en entier : tronqué
                    à droite, il perdait précisément le prix qui justifie l'appel. */}
                <span className="min-w-0 flex-1 truncate text-right text-xs text-mut max-md:basis-full max-md:whitespace-normal max-md:text-left">
                  {a.detail}
                </span>
              </li>
            ))}
          </ul>
          {extraIncreases > 0 && (
            <p className="mt-2 text-xs text-mut">
              … et {int(extraIncreases)} autre{plural(extraIncreases)} hausse
              {plural(extraIncreases)} de prix sur 30 jours.
            </p>
          )}
        </>
      )}
    </Panel>
  );
}

// ─────────────────────────────────────────────────────────────
// Signaux ouverts
// ─────────────────────────────────────────────────────────────

/**
 * CE QUI EST OUVERT SUR CE CLIENT, ET CE QU'ON EN DIT.
 *
 * La file de travail (`/sm/signals`) balaie tout le parc ; cette carte n'en
 * garde que ce restaurant, dans le MÊME ordre. C'est la première chose qu'on
 * lit en ouvrant la fiche parce que c'est la raison de l'appel.
 *
 * Trois défauts corrigés ici, tous constatés à l'écran :
 *
 *  · la carte affichait la CLÉ technique de gravité (« critique ») en guise
 *    d'étiquette. On affiche maintenant le libellé français rendu par l'API
 *    (`severityLabel` : « À surveiller ») et la famille en clair
 *    (« Appareil muet ») — la clé sert à grouper, pas à se lire ;
 *  · la CONSIGNE (`action`) n'apparaissait nulle part : c'est pourtant la
 *    phrase à dire au téléphone, et la moitié de la valeur du signal ;
 *  · l'ANCIENNETÉ et le CHIFFRE (`ageDays`, `value`/`unit`) étaient jetés. Un
 *    impayé de douze jours et un impayé du matin ne se disent pas pareil.
 *
 * Couleurs fonctionnelles uniquement — rouge, ambre, gris ; jamais l'accent
 * laiton, qui reste aux actions primaires (DA §3).
 */
export function SignalsSection({ file }: { file: ClientFile }) {
  const signals = [...file.signals].sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.gravity - a.gravity,
  );
  const worst = signals[0]?.severity;

  return (
    <Panel
      title="Signaux ouverts"
      sub={
        signals.length === 0
          ? "Ce que la file de travail retient sur ce client"
          : `${int(signals.length)} raison${signals.length > 1 ? "s" : ""} d'appeler, de la plus urgente à la moins urgente`
      }
      actions={
        <Link
          href="/sm/signals"
          className="text-[13px] font-bold text-accent hover:underline"
        >
          Toute la file
        </Link>
      }
    >
      {signals.length === 0 ? (
        file.offline.has("signals") ? (
          <Unavailable
            icon="bell"
            title="File de signaux indisponible"
            hint="La route /crm/signals n'a pas répondu : impossible de dire si ce client a quelque chose d'ouvert. Le reste de la fiche reste lisible."
          />
        ) : (
          /*
            RIEN À SIGNALER ≠ PANNE. Un vide muet, sur la carte qui porte la
            raison de l'appel, se lit comme un service à l'arrêt. On affirme
            donc, en vert fonctionnel, que la revue a eu lieu et n'a rien
            trouvé.
          */
          <div className="flex items-start gap-2.5 rounded-card border border-ok/35 bg-ok/8 p-3">
            <Icon name="check" size={16} className="mt-px shrink-0 text-okt" />
            <div className="min-w-0">
              <div className="text-[13px] font-bold text-okt">
                Rien à signaler sur ce client
              </div>
              <div className="mt-0.5 text-xs text-mut">
                Ni impayé, ni décrochage, ni appareil muet, ni module dormant. Il
                n&apos;apparaît dans aucune bande de la file de travail — un
                appel ici serait un appel de courtoisie, pas un rattrapage.
              </div>
            </div>
          </div>
        )
      ) : (
        <ul className="flex flex-col gap-2.5">
          {signals.map((s) => (
            <SignalCard key={s.id} signal={s} />
          ))}
        </ul>
      )}

      {signals.length > 0 && worst === "critique" && (
        <p className="mt-3 border-t border-line2 pt-2.5 text-xs text-mut">
          Gravité, ordre et consigne viennent de l&apos;API (
          <span className="cf-fig">/crm/signals</span>) : c&apos;est la même file
          que celle du matin, filtrée sur ce restaurant.
        </p>
      )}
    </Panel>
  );
}

function SignalCard({ signal: s }: { signal: ClientSignal }) {
  const figure = fmtSignalFigure(s);
  const age = fmtSignalAge(s.ageDays);

  return (
    <li
      className={cx(
        "rounded-card border p-3",
        s.severity === "critique"
          ? "border-alert/40 bg-alert/8"
          : "border-white/6 bg-[image:var(--cf-elev-gradient)]",
      )}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        {/* La bande, en toutes lettres et en couleur fonctionnelle. */}
        <span
          className={cx(
            "shrink-0 rounded-pill border-[1.5px] px-[9px] py-[3px] text-[10px] font-extrabold uppercase tracking-[0.06em]",
            SEVERITY_BORDER[s.severity],
          )}
        >
          {s.severityLabel}
        </span>
        <span className="text-[11px] font-extrabold uppercase tracking-[0.06em] text-mut">
          {s.kindLabel}
        </span>
        <span className="flex-1" />
        {figure && (
          <span
            className={cx(
              "cf-fig shrink-0 whitespace-nowrap rounded-pill border-[1.5px] px-2 py-px text-[12px] font-extrabold",
              s.severity === "critique"
                ? "border-alert/60 text-alertt"
                : s.severity === "attention"
                  ? "border-prep/55 text-prept"
                  : "border-white/18 text-mut",
            )}
            title={`${s.value} ${s.unit}`}
          >
            {figure}
          </span>
        )}
        {age && (
          <span
            className="shrink-0 whitespace-nowrap text-[12px] text-mut"
            title={fmtSignalSince(s.since)}
          >
            {age}
          </span>
        )}
      </div>

      <div className="mt-1.5 text-[13.5px] font-bold text-ink">{s.title}</div>
      {s.detail && (
        <p className="mt-0.5 text-[13px] leading-[1.45] text-mut">{s.detail}</p>
      )}

      {/*
        LA PHRASE À DIRE. Détachée par un filet, jamais tronquée : c'est la
        seule ligne de la carte qui se traduit en geste. Elle est rédigée par
        l'API — elle seule connaît le montant de l'ardoise et les jours d'essai
        restants ; en réécrire une seconde ici finirait par la contredire.
      */}
      <p className="mt-2 border-l-2 border-white/15 pl-2.5 text-[13px] font-semibold leading-[1.45] text-ink/90">
        <span className="mr-1.5 text-[11px] font-extrabold uppercase tracking-[0.06em] text-mut">
          À dire
        </span>{" "}
        {s.action}
      </p>
    </li>
  );
}

// ─────────────────────────────────────────────────────────────
// Conseil
// ─────────────────────────────────────────────────────────────

/**
 * LES ARGUMENTS D'APPEL.
 *
 * Une recommandation n'est utile que CHIFFRÉE : le contrat rend UN chiffre
 * (`value` + `unit`) et UNE phrase (`detail`) qui porte déjà la comparaison —
 * « 34 % contre 29 % pour la médiane de 5 restaurants » est rédigé par l'API,
 * qui seule connaît le panel. La carte affiche donc la phrase et met le
 * chiffre en pastille ; elle n'attend plus le `benchmark` ni le gain mensuel
 * que l'API n'a jamais envoyés — c'est ce qui laissait ces lignes vides.
 */
export function AdviceSection({ file }: { file: ClientFile }) {
  const advice = [...file.recommendations].sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity],
  );

  return (
    <Panel
      title="Conseil"
      sub="À dire au téléphone, chiffres en main"
      actions={
        advice.length > 0 ? (
          <span className="cf-fig text-[13px] font-extrabold text-ink">
            {advice.length}
          </span>
        ) : undefined
      }
    >
      {advice.length === 0 ? (
        <Unavailable
          icon="star"
          title="Aucune recommandation"
          hint={
            file.offline.has("insights")
              ? "La route /crm/tenants/:id/insights n'a pas répondu."
              : "Rien à signaler sur ce client : ses ratios sont dans la médiane du réseau."
          }
        />
      ) : (
        <ul className="flex flex-col gap-2.5">
          {advice.map((r) => (
            <AdviceCard key={r.key} advice={r} />
          ))}
        </ul>
      )}
    </Panel>
  );
}

function AdviceCard({ advice: r }: { advice: Recommendation }) {
  const figure = fmtInsightFigure(r);
  return (
    <li className="rounded-card border border-white/6 bg-[image:var(--cf-elev-gradient)] p-3">
      <div className="flex items-start gap-2.5">
        <span
          className={cx(
            "mt-px shrink-0 rounded-pill border-[1.5px] px-[9px] py-[3px] text-[10px] font-extrabold uppercase tracking-[0.06em]",
            SEVERITY_BORDER[r.severity],
          )}
        >
          {r.severity === "critique" ? "Priorité" : r.severity === "attention" ? "À voir" : "Idée"}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-x-2.5 gap-y-1">
            <span className="min-w-0 text-[13.5px] font-bold text-ink">{r.title}</span>
            {/* LE chiffre du conseil, mis en mots depuis `value` + `unit` —
                l'infobulle garde la valeur brute pour vérifier au téléphone. */}
            {figure && (
              <span
                className="cf-fig shrink-0 whitespace-nowrap text-lg font-extrabold text-ink"
                title={`${r.value} ${r.unit}`}
              >
                {figure}
              </span>
            )}
          </div>
          {r.detail && (
            <p className="mt-1 text-[13px] leading-[1.45] text-mut">{r.detail}</p>
          )}
        </div>
      </div>
    </li>
  );
}

// ─────────────────────────────────────────────────────────────
// Notes internes & journal
// ─────────────────────────────────────────────────────────────

/**
 * NOTES HORODATÉES — la mémoire de l'équipe sur ce client.
 *
 * Elles ne vivent pas dans une collection à part : une note EST une ligne du
 * journal d'administration (`tenant.note`). C'est délibéré — ce qu'on a dit au
 * gérant et ce qu'on lui a fait se relisent dans le même fil, dans le même
 * ordre. Rien ne s'y modifie ni ne s'y efface.
 */
export function NotesSection({
  file,
  onSaved,
}: {
  file: ClientFile;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [onlyNotes, setOnlyNotes] = useState(false);

  const entries = onlyNotes
    ? file.journal.filter((e) => e.action === "tenant.note")
    : file.journal;

  async function save() {
    const text = note.trim();
    if (!text || busy) return;
    setBusy(true);
    try {
      await clientsApi.addNote(file.id, text);
      setNote("");
      toast("Note enregistrée", { icon: "check" });
      onSaved();
    } catch {
      toast("Enregistrement impossible — réessayez");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel
      title="Notes internes & journal"
      sub="Ce qu'on a dit, ce qu'on a fait — append-only"
      actions={
        <button
          type="button"
          aria-pressed={onlyNotes}
          onClick={() => setOnlyNotes((v) => !v)}
          className={cx(
            "cf-press rounded-pill border px-3 py-1.5 text-[12px] font-bold",
            onlyNotes
              ? "border-white/55 bg-white/12 text-white"
              : "border-transparent bg-white/6 text-mut hover:bg-white/10 hover:text-white",
          )}
        >
          Notes seules
        </button>
      }
    >
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Input
          aria-label="Nouvelle note interne"
          className="min-w-0 flex-1"
          placeholder="Rappelé le gérant — attend la livraison de sa 2e tablette."
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <Btn
          type="submit"
          variant="ink"
          size="sm"
          icon="plus"
          className="max-md:min-h-11"
          disabled={!note.trim() || busy}
        >
          {busy ? "…" : "Noter"}
        </Btn>
      </form>

      {entries.length === 0 ? (
        <p className="mt-3.5 text-[13px] text-mut">
          {file.offline.has("journal")
            ? "Journal indisponible — la route /crm/tenants/:id/logs n'a pas répondu."
            : onlyNotes
              ? "Aucune note sur ce client. La première se tape ci-dessus."
              : "Aucun geste tracé sur ce client."}
        </p>
      ) : (
        <ol className="mt-3.5 flex flex-col">
          {entries.map((e, i) => (
            <JournalRow key={e._id ?? i} entry={e} first={i === 0} last={i === entries.length - 1} />
          ))}
        </ol>
      )}
    </Panel>
  );
}

/** Les gestes qui ferment une porte se relisent en rouge, des mois plus tard. */
const HEAVY_ACTIONS = new Set(["tenant.suspend", "device.revoke", "screen.revoke"]);

function JournalRow({
  entry: e,
  first,
  last,
}: {
  entry: AdminLogEntry;
  first: boolean;
  last: boolean;
}) {
  const isNote = e.action === "tenant.note";
  const heavy = HEAVY_ACTIONS.has(e.action);
  return (
    <li className="flex gap-3">
      <div className="flex flex-col items-center">
        <span
          className={cx(
            "mt-[6px] size-2 shrink-0 rounded-full",
            heavy ? "bg-alert" : first ? "bg-accent" : "bg-white/25",
          )}
          aria-hidden
        />
        {!last && <span className="w-px flex-1 bg-white/10" aria-hidden />}
      </div>
      <div className="min-w-0 flex-1 pb-3.5">
        <div className="flex items-baseline justify-between gap-2">
          <span
            className={cx(
              "text-[13px] font-bold",
              heavy ? "text-alertt" : isNote ? "text-ink" : "text-mut",
            )}
          >
            {isNote
              ? "Note interne"
              : (e.actionLabel ?? ADMIN_LOG_ACTION_LABELS[e.action] ?? e.action)}
          </span>
          <span className="shrink-0 text-xs text-mut" title={fmtDay(e.at)}>
            {timeAgo(e.at)}
          </span>
        </div>
        {e.reason && (
          <p className="mt-0.5 text-[13px] leading-[1.45] text-ink/90">{e.reason}</p>
        )}
        {e.actor?.email && (
          <p className="mt-0.5 text-xs text-mut">{e.actor.email}</p>
        )}
      </div>
    </li>
  );
}
