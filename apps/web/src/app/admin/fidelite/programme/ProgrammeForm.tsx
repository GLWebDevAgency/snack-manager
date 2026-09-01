"use client";

import { useMemo, useState, type FormEvent } from "react";
import {
  LoyaltyProgramPutSchema,
  type LoyaltyMechanism,
  type LoyaltyProgramPut,
  type LoyaltyProgramStatus,
  type LoyaltyProgramView,
} from "@sm/contracts";
import { Btn, Card, Field, Icon, Input, Panel, Pill, Select, Textarea, useToast } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { centsToInput, parseEuroInput, parsePositiveInteger } from "../form-utils";
import { loyaltyApi } from "../data";

type Draft = {
  name: string;
  status: LoyaltyProgramStatus;
  mechanism: LoyaltyMechanism;
  minimumPurchase: string;
  maximumUnits: string;
  spendStep: string;
  unitsPerStep: string;
  unitsPerVisit: string;
  unitLabelSingular: string;
  unitLabelPlural: string;
  termsSummary: string;
};

function draftFrom(program: LoyaltyProgramView | null): Draft {
  if (!program) {
    return {
      name: "La carte Classfood",
      status: "draft",
      mechanism: "points",
      minimumPurchase: "0,00",
      maximumUnits: "",
      spendStep: "1,00",
      unitsPerStep: "1",
      unitsPerVisit: "1",
      unitLabelSingular: "point",
      unitLabelPlural: "points",
      termsSummary: "Points attribués sur les achats éligibles. Avantages non échangeables contre de l'argent.",
    };
  }
  return {
    name: program.name,
    status: program.status,
    mechanism: program.earn.mechanism,
    minimumPurchase: centsToInput(program.earn.minimumPurchaseCents),
    maximumUnits: program.earn.maximumUnitsPerPurchase === null ? "" : String(program.earn.maximumUnitsPerPurchase),
    spendStep: program.earn.mechanism === "points" ? centsToInput(program.earn.spendStepCents) : "1,00",
    unitsPerStep: program.earn.mechanism === "points" ? String(program.earn.unitsPerStep) : "1",
    unitsPerVisit: program.earn.mechanism === "stamps" ? String(program.earn.unitsPerVisit) : "1",
    unitLabelSingular: program.unitLabelSingular,
    unitLabelPlural: program.unitLabelPlural,
    termsSummary: program.termsSummary,
  };
}

