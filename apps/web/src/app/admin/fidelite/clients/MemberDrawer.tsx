"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import type {
  LoyaltyConsentPurpose,
  LoyaltyMemberDetail,
  LoyaltyMemberLifecycle,
  LoyaltyMemberQrReplace,
  LoyaltyMemberSummary,
  LoyaltyMutationResult,
  LoyaltyProgramView,
  LoyaltyRewardView,
} from "@sm/contracts";
import { Btn, Card, Drawer, EmptyState, Field, Icon, Input, Modal, Pill, Select, Skeleton, useToast } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import { loyaltyApi, newLoyaltyOperationId } from "../data";
import { parsePositiveInteger } from "../form-utils";
import { LOYALTY_SMS_NOTICE_VERSION } from "../legal";
import { QrHandoff } from "./QrHandoff";
import { canWithdrawHistoricalSmsConsent } from "./consent-policy";
import { mustConfirmQrHandoffClose } from "./qr-handoff-policy";

type Tab = "history" | "operations" | "privacy";
type CardManagementAction = "block" | "unblock" | "anonymize" | "replaceQr";
type ManagementReasonCode = LoyaltyMemberLifecycle["reasonCode"] | LoyaltyMemberQrReplace["reasonCode"];

const MANAGEMENT_REASON_OPTIONS = {
  block: [
    ["suspected_sharing", "Suspicion de partage"],
    ["lost_or_compromised", "Carte perdue ou compromise"],
    ["customer_request", "Demande du client"],
    ["manager_correction", "Correction manager"],
  ],
  unblock: [
    ["identity_verified", "Identité vérifiée"],
    ["customer_request", "Demande du client"],
    ["manager_correction", "Correction manager"],
  ],
  anonymize: [
    ["customer_request", "Demande d’effacement du client"],
    ["legal_obligation", "Obligation légale"],
    ["manager_correction", "Correction manager"],
  ],
  replaceQr: [
    ["lost_or_compromised", "Carte perdue ou compromise"],
    ["customer_request", "Demande du client"],
    ["manager_correction", "Correction manager"],
  ],
} as const satisfies Record<CardManagementAction, readonly (readonly [ManagementReasonCode, string])[]>;

const ENTRY_LABELS: Record<LoyaltyMemberDetail["ledger"][number]["kind"], string> = {
  earn: "Gain sur achat",
  redeem: "Récompense utilisée",
  adjust_credit: "Correction créditrice",
  adjust_debit: "Correction débitrice",
  reverse: "Annulation",
  expire: "Expiration",
};

function errorMessage(cause: unknown, fallback: string) {
  return cause instanceof ApiError ? cause.message : fallback;
}

