"use client";

/**
 * FACTURER LE MOIS — le geste qui n'existait nulle part.
 *
 * `POST /crm/tenants/:id/invoices` était écrit et testé ; rien ne l'appelait,
 * et aucun planificateur n'émettait l'abonnement du mois suivant. La file de
 * recouvrement pouvait donc rester vide non parce que le parc était à jour,
 * mais parce que rien n'avait jamais été facturé — le plus silencieux des
 * défauts, puisqu'il ressemble à une bonne nouvelle.
 *
 * ── Un geste demandé, pas un automate ─────────────────────────────────────
 *
 * Un cron qui émet des créances tout seul se découvre le jour où il a facturé
 * un client parti, ou facturé deux fois après un redémarrage. À l'échelle d'un
 * parc qui se compte en dizaines, une revue mensuelle de trente secondes vaut
 * mieux qu'un automate à surveiller. Le jour où le parc l'exigera, la passe est
 * déjà idempotente : un planificateur pourra l'appeler sans rien changer.
 *
 * ── Le brouillon d'abord ──────────────────────────────────────────────────
 *
 * Le mode brouillon est proposé EN PREMIER et coché par défaut : il pose les
 * pièces sans créer de créance, ce qui laisse relire avant d'envoyer. Émettre
 * directement reste possible — c'est un clic de plus, délibérément.
 */

import { useState } from "react";
import {
  BILLING_RUN_SKIP_LABELS,
  type BillingRunReport,
  type BillingRunSkip,
} from "@sm/contracts";
import { Btn, Card, Field, Icon, Input, Toggle, useToast } from "@/components/ui";
import { billingApi } from "./data";

/** Le mois courant en `AAAA-MM` — ce que l'API attend et ce qu'un `<input type="month">` rend. */
function moisCourant(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function RunMensuel({ onDone }: { onDone: () => void }) {
  const toast = useToast();
  const [period, setPeriod] = useState(moisCourant());
  const [draft, setDraft] = useState(true);
  const [busy, setBusy] = useState(false);
  const [rapport, setRapport] = useState<BillingRunReport | null>(null);

  async function run() {
    if (busy) return;
    setBusy(true);
    try {
      const r = (await billingApi.runMensuel({ period, draft })) as BillingRunReport;
      setRapport(r);
      toast(
        r.emises.length === 0
          ? "Rien à facturer — tout est déjà passé"
          : `${r.emises.length} ${draft ? "brouillon" : "facture"}${r.emises.length > 1 ? "s" : ""} · ${r.totalLabel}`,
        { icon: "check" },
      );
      onDone();
    } catch (e) {
      toast(
        e instanceof Error && e.message
          ? e.message
          : "La passe a échoué — aucune facture n’a été posée. Réessayez.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold text-ink">Facturer le mois</div>
          <p className="mt-1 max-w-[60ch] text-[13px] text-mut">
            Pose une pièce d&apos;abonnement pour chaque client facturable, au
            montant de son offre — module, services et remise fondateur
            compris. Relancer la passe ne double rien.
          </p>
        </div>
        <Field label="Mois" htmlFor="run-period" className="w-[170px]">
          <Input
            id="run-period"
            type="month"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
          />
        </Field>
        <div className="flex items-center gap-2 pb-1">
          <span className="text-xs text-mut">Brouillon</span>
          <Toggle on={draft} label="Poser en brouillon" onChange={setDraft} />
        </div>
        <Btn
          variant="primary"
          size="sm"
          icon="euro"
          disabled={busy}
          onClick={() => void run()}
          className="mb-1"
        >
          {busy ? "En cours…" : draft ? "Poser les brouillons" : "Émettre les factures"}
        </Btn>
      </div>

      {draft && (
        <p className="mt-2 text-[12px] text-mut">
          En brouillon, rien n&apos;est dû : les pièces attendent d&apos;être
          envoyées une à une depuis la fiche du client.
        </p>
      )}

      {rapport && <Rapport rapport={rapport} />}
    </Card>
  );
}

/**
 * Le compte rendu dit aussi ce qui n'a PAS été fait. Un geste de masse qui ne
 * rendrait qu'un nombre laisserait l'équipe deviner pourquoi trois clients
 * manquent à l'appel — et deviner, ici, c'est se tromper.
 */
function Rapport({ rapport }: { rapport: BillingRunReport }) {
  const parRaison = new Map<BillingRunSkip, typeof rapport.ignores>();
  for (const i of rapport.ignores) {
    parRaison.set(i.raison, [...(parRaison.get(i.raison) ?? []), i]);
  }

  return (
    <div className="mt-4 flex flex-col gap-3 border-t border-white/6 pt-4">
      <div className="flex items-center gap-2 text-[13px]">
        <Icon name="check" size={16} className="shrink-0 text-okt" />
        <span className="text-ink">
          <span className="cf-fig font-extrabold">{rapport.emises.length}</span>{" "}
          {rapport.draft ? "brouillon" : "facture"}
          {rapport.emises.length > 1 ? "s" : ""} · {rapport.period.label} ·{" "}
          <span className="cf-fig font-extrabold">{rapport.totalLabel}</span>
        </span>
      </div>

      {rapport.emises.length > 0 && (
        <ul className="flex flex-col gap-1 text-[13px]">
          {rapport.emises.map((e) => (
            <li key={e.tenantId} className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate text-ink">{e.name}</span>
              <span className="cf-fig shrink-0 text-mut">
                {e.number} · {e.amountLabel}
              </span>
            </li>
          ))}
        </ul>
      )}

      {[...parRaison].map(([raison, clients]) => (
        <div key={raison} className="text-[13px]">
          <div className="text-mut">
            {BILLING_RUN_SKIP_LABELS[raison]} —{" "}
            <span className="text-ink">{clients.map((c) => c.name).join(", ")}</span>
          </div>
        </div>
      ))}

      {rapport.emises.length === 0 && rapport.ignores.length === 0 && (
        <p className="text-[13px] text-mut">
          Aucun client au parc — rien à facturer.
        </p>
      )}

      <p className="text-[12px] text-mut">
        Chaque pièce est journalisée avec son émetteur : la passe se retrouve
        dans le dossier de chaque client.
      </p>
    </div>
  );
}