function buildProgram(draft: Draft): { body?: LoyaltyProgramPut; error?: string } {
  const minimumPurchaseCents = parseEuroInput(draft.minimumPurchase, { allowZero: true });
  if (minimumPurchaseCents === null) {
    return { error: "Le minimum d'achat doit être un montant valide, avec deux décimales maximum." };
  }
  const maximumUnitsPerPurchase = draft.maximumUnits.trim()
    ? parsePositiveInteger(draft.maximumUnits)
    : null;
  if (draft.maximumUnits.trim() && maximumUnitsPerPurchase === null) {
    return { error: "Le plafond doit être un nombre entier positif, ou rester vide." };
  }

  let earn: LoyaltyProgramPut["earn"];
  if (draft.mechanism === "points") {
    const spendStepCents = parseEuroInput(draft.spendStep);
    const unitsPerStep = parsePositiveInteger(draft.unitsPerStep);
    if (spendStepCents === null) return { error: "Indiquez un palier de dépense valide." };
    if (unitsPerStep === null) return { error: "Indiquez le nombre entier de points gagnés par palier." };
    earn = { mechanism: "points", minimumPurchaseCents, maximumUnitsPerPurchase, spendStepCents, unitsPerStep };
  } else {
    const unitsPerVisit = parsePositiveInteger(draft.unitsPerVisit);
    if (unitsPerVisit === null) return { error: "Indiquez le nombre entier de tampons gagnés par visite." };
    earn = { mechanism: "stamps", minimumPurchaseCents, maximumUnitsPerPurchase, unitsPerVisit };
  }

  const parsed = LoyaltyProgramPutSchema.safeParse({
    name: draft.name,
    status: draft.status,
    earn,
    unitLabelSingular: draft.unitLabelSingular,
    unitLabelPlural: draft.unitLabelPlural,
    termsSummary: draft.termsSummary,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Vérifiez les informations du programme." };
  }
  return { body: parsed.data };
}

export function ProgrammeForm({ initial }: { initial: LoyaltyProgramView | null }) {
  const toast = useToast();
  const [program, setProgram] = useState(initial);
  const [draft, setDraft] = useState(() => draftFrom(initial));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const preview = useMemo(() => {
    if (draft.mechanism === "points") {
      return `${draft.unitsPerStep || "—"} ${draft.unitLabelPlural || "points"} tous les ${draft.spendStep || "—"} € dépensés`;
    }
    return `${draft.unitsPerVisit || "—"} ${draft.unitLabelPlural || "tampons"} par visite éligible`;
  }, [draft]);

  function patch<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    const built = buildProgram(draft);
    if (!built.body) {
      setError(built.error ?? "Vérifiez le formulaire.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const updated = await loyaltyApi.updateProgram(built.body);
      setProgram(updated);
      setDraft(draftFrom(updated));
      toast(program ? "Programme mis à jour" : "Programme créé", { icon: "check" });
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Enregistrement impossible — réessayez.");
    } finally {
      setSaving(false);
    }
  }

  const mechanismChanged = Boolean(program && program.earn.mechanism !== draft.mechanism);

  return (
    <form onSubmit={submit} className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(300px,.7fr)]">
      <div className="flex min-w-0 flex-col gap-4">
        <Panel title="Identité du programme" sub="Ce que vos clients verront sur leur carte">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,1fr)_190px]">
            <Field label="Nom du programme" htmlFor="loyalty-name">
              <Input id="loyalty-name" value={draft.name} maxLength={80} onChange={(e) => patch("name", e.target.value)} />
            </Field>
            <Field label="Publication" htmlFor="loyalty-status">
              <Select id="loyalty-status" value={draft.status} onChange={(e) => patch("status", e.target.value as LoyaltyProgramStatus)}>
                <option value="draft">Brouillon</option>
                <option value="active">Actif</option>
                <option value="paused">En pause</option>
              </Select>
            </Field>
          </div>
        </Panel>

        <Panel title="Mécanique de gain" sub="Un seul système, immédiatement compréhensible au comptoir">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {([
              { key: "points", title: "Points", hint: "Proportionnels au montant dépensé", icon: "star" as const },
              { key: "stamps", title: "Tampons", hint: "Un rythme simple par visite", icon: "check" as const },
            ] as const).map((choice) => {
              const selected = draft.mechanism === choice.key;
              return (
                <button
                  key={choice.key}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => patch("mechanism", choice.key)}
                  className={selected
                    ? "cf-press flex items-start gap-3 rounded-card border border-accent bg-accent/10 p-4 text-left shadow-[var(--cf-shadow-accent)]"
                    : "cf-press flex items-start gap-3 rounded-card border border-white/8 bg-[image:var(--cf-elev-gradient)] p-4 text-left hover:border-white/20"}
                >
                  <span className={selected ? "grid size-9 place-items-center rounded-card bg-accent text-onaccent" : "grid size-9 place-items-center rounded-card bg-white/8 text-mut"}>
                    <Icon name={choice.icon} size={18} />
                  </span>
                  <span>
                    <span className="block text-sm font-extrabold text-ink">{choice.title}</span>
                    <span className="mt-0.5 block text-xs leading-5 text-mut">{choice.hint}</span>
                  </span>
                </button>
              );
            })}
          </div>

          {mechanismChanged && (
            <div className="mt-4 rounded-card border border-prep/35 bg-prep/10 p-3 text-xs leading-5 text-prept">
              Le nouveau mécanisme s’appliquera aux prochains achats. L’historique et les soldes déjà acquis restent inchangés.
            </div>
          )}

          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            {draft.mechanism === "points" ? (
              <>
                <Field label="Tous les… (€)" htmlFor="loyalty-step" hint="Ex. 1,00 € dépensé">
                  <Input id="loyalty-step" inputMode="decimal" value={draft.spendStep} onChange={(e) => patch("spendStep", e.target.value)} />
                </Field>
                <Field label="Points gagnés" htmlFor="loyalty-units-step" hint="Pour chaque palier complet">
                  <Input id="loyalty-units-step" inputMode="numeric" value={draft.unitsPerStep} onChange={(e) => patch("unitsPerStep", e.target.value)} />
                </Field>
              </>
            ) : (
              <Field label="Tampons par visite" htmlFor="loyalty-units-visit" hint="Le plus souvent : 1">
                <Input id="loyalty-units-visit" inputMode="numeric" value={draft.unitsPerVisit} onChange={(e) => patch("unitsPerVisit", e.target.value)} />
              </Field>
            )}
            <Field label="Achat minimum (€)" htmlFor="loyalty-minimum" hint="0,00 pour aucun minimum">
              <Input id="loyalty-minimum" inputMode="decimal" value={draft.minimumPurchase} onChange={(e) => patch("minimumPurchase", e.target.value)} />
            </Field>
            <Field label={`Plafond de ${draft.unitLabelPlural || "unités"} par achat`} htmlFor="loyalty-maximum" hint="Vide = sans plafond">
              <Input id="loyalty-maximum" inputMode="numeric" value={draft.maximumUnits} onChange={(e) => patch("maximumUnits", e.target.value)} />
            </Field>
          </div>
        </Panel>

        <Panel title="Vocabulaire & conditions" sub="Des termes courts et sans ambiguïté pour le client">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Unité au singulier" htmlFor="loyalty-unit-one">
              <Input id="loyalty-unit-one" value={draft.unitLabelSingular} maxLength={24} onChange={(e) => patch("unitLabelSingular", e.target.value)} />
            </Field>
            <Field label="Unité au pluriel" htmlFor="loyalty-unit-many">
              <Input id="loyalty-unit-many" value={draft.unitLabelPlural} maxLength={24} onChange={(e) => patch("unitLabelPlural", e.target.value)} />
            </Field>
          </div>
          <Field className="mt-4" label="Résumé des conditions" htmlFor="loyalty-terms" hint={`${draft.termsSummary.length}/1000 caractères`}>
            <Textarea id="loyalty-terms" maxLength={1000} value={draft.termsSummary} onChange={(e) => patch("termsSummary", e.target.value)} />
          </Field>
        </Panel>
      </div>

      <aside className="min-w-0 xl:sticky xl:top-4 xl:self-start">
        <Card className="overflow-hidden border-accent/20">
          <div className="border-b border-line2 bg-accent/8 p-[18px]">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-accent">Aperçu client</p>
                <h2 className="mt-2 text-xl font-extrabold tracking-[-0.035em] text-ink">{draft.name || "Votre programme"}</h2>
              </div>
              <Pill>{draft.mechanism === "points" ? "Points" : "Tampons"}</Pill>
            </div>
          </div>
          <div className="p-[18px]">
            <p className="text-sm font-bold leading-6 text-ink">{preview}</p>
            <p className="mt-2 text-xs leading-5 text-mut">
              {draft.minimumPurchase === "0" || draft.minimumPurchase === "0,00"
                ? "Valable dès le premier euro."
                : `À partir de ${draft.minimumPurchase || "—"} € d’achat.`}
            </p>
            <div className="mt-5 h-2 overflow-hidden rounded-pill bg-white/8" aria-hidden>
              <div className="h-full w-[62%] rounded-pill bg-accent" />
            </div>
            <p className="mt-2 text-[11px] text-mut">L’aperçu final affichera le vrai solde du client.</p>
          </div>
        </Card>

        {error && <p className="mt-3 rounded-card border border-alert/35 bg-alert/10 p-3 text-xs text-alertt" role="alert">{error}</p>}
        <Btn type="submit" block className="mt-4" disabled={saving} icon="check">
          {saving ? "Enregistrement…" : program ? "Enregistrer les règles" : "Créer le programme"}
        </Btn>
        {program && <p className="mt-2 text-center text-[11px] text-mut">Version publiée {program.rulesVersion} · chaque modification crée une nouvelle version auditable.</p>}
      </aside>
    </form>
  );
}
