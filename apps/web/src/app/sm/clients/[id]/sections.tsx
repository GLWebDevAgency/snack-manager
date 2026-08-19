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
  fmtSince,
  scoreHealth,
  HEALTH_TEXT,
  SEVERITY_BORDER,
  SEVERITY_RANK,
  SUPPLY_ALERT_LABELS,
  trend,
  type ClientFile,
  type Comparison,
  type HealthComponent,
  type ModuleAdoption,
  type ParkDevice,
  type Recommendation,
  type SupplyAlert,
  type TenantActivity,
} from "../data";
import { ActivityBars, Eyebrow, Meter, ScorePill, Trend, Unavailable } from "../ui";

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
        <div className="flex items-start gap-4">
          {/* ── Le chiffre ── */}
          <div className="flex w-[124px] shrink-0 flex-col items-center gap-1 rounded-card border border-white/6 bg-[image:var(--cf-elev-gradient)] p-3.5">
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
  const tone = scoreHealth(c.score) ?? "attention";
  return (
    <li>
      <div className="flex items-baseline justify-between gap-2">
        <span className="min-w-0 truncate text-[13px] font-bold text-ink">
          {c.label}
          {c.weight !== null && (
            <span className="ml-1.5 cf-fig text-[11px] font-semibold text-mut">
              {c.weight} %
            </span>
          )}
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

/** L'activité comparée à la période précédente — trois chiffres et une courbe. */
function ActivityBlock({ activity }: { activity: TenantActivity }) {
  return (
    <div className="mt-4 border-t border-line pt-4">
      <Eyebrow>Activité sur {activity.days} jours, comparée aux {activity.days} précédents</Eyebrow>
      <div className="mt-2.5 flex items-stretch gap-3">
        <Compare label="Commandes" value={activity.orders} format={(n) => int(n)} />
        <Compare
          label="Chiffre d'affaires"
          value={activity.revenueCents}
          format={euroRound}
        />
        {activity.ticketCents && (
          <Compare
            label="Panier moyen"
            value={activity.ticketCents}
            format={(n) => fmtEuro(n)}
          />
        )}
      </div>
      {activity.series.length > 0 && (
        <div className="mt-3.5">
          <ActivityBars
            points={activity.series}
            label={`Activité sur ${activity.days} jours ; le trait pointillé marque la période précédente`}
          />
          <p className="mt-2 text-xs text-mut">
            Le trait pointillé marque la même journée de la période précédente.
          </p>
        </div>
      )}
    </div>
  );
}

function Compare({
  label,
  value,
  format,
}: {
  label: string;
  value: Comparison;
  format: (n: number) => string;
}) {
  const pct = trend(value.current, value.previous);
  return (
    <div className="min-w-0 flex-1 rounded-card border border-white/6 bg-[image:var(--cf-elev-gradient)] p-3">
      <div className="truncate text-[11px] font-semibold uppercase tracking-[0.06em] text-mut">
        {label}
      </div>
      <div className="cf-fig mt-1 text-xl font-extrabold text-ink">
        {format(value.current)}
      </div>
      <div className="mt-0.5 flex items-baseline gap-1.5">
        <Trend pct={pct} />
        {value.previous !== null && (
          <span className="cf-fig truncate text-[11px] text-mut">
            contre {format(value.previous)}
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
 * CE QU'IL PAIE SANS S'EN SERVIR — le sujet d'appel le plus utile.
 *
 * Ces modules-là remontent EN TÊTE et portent la seule couleur de la section :
 * un client qui paie la fidélité sans l'avoir jamais activée est soit un client
 * à former, soit un client qui résiliera. Les deux se règlent par un appel, et
 * cet appel commence ici.
 */
export function AdoptionSection({ file }: { file: ClientFile }) {
  const modules = [...file.modules].sort((a, b) => {
    const wasted = (m: ModuleAdoption) => (m.included && !m.used ? 0 : m.used ? 1 : 2);
    return wasted(a) - wasted(b) || a.label.localeCompare(b.label, "fr");
  });
  const unused = modules.filter((m) => m.included && !m.used);

  return (
    <Panel
      title="Adoption des modules"
      sub={
        modules.length === 0
          ? "Ce qu'il utilise, ce qu'il paie sans s'en servir"
          : `${modules.filter((m) => m.used).length} module${modules.filter((m) => m.used).length > 1 ? "s" : ""} utilisé${modules.filter((m) => m.used).length > 1 ? "s" : ""} sur ${modules.length}`
      }
      actions={
        unused.length > 0 ? (
          <span className="rounded-pill border-[1.5px] border-prep/55 px-[9px] py-[3px] text-[10px] font-extrabold uppercase tracking-[0.06em] text-prept">
            {unused.length} payé{unused.length > 1 ? "s" : ""} non utilisé
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
            file.offline.has("health") && file.offline.has("insights")
              ? "Ni /health ni /insights n'ont répondu : impossible de dire ce que ce client utilise."
              : "L'API n'a pas encore renvoyé le détail d'usage des modules."
          }
        />
      ) : (
        <ul className="grid grid-cols-2 gap-2.5">
          {modules.map((m) => (
            <ModuleTile key={m.key} module={m} />
          ))}
        </ul>
      )}
    </Panel>
  );
}

function ModuleTile({ module: m }: { module: ModuleAdoption }) {
  const wasted = m.included && !m.used;
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
            {m.used
              ? m.usage !== null
                ? `${int(m.usage)} sur la période`
                : "Utilisé"
              : wasted
                ? "Facturé, jamais utilisé"
                : "Hors formule"}
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
        </div>
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
        className="shrink-0 border-alert/40 text-alertt hover:border-alert hover:bg-alert/12"
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

const SUPPLY_STYLE: Record<SupplyAlert["kind"], string> = {
  rupture: "border-alert/60 text-alertt",
  seuil: "border-prep/55 text-prept",
  prix: "border-white/20 text-mut",
};

/** Ce qui va manquer, ce qui manque déjà, ce qui coûte plus cher qu'avant. */
export function SupplySection({ file }: { file: ClientFile }) {
  const order: SupplyAlert["kind"][] = ["rupture", "seuil", "prix"];
  const alerts = [...file.supply].sort(
    (a, b) => order.indexOf(a.kind) - order.indexOf(b.kind),
  );

  return (
    <Panel
      title="Approvisionnement"
      sub="Ruptures, seuils franchis, hausses de prix"
      actions={
        alerts.length > 0 ? (
          <span className="cf-fig text-[13px] font-extrabold text-ink">
            {alerts.length}
          </span>
        ) : undefined
      }
    >
      {alerts.length === 0 ? (
        file.offline.has("insights") ? (
          <Unavailable
            icon="tag"
            title="Stock indisponible"
            hint="La route /crm/tenants/:id/insights n'a pas répondu — ne dites pas au gérant que son stock est bon."
          />
        ) : (
          <p className="text-[13px] text-mut">
            Aucun ingrédient sous seuil, aucune rupture, aucune hausse relevée.
          </p>
        )
      ) : (
        <ul className="flex flex-col gap-1.5">
          {alerts.map((a) => (
            <li key={a.key} className="flex items-center gap-2.5">
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
              <span className="min-w-0 flex-1 truncate text-right text-xs text-mut">
                {a.detail}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

// ─────────────────────────────────────────────────────────────
// Conseil
// ─────────────────────────────────────────────────────────────

/**
 * LES ARGUMENTS D'APPEL.
 *
 * Une recommandation n'est utile que CHIFFRÉE et COMPARÉE : « son food cost
 * tacos est à 35 % contre 28 % de médiane réseau » se dit au téléphone, « son
 * food cost est élevé » ne se dit pas. La valeur du client et la référence
 * réseau sont donc mises côte à côte, et le gain mensuel estimé — quand l'API
 * le calcule — ferme l'argument.
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
          <div className="text-[13.5px] font-bold text-ink">{r.title}</div>
          {r.detail && (
            <p className="mt-1 text-[13px] leading-[1.45] text-mut">{r.detail}</p>
          )}
          {(r.value || r.benchmark) && (
            <div className="mt-2 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
              {r.value && (
                <span className="cf-fig text-lg font-extrabold text-ink">{r.value}</span>
              )}
              {r.benchmark && (
                <span className="text-[13px] text-mut">
                  contre{" "}
                  <span className="cf-fig font-bold text-ink">{r.benchmark}</span>{" "}
                  de médiane réseau
                </span>
              )}
            </div>
          )}
          {r.gainCentsPerMonth !== null && r.gainCentsPerMonth > 0 && (
            <div className="cf-fig mt-1.5 text-[13px] font-extrabold text-accent">
              ≈ {euroRound(r.gainCentsPerMonth)} par mois à la clé
            </div>
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