export function MemberDrawer({
  memberId,
  program,
  rewards,
  onClose,
  onChanged,
}: {
  memberId: string;
  program: LoyaltyProgramView;
  rewards: LoyaltyRewardView[];
  onClose: () => void;
  onChanged: (member: LoyaltyMemberSummary) => void;
}) {
  const toast = useToast();
  const [detail, setDetail] = useState<LoyaltyMemberDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("history");

  const availableRewards = useMemo(() => rewards.filter((reward) => reward.active), [rewards]);

  const [adjustUnits, setAdjustUnits] = useState("");
  const [adjustReason, setAdjustReason] = useState("");
  const [adjustOperationId, setAdjustOperationId] = useState<string | null>(null);
  const [adjusting, setAdjusting] = useState(false);
  const [adjustError, setAdjustError] = useState<string | null>(null);

  const [consentBusy, setConsentBusy] = useState<LoyaltyConsentPurpose | null>(null);
  const [consentIntent, setConsentIntent] = useState<{ fingerprint: string; operationId: string } | null>(null);
  const [consentError, setConsentError] = useState<string | null>(null);
  const [managementAction, setManagementAction] = useState<CardManagementAction | null>(null);
  const [managementReasonCode, setManagementReasonCode] = useState<ManagementReasonCode | "">("");
  const [anonymizeConfirmation, setAnonymizeConfirmation] = useState("");
  const [managementIntent, setManagementIntent] = useState<{ fingerprint: string; operationId: string } | null>(null);
  const [managementBusy, setManagementBusy] = useState(false);
  const [managementError, setManagementError] = useState<string | null>(null);
  const [replacementQr, setReplacementQr] = useState<string | null>(null);
  const [handoffCloseWarning, setHandoffCloseWarning] = useState(false);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setDetail(await loyaltyApi.getMember(memberId));
    } catch (cause) {
      setLoadError(errorMessage(cause, "Chargement de la fiche impossible."));
    }
  }, [memberId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- lecture API de la fiche ouverte, relançable par le bouton de réessai.
    void load();
  }, [load]);

  function applyMutation(result: LoyaltyMutationResult) {
    setDetail((current) => current ? {
      ...current,
      member: result.member,
      ledger: result.entry
        ? [result.entry, ...current.ledger.filter((entry) => entry.id !== result.entry?.id)]
        : current.ledger,
    } : current);
    onChanged(result.member);
  }

  async function adjust(event: FormEvent) {
    event.preventDefault();
    if (adjusting) return;
    const count = parsePositiveInteger(adjustUnits);
    if (count === null) {
      setAdjustError("Indiquez un nombre entier strictement positif.");
      return;
    }
    if (adjustReason.trim().length < 3) {
      setAdjustError("Expliquez la correction en au moins trois caractères.");
      return;
    }
    const operationId = adjustOperationId ?? newLoyaltyOperationId();
    setAdjustOperationId(operationId);
    setAdjusting(true);
    setAdjustError(null);
    try {
      const result = await loyaltyApi.adjust(memberId, { operationId, units: count, reason: adjustReason.trim() });
      applyMutation(result);
      setAdjustUnits("");
      setAdjustReason("");
      setAdjustOperationId(null);
      toast(result.replayed ? "Correction déjà enregistrée" : "Solde corrigé avec trace d'audit", { icon: "check" });
    } catch (cause) {
      setAdjustError(errorMessage(cause, "Correction impossible — réessayez."));
    } finally {
      setAdjusting(false);
    }
  }

  async function setConsent(purpose: LoyaltyConsentPurpose, current: "granted" | "withdrawn" | undefined) {
    // Le pilote n'opère aucun canal SMS. Cette surface ne peut donc que
    // retirer un accord historique déjà actif, jamais en créer un nouveau.
    if (consentBusy || !detail || current !== "granted") return;
    const decision = "withdrawn" as const;
    const fingerprint = `${purpose}:${decision}`;
    const operationId = consentIntent?.fingerprint === fingerprint
      ? consentIntent.operationId
      : newLoyaltyOperationId();
    setConsentIntent({ fingerprint, operationId });
    setConsentBusy(purpose);
    setConsentError(null);
    try {
      const result = await loyaltyApi.recordConsent(memberId, {
        operationId,
        purpose,
        decision,
        noticeVersion: LOYALTY_SMS_NOTICE_VERSION,
      });
      setDetail((value) => value ? {
        ...value,
        consents: [
          ...value.consents.filter((consent) => consent.purpose !== purpose),
          result.consent,
        ],
      } : value);
      setConsentIntent(null);
      toast("Retrait enregistré immédiatement", { icon: "check" });
    } catch (cause) {
      setConsentError(errorMessage(cause, "Modification du consentement impossible — réessayez."));
    } finally {
      setConsentBusy(null);
    }
  }

  function openManagement(action: CardManagementAction) {
    setManagementAction(action);
    setManagementReasonCode("");
    setAnonymizeConfirmation("");
    setManagementIntent(null);
    setManagementError(null);
  }

  function closeManagement() {
    if (managementBusy) return;
    setManagementAction(null);
    setManagementReasonCode("");
    setAnonymizeConfirmation("");
    setManagementIntent(null);
    setManagementError(null);
  }

  async function refreshMember() {
    const refreshed = await loyaltyApi.getMember(memberId);
    setDetail(refreshed);
    onChanged(refreshed.member);
  }

  async function manageCard(event: FormEvent) {
    event.preventDefault();
    if (!managementAction || managementBusy || !detail) return;
    const reasonCode = managementReasonCode;
    if (!reasonCode) {
      setManagementError("Sélectionnez le motif correspondant à la demande.");
      return;
    }
    if (managementAction === "anonymize" && anonymizeConfirmation !== "ANONYMISER") {
      setManagementError("Recopiez ANONYMISER pour confirmer cette action irréversible.");
      return;
    }

    const fingerprint = `${managementAction}:${reasonCode}:${anonymizeConfirmation}:${detail.qrGeneration}`;
    const operationId = managementIntent?.fingerprint === fingerprint
      ? managementIntent.operationId
      : newLoyaltyOperationId();
    setManagementIntent({ fingerprint, operationId });
    setManagementBusy(true);
    setManagementError(null);
    try {
      if (managementAction === "replaceQr") {
        const result = await loyaltyApi.replaceQr(memberId, {
          operationId,
          reasonCode: reasonCode as LoyaltyMemberQrReplace["reasonCode"],
          expectedGeneration: detail.qrGeneration,
        });
        setReplacementQr(result.qrToken);
        setDetail((current) => current ? { ...current, qrGeneration: result.qrGeneration } : current);
        toast(result.replayed ? "Ce nouveau QR avait déjà été généré" : "Ancien QR révoqué, nouvelle carte prête", { icon: "check" });
      } else {
        const lifecycle: LoyaltyMemberLifecycle = managementAction === "anonymize"
          ? {
              operationId,
              action: "anonymize",
              reasonCode: reasonCode as Extract<LoyaltyMemberLifecycle, { action: "anonymize" }>["reasonCode"],
              confirmation: "ANONYMISER",
            }
          : managementAction === "block"
            ? {
                operationId,
                action: "block",
                reasonCode: reasonCode as Extract<LoyaltyMemberLifecycle, { action: "block" }>["reasonCode"],
              }
            : {
                operationId,
                action: "unblock",
                reasonCode: reasonCode as Extract<LoyaltyMemberLifecycle, { action: "unblock" }>["reasonCode"],
              };
        const result = await loyaltyApi.changeLifecycle(memberId, lifecycle);
        await refreshMember();
        const message = result.action === "block"
          ? "Carte bloquée — aucun mouvement n’est désormais accepté"
          : result.action === "unblock"
            ? "Carte réactivée"
            : `Carte anonymisée · ${result.revokedTokens} QR révoqué${result.revokedTokens > 1 ? "s" : ""}`;
        toast(result.replayed ? "Action déjà enregistrée — état actualisé" : message, { icon: "check" });
      }
      setManagementAction(null);
      setManagementReasonCode("");
      setAnonymizeConfirmation("");
      setManagementIntent(null);
    } catch (cause) {
      setManagementError(errorMessage(cause, "Modification impossible — réessayez avec la même intention."));
    } finally {
      setManagementBusy(false);
    }
  }

  const title = detail?.member.alias ?? "Fiche fidélité";
  const unitPlural = program.unitLabelPlural;
  const unitSingular = program.unitLabelSingular;
  const managementTitle = managementAction === "replaceQr"
    ? "Remplacer le QR de la carte"
    : managementAction === "block"
      ? "Bloquer temporairement la carte"
      : managementAction === "unblock"
        ? "Réactiver la carte"
        : "Anonymiser définitivement la carte";
  const managementSubmitLabel = managementAction === "replaceQr"
    ? "Révoquer et créer un QR"
    : managementAction === "block"
      ? "Confirmer le blocage"
      : managementAction === "unblock"
        ? "Réactiver"
        : "Anonymiser définitivement";

  function requestDrawerClose() {
    if (mustConfirmQrHandoffClose(replacementQr)) {
      setHandoffCloseWarning(true);
      return;
    }
    onClose();
  }

  function discardReplacementAndClose() {
    setReplacementQr(null);
    setHandoffCloseWarning(false);
    onClose();
  }

  return (
    <>
      <Drawer open onClose={requestDrawerClose} title={title} width={560} footer={<Btn block variant="ghost" onClick={requestDrawerClose}>Fermer la fiche</Btn>}>
      {loadError && !detail ? (
        <div className="p-[18px]"><p className="rounded-card border border-alert/35 bg-alert/10 p-3 text-xs text-alertt" role="alert">{loadError}</p><Btn variant="ghost" size="sm" className="mt-3" onClick={() => void load()}>Réessayer</Btn></div>
      ) : !detail ? (
        <div className="space-y-3 p-[18px]"><Skeleton className="h-[130px]" /><Skeleton className="h-[280px]" /></div>
      ) : (
        <>
          <div className="border-b border-line2 p-[18px]">
            <Card flat className="relative overflow-hidden border-accent/20 p-4">
              <div className="absolute -right-8 -top-12 size-32 rounded-full bg-accent/10 blur-2xl" aria-hidden />
              <div className="relative flex items-start justify-between gap-4">
                <div>
                  <Pill className={detail.member.status === "active" ? "border-ok/30 bg-ok/10 text-okt" : detail.member.status === "blocked" ? "border-alert/30 bg-alert/10 text-alertt" : ""}>
                    {detail.member.status === "active" ? "Carte active" : detail.member.status === "blocked" ? "Carte bloquée" : "Anonymisée"}
                  </Pill>
                  <p className="cf-fig mt-3 text-4xl font-black tracking-[-0.04em] text-ink">{detail.member.balanceUnits.toLocaleString("fr-FR")}</p>
                  <p className="mt-0.5 text-xs font-semibold text-mut">{detail.member.balanceUnits === 1 ? unitSingular : unitPlural} disponibles</p>
                </div>
                <div className="text-right text-xs leading-5 text-mut">
                  <p>{detail.member.maskedPhone ?? "Carte QR uniquement"}</p>
                  <p>Inscrit {timeAgo(detail.member.joinedAt)}</p>
                </div>
              </div>
              <div className="relative mt-4 grid grid-cols-2 gap-2 border-t border-line2 pt-3 text-xs">
                <div><span className="text-mut">Acquis</span><strong className="cf-fig ml-2 text-ink">{detail.member.lifetimeEarnedUnits.toLocaleString("fr-FR")}</strong></div>
                <div className="text-right"><span className="text-mut">Utilisés</span><strong className="cf-fig ml-2 text-ink">{detail.member.lifetimeRedeemedUnits.toLocaleString("fr-FR")}</strong></div>
              </div>
            </Card>

            <div className="mt-4 grid grid-cols-3 gap-1 rounded-pill border border-white/8 bg-white/5 p-1" role="group" aria-label="Sections de la fiche">
              {([
                ["history", "Historique"],
                ["operations", "Opérations"],
                ["privacy", "Données"],
              ] as const).map(([key, label]) => (
                <button key={key} type="button" aria-pressed={tab === key} disabled={replacementQr !== null && key !== "privacy"} onClick={() => setTab(key)} className={tab === key ? "cf-press rounded-pill bg-white/12 px-2 py-2 text-xs font-extrabold text-ink" : "cf-press rounded-pill px-2 py-2 text-xs font-bold text-mut hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"}>{label}</button>
              ))}
            </div>
          </div>

          <div className="p-[18px]">
            {tab === "history" && (
              detail.ledger.length === 0 ? <EmptyState icon="clock" title="Aucun mouvement" hint="La première opération apparaîtra ici." /> : (
                <ol className="space-y-2">
                  {detail.ledger.map((entry) => (
                    <li key={entry.id} className="flex items-start gap-3 rounded-card border border-white/6 bg-[image:var(--cf-elev-gradient)] p-3">
                      <span className={entry.deltaUnits > 0 ? "mt-1 size-2 shrink-0 rounded-full bg-ok" : "mt-1 size-2 shrink-0 rounded-full bg-alert"} aria-hidden />
                      <div className="min-w-0 flex-1"><p className="text-[13px] font-bold text-ink">{ENTRY_LABELS[entry.kind]}</p><p className="mt-0.5 text-xs text-mut">{entry.reason} · {timeAgo(entry.recordedAt)}</p></div>
                      <div className={entry.deltaUnits > 0 ? "cf-fig text-right text-sm font-extrabold text-okt" : "cf-fig text-right text-sm font-extrabold text-alertt"}>{entry.deltaUnits > 0 ? "+" : ""}{entry.deltaUnits}<div className="text-[10px] font-semibold text-mut">solde {entry.balanceAfter}</div></div>
                    </li>
                  ))}
                </ol>
              )
            )}

            {tab === "operations" && (
              detail.member.status !== "active" ? (
                <EmptyState
                  icon="user"
                  title={detail.member.status === "blocked" ? "Carte bloquée" : "Carte anonymisée"}
                  hint={detail.member.status === "blocked" ? "Réactivez la carte depuis l’onglet Données avant tout gain, récompense ou correction." : "L’anonymisation est terminale : aucun nouveau mouvement n’est autorisé."}
                  action={detail.member.status === "blocked" ? <Btn size="sm" onClick={() => { setTab("privacy"); openManagement("unblock"); }}>Gérer la carte</Btn> : undefined}
                />
              ) : (
                <div className="space-y-4">
                <Card flat className="p-4">
                  <div className="flex items-center gap-2"><Icon name="check" size={18} className="text-okt" /><h3 className="text-sm font-extrabold text-ink">Gains issus des ventes</h3></div>
                  <p className="mt-1 text-xs leading-5 text-mut">Les gains sont calculés automatiquement depuis une commande POS livrée et payée. Le back-office ne peut jamais fabriquer un achat.</p>
                </Card>

                <Card flat className="p-4">
                  <div className="flex items-center gap-2"><Icon name="gift" size={18} className="text-accent" /><h3 className="text-sm font-extrabold text-ink">Avantages publiés</h3></div>
                  <p className="mt-1 text-xs leading-5 text-mut">Aucun point n’est débité hors ticket. La consommation sera réactivée avec l’application automatique de l’avantage et sa compensation à l’annulation.</p>
                  {availableRewards.length === 0 ? <p className="mt-3 text-xs text-mut">Aucune récompense active.</p> : (
                    <ul className="mt-3 space-y-2">
                      {availableRewards.map((reward) => (
                        <li key={reward.id} className="flex items-center justify-between gap-3 rounded-card border border-white/8 px-3 py-2 text-xs">
                          <span className="font-bold text-ink">{reward.name}</span>
                          <span className="cf-fig text-mut">{reward.costUnits} {reward.costUnits === 1 ? unitSingular : unitPlural}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>

                <Card flat className="p-4">
                  <h3 className="text-sm font-extrabold text-ink">Crédit correctif manager</h3>
                  <p className="mt-1 text-xs leading-5 text-mut">Réservé à un oubli de points justifié. Un retrait doit inverser une écriture précise ; aucun débit libre n’est autorisé.</p>
                  <form onSubmit={adjust} className="mt-3 space-y-3">
                    <Input aria-label={`Nombre de ${unitPlural} à créditer`} placeholder={`Nombre de ${unitPlural} à créditer`} inputMode="numeric" value={adjustUnits} disabled={adjusting} onChange={(e) => { setAdjustUnits(e.target.value); setAdjustOperationId(null); }} />
                    <Field label="Motif obligatoire" htmlFor="loyalty-adjust-reason"><Input id="loyalty-adjust-reason" value={adjustReason} maxLength={300} disabled={adjusting} onChange={(e) => { setAdjustReason(e.target.value); setAdjustOperationId(null); }} /></Field>
                    <Btn type="submit" block variant="ghost" size="sm" disabled={adjusting}>{adjusting ? "Enregistrement…" : "Enregistrer la correction"}</Btn>
                  </form>
                  {adjustError && <p className="mt-2 text-xs text-alertt" role="alert">{adjustError}</p>}
                </Card>
                </div>
              )
            )}

            {tab === "privacy" && (
              <div className="space-y-4">
                <Card flat className="p-4">
                  <h3 className="text-sm font-extrabold text-ink">Préférences marketing</h3>
                  <p className="mt-1 text-xs leading-5 text-mut">L’adhésion fidélité et la prospection sont distinctes. Le canal SMS n’est pas activé pendant le pilote ; seul le retrait d’un accord historique reste possible.</p>
                  {(["marketing_sms"] as LoyaltyConsentPurpose[]).map((purpose) => {
                    const consent = detail.consents.find((item) => item.purpose === purpose);
                    const granted = consent?.decision === "granted";
                    const canWithdraw = canWithdrawHistoricalSmsConsent(
                      detail.member.status,
                      consent?.decision,
                    );
                    return (
                      <div key={purpose} className="mt-4 flex items-center justify-between gap-3 rounded-card border border-white/8 p-3">
                        <div><p className="text-[13px] font-bold text-ink">Offres par SMS</p><p className="mt-0.5 text-xs text-mut">{granted ? `Accord historique actif · ${consent ? timeAgo(consent.updatedAt) : ""}` : "Canal non activé · aucun nouvel accord possible"}</p></div>
                        {granted ? (
                          <Btn variant="ghost" size="sm" disabled={consentBusy === purpose || !canWithdraw} onClick={() => void setConsent(purpose, consent?.decision)}>Retirer</Btn>
                        ) : (
                          <span className="rounded-pill border border-white/8 px-3 py-2 text-xs font-bold text-mut" aria-disabled="true">Non disponible</span>
                        )}
                      </div>
                    );
                  })}
                  {consentError && <p className="mt-3 text-xs text-alertt" role="alert">{consentError}</p>}
                </Card>

                <Card flat className="p-4">
                  <h3 className="text-sm font-extrabold text-ink">Données conservées</h3>
                  <dl className="mt-3 grid grid-cols-[120px_1fr] gap-x-3 gap-y-2 text-xs"><dt className="text-mut">Identité</dt><dd className="text-ink">{detail.member.alias}</dd><dt className="text-mut">Téléphone</dt><dd className="text-ink">{detail.member.maskedPhone ?? "Non collecté"}</dd><dt className="text-mut">Dernière activité</dt><dd className="text-ink">{detail.member.lastActivityAt ? timeAgo(detail.member.lastActivityAt) : "Aucune"}</dd></dl>
                  <p className="mt-3 text-[11px] leading-5 text-mut">Le téléphone est chiffré en base ; la recherche utilise une empreinte séparée. Le QR n’est stocké qu’en empreinte irréversible.</p>
                </Card>

                {replacementQr && (
                  <div>
                    <QrHandoff token={replacementQr} alias={detail.member.alias} />
                    <Btn block variant="ghost" size="sm" className="mt-2" onClick={() => setReplacementQr(null)}>J’ai remis le nouveau QR au client</Btn>
                  </div>
                )}

                <Card flat className="p-4">
                  <h3 className="text-sm font-extrabold text-ink">Carte et accès</h3>
                  <p className="mt-1 text-xs leading-5 text-mut">
                    {detail.member.status === "active"
                      ? "Remplacez le QR s’il a été perdu ou partagé. Tous les anciens QR deviennent immédiatement inutilisables."
                      : detail.member.status === "blocked"
                        ? "La carte reste identifiable, mais aucun gain, avantage ou correction n’est accepté tant qu’elle n’est pas réactivée."
                        : "Les données d’identité ont été supprimées, les consentements retirés et les QR révoqués. Le registre financier pseudonymisé reste conservé comme preuve."}
                  </p>
                  {detail.member.status !== "anonymized" && (
                    <div className="mt-4 flex flex-wrap gap-2">
                      {detail.member.status === "active" ? (
                        <>
                          <Btn variant="ghost" size="sm" disabled={replacementQr !== null} onClick={() => openManagement("replaceQr")}>Remplacer le QR</Btn>
                          <Btn variant="ghost" size="sm" disabled={replacementQr !== null} onClick={() => openManagement("block")}>Bloquer la carte</Btn>
                        </>
                      ) : (
                        <Btn size="sm" onClick={() => openManagement("unblock")}>Réactiver la carte</Btn>
                      )}
                    </div>
                  )}
                </Card>

                {detail.member.status !== "anonymized" && (
                  <Card flat className="border-alert/25 bg-alert/5 p-4">
                    <h3 className="text-sm font-extrabold text-alertt">Droit à l’effacement</h3>
                    <p className="mt-1 text-xs leading-5 text-mut">Après vérification de la demande, l’anonymisation supprime l’identité, révoque les QR et retire les consentements actifs. Elle est définitive ; le solde ne pourra plus être utilisé.</p>
                    <Btn variant="ghost" size="sm" disabled={replacementQr !== null} className="mt-4 border-alert/30 text-alertt hover:bg-alert/10" onClick={() => openManagement("anonymize")}>Anonymiser définitivement</Btn>
                  </Card>
                )}
              </div>
            )}
          </div>
        </>
      )}
      </Drawer>

      <Modal
        open={managementAction !== null}
        onClose={closeManagement}
        title={managementTitle}
        destructive={managementAction === "anonymize" || managementAction === "replaceQr"}
        footer={(
          <>
            <Btn variant="ghost" size="sm" disabled={managementBusy} onClick={closeManagement}>Annuler</Btn>
            <Btn
              type="submit"
              form="loyalty-card-management"
              size="sm"
              variant={managementAction === "anonymize" ? "ghost" : "primary"}
              className={managementAction === "anonymize" ? "border-alert/35 text-alertt hover:bg-alert/10" : undefined}
              disabled={managementBusy}
            >
              {managementBusy ? "Enregistrement…" : managementSubmitLabel}
            </Btn>
          </>
        )}
      >
        <form id="loyalty-card-management" onSubmit={manageCard} className="space-y-4">
          <p className="text-xs leading-5 text-mut">
            {managementAction === "replaceQr"
              ? "Le QR actuel cessera immédiatement de fonctionner. Le nouveau secret ne sera affiché qu’après confirmation afin d’être remis au client."
              : managementAction === "block"
                ? "Le client conserve son historique et son solde, mais aucune opération ne pourra passer avant réactivation par un manager."
                : managementAction === "unblock"
                  ? "La carte et son QR actuel redeviendront utilisables immédiatement."
                  : "Cette action supprime l’identité et le téléphone, retire les consentements marketing et révoque tous les QR. Elle ne peut pas être annulée."}
          </p>
          <Field label="Motif obligatoire" htmlFor="loyalty-management-reason" hint="Code métier conservé dans l’audit ; aucun commentaire libre ni donnée client.">
            <Select
              id="loyalty-management-reason"
              autoFocus
              value={managementReasonCode}
              disabled={managementBusy}
              onChange={(event) => {
                setManagementReasonCode(event.target.value as ManagementReasonCode | "");
                setManagementIntent(null);
              }}
            >
              <option value="">Sélectionner un motif</option>
              {(managementAction ? MANAGEMENT_REASON_OPTIONS[managementAction] : []).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </Select>
          </Field>
          {managementAction === "anonymize" && (
            <Field label="Recopiez ANONYMISER" htmlFor="loyalty-anonymize-confirmation" hint="Confirmation explicite requise pour l’effacement définitif.">
              <Input
                id="loyalty-anonymize-confirmation"
                autoComplete="off"
                value={anonymizeConfirmation}
                disabled={managementBusy}
                onChange={(event) => {
                  setAnonymizeConfirmation(event.target.value);
                  setManagementIntent(null);
                }}
              />
            </Field>
          )}
          {managementError && <p className="rounded-card border border-alert/35 bg-alert/10 p-3 text-xs text-alertt" role="alert">{managementError}</p>}
        </form>
      </Modal>

      <Modal
        open={handoffCloseWarning}
        onClose={() => setHandoffCloseWarning(false)}
        title="Nouveau QR pas encore acquitté"
        destructive
        footer={(
          <>
            <Btn variant="ghost" size="sm" onClick={() => setHandoffCloseWarning(false)}>Revenir au QR</Btn>
            <Btn variant="ghost" size="sm" className="border-alert/35 text-alertt hover:bg-alert/10" onClick={discardReplacementAndClose}>Fermer sans remise</Btn>
          </>
        )}
      >
        <p className="text-xs leading-5 text-mut">L’ancien QR est déjà révoqué et ce nouveau secret ne sera plus affiché après fermeture. Fermez uniquement si vous acceptez de relancer une rotation pour ce client.</p>
      </Modal>
    </>
  );
}
