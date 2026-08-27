"use client";

/**
 * LES COÛTS HORAIRES — la saisie qui n'existait nulle part.
 *
 * `PUT /planning/staff-costs/:staffId` était écrite, gardée par `PayrollGuard`,
 * et n'avait AUCUN appelant. Le planning promettait pourtant un « coût
 * projeté » et une confrontation prévu/pointé en euros : tous ces montants
 * valaient « — » à vie, et l'écran disait même « il manque des coûts » sans
 * offrir le moindre chemin pour les renseigner.
 *
 * ── Des données personnelles, traitées comme telles ────────────────────────
 *
 * Un taux horaire est une donnée de paie. Le garde côté API le réserve déjà au
 * propriétaire ; cet écran ne s'ouvre donc que si la session a pu lire
 * `GET /planning/staff-costs`. Un gérant au PIN ne le voit pas, et c'est
 * volontaire : il fait le planning, il ne fait pas les salaires.
 *
 * ── Le brut chargé, pas le salaire ────────────────────────────────────────
 *
 * Le libellé dit « coût employeur » et non « salaire » : c'est ce chiffre-là
 * qui rend la marge juste. Saisir un net donnerait un coût de main-d'œuvre
 * sous-évalué d'environ un tiers, et une marge qu'on croirait bonne.
 */

import { useState } from "react";
import { Btn, Field, Input, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import { SheetModal } from "../../sm/mobile";
import type { StaffCosts } from "./data";

/** Centimes → « 14,50 » pour l'affichage dans un champ. */
const enEuros = (cents: number | null): string =>
  cents == null ? "" : (cents / 100).toFixed(2).replace(".", ",");

/** « 14,50 » ou « 14.5 » → 1450. `null` si le champ est vide ou illisible. */
function enCentimes(saisie: string): number | null {
  const net = saisie.trim().replace(",", ".");
  if (net === "") return null;
  const n = Number(net);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

export function CoutsHorairesModal({
  costs,
  onClose,
  onDone,
}: {
  costs: StaffCosts;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [valeurs, setValeurs] = useState<Record<string, string>>(() =>
    Object.fromEntries(costs.members.map((m) => [m.id, enEuros(m.hourlyCostCents)])),
  );
  const [busy, setBusy] = useState(false);

  // Ce qui a bougé, et lui seul : renvoyer les taux inchangés écrirait des
  // lignes de journal pour rien, et ferait croire à une modification de paie.
  const modifies = costs.members.filter(
    (m) => enCentimes(valeurs[m.id] ?? "") !== m.hourlyCostCents,
  );
  const invalides = costs.members.filter((m) => {
    const brut = (valeurs[m.id] ?? "").trim();
    return brut !== "" && enCentimes(brut) === null;
  });

  async function enregistrer() {
    if (busy || modifies.length === 0 || invalides.length > 0) return;
    setBusy(true);
    try {
      // En série et non en parallèle : ce sont des écritures de paie, et une
      // erreur au milieu doit laisser un état lisible plutôt qu'un panachage
      // dont on ne sait plus ce qui est passé.
      for (const m of modifies) {
        await api.put(`/planning/staff-costs/${m.id}`, {
          hourlyCostCents: enCentimes(valeurs[m.id] ?? ""),
        });
      }
      toast(
        modifies.length === 1
          ? `Coût horaire de ${modifies[0]!.name} enregistré`
          : `${modifies.length} coûts horaires enregistrés`,
        { icon: "check" },
      );
      onDone();
      onClose();
    } catch (e) {
      toast(
        e instanceof Error && e.message
          ? e.message
          : "Enregistrement impossible — vérifiez les montants et réessayez.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <SheetModal
      open
      onClose={onClose}
      title="Coûts horaires de l’équipe"
      footer={
        <>
          <Btn variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            Annuler
          </Btn>
          <Btn
            variant="primary"
            size="sm"
            icon="check"
            disabled={busy || modifies.length === 0 || invalides.length > 0}
            onClick={() => void enregistrer()}
          >
            {busy
              ? "Enregistrement…"
              : modifies.length === 0
                ? "Aucun changement"
                : `Enregistrer (${modifies.length})`}
          </Btn>
        </>
      }
    >
      <p className="text-[13px] text-mut">
        Le <strong className="text-ink">coût employeur</strong> par heure —
        charges comprises, pas le salaire net. C&apos;est lui qui rend le coût
        de main-d&apos;œuvre du planning et la marge des produits justes ; un
        net donnerait un coût sous-évalué d&apos;environ un tiers.
      </p>
      <p className="mt-2 text-[12px] text-mut">
        Donnée de paie : visible du propriétaire seul, jamais des tablettes.
      </p>

      <div className="mt-4 flex flex-col gap-3">
        {costs.members.map((m) => {
          const brut = (valeurs[m.id] ?? "").trim();
          const invalide = brut !== "" && enCentimes(brut) === null;
          return (
            <Field
              key={m.id}
              label={`${m.name} — ${m.role}`}
              htmlFor={`cout-${m.id}`}
              hint={invalide ? "Montant illisible — un nombre, par exemple 14,50" : undefined}
            >
              <div className="flex items-center gap-2">
                <Input
                  id={`cout-${m.id}`}
                  inputMode="decimal"
                  placeholder="14,50"
                  value={valeurs[m.id] ?? ""}
                  onChange={(e) => setValeurs((v) => ({ ...v, [m.id]: e.target.value }))}
                  aria-invalid={invalide || undefined}
                />
                <span className="shrink-0 text-[13px] text-mut">€ / h</span>
              </div>
            </Field>
          );
        })}
      </div>

      {costs.members.length === 0 && (
        <p className="mt-4 text-[13px] text-mut">
          Aucun équipier déclaré — ajoutez votre équipe avant de saisir ses
          coûts.
        </p>
      )}
    </SheetModal>
  );
}
