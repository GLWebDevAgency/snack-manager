"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import type {
  LoyaltyMemberCreateResult,
  LoyaltyMemberSummary,
} from "@sm/contracts";
import { Btn, Drawer, Field, Input, Modal, Skeleton } from "@/components/ui";
import { ApiError, getToken } from "@/lib/api";
import { isDemoActive } from "@/lib/demo";
import { loyaltyApi, newLoyaltyOperationId } from "../data";
import { LOYALTY_TERMS_NOTICE_VERSION } from "../legal";
import {
  clearEnrollmentRecovery,
  enrollmentRecoveryScopeFor,
  readEnrollmentRecovery,
  writeEnrollmentRecovery,
  type EnrollmentRecoveryPhase,
} from "./enrollment-recovery";
import { QrHandoff } from "./QrHandoff";
import { mustConfirmQrHandoffClose } from "./qr-handoff-policy";

function message(cause: unknown, fallback: string): string {
  return cause instanceof ApiError ? cause.message : fallback;
}

export function CreateMemberDrawer({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  /** `null` demande un rechargement après la reprise d'un ACK sans profil local. */
  onCreated: (member: LoyaltyMemberSummary | null) => void;
}) {
  const [firstName, setFirstName] = useState("");
  const [phone, setPhone] = useState("");
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [operationId, setOperationId] = useState<string | null>(null);
  const [phase, setPhase] = useState<EnrollmentRecoveryPhase | null>(null);
  const [result, setResult] = useState<LoyaltyMemberCreateResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [recovering, setRecovering] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [completed, setCompleted] = useState<string | null>(null);
  const [closeWarning, setCloseWarning] = useState(false);
  const onCreatedRef = useRef(onCreated);
  const recoveryScope = useMemo(() => {
    const demo = isDemoActive();
    return enrollmentRecoveryScopeFor({ demo, token: demo ? null : getToken() });
  }, []);
  const formId = "loyalty-member-create";

  useEffect(() => {
    onCreatedRef.current = onCreated;
  }, [onCreated]);

  const persist = useCallback(
    (id: string, nextPhase: EnrollmentRecoveryPhase) => {
      // Écriture synchrone AVANT le réseau : si le navigateur refuse le
      // stockage de session, aucune adhésion irrécupérable n'est créée.
      writeEnrollmentRecovery(recoveryScope, { operationId: id, phase: nextPhase });
      setOperationId(id);
      setPhase(nextPhase);
    },
    [recoveryScope],
  );

  const clearRecovery = useCallback(() => {
    clearEnrollmentRecovery(recoveryScope);
    setOperationId(null);
    setPhase(null);
  }, [recoveryScope]);

  const recover = useCallback(
    async (id: string): Promise<"ready" | "pending" | "closed"> => {
      try {
        const recovered = await loyaltyApi.recoverEnrollment({ operationId: id });
        if (recovered.status === "pending") {
          setNotice(
            "Le serveur connaît cette intention, mais la création n’est pas encore terminée. Vous pouvez vérifier à nouveau ou ressaisir exactement la même adhésion.",
          );
          setError(null);
          return "pending";
        }
        persist(id, "awaiting_handoff");
        setResult(recovered.enrollment);
        setFirstName("");
        setPhone("");
        setTermsAccepted(false);
        setNotice(
          "Adhésion récupérée sans recréer de carte. Remettez le QR puis confirmez la remise.",
        );
        setError(null);
        return "ready";
      } catch (cause) {
        if (
          cause instanceof ApiError &&
          (cause.status === 403 || cause.status === 404 || cause.status === 410)
        ) {
          try {
            clearRecovery();
          } catch {
            // Une entrée périmée sera rejetée à nouveau côté serveur ; aucune
            // donnée client ni aucun secret n'y est stocké.
          }
          setResult(null);
          setNotice(null);
          setError(
            cause.status === 410
              ? "La fenêtre de remise est expirée. Créez une nouvelle carte avec une nouvelle intention."
              : "Cette reprise n’appartient pas à cette session. Elle a été retirée de ce navigateur.",
          );
          return "closed";
        }
        setError(
          `${message(cause, "Impossible de vérifier l’adhésion.")} L’identifiant de reprise reste conservé ; ne créez pas une seconde carte.`,
        );
        return "pending";
      }
    },
    [clearRecovery, persist],
  );

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const pending = readEnrollmentRecovery(recoveryScope);
      if (!pending) {
        if (!cancelled) setRecovering(false);
        return;
      }
      if (!cancelled) {
        setOperationId(pending.operationId);
        setPhase(pending.phase);
        setNotice("Une adhésion interrompue a été retrouvée dans cet onglet.");
      }

      try {
        if (pending.phase === "ack_pending") {
          await loyaltyApi.acknowledgeEnrollment({
            operationId: pending.operationId,
          });
          clearEnrollmentRecovery(recoveryScope);
          if (!cancelled) {
            setOperationId(null);
            setPhase(null);
            setCompleted(
              "La remise précédente est confirmée. La carte est active ; rescannez-la si vous devez ouvrir sa fiche.",
            );
            onCreatedRef.current(null);
          }
          return;
        }

        if (pending.phase === "preparing") {
          const prepared = await loyaltyApi.prepareEnrollment({
            operationId: pending.operationId,
          });
          if (prepared.status === "ready") {
            await recover(pending.operationId);
          } else if (!cancelled) {
            setNotice(
              "Préparation retrouvée. Ressaisissez les informations puis relancez cette même adhésion.",
            );
          }
          return;
        }

        await recover(pending.operationId);
      } catch (cause) {
        if (
          cause instanceof ApiError &&
          (cause.status === 403 || cause.status === 404 || cause.status === 410)
        ) {
          try {
            clearEnrollmentRecovery(recoveryScope);
          } catch {
            // Voir la frontière fail-closed documentée dans `persist`.
          }
          if (!cancelled) {
            setOperationId(null);
            setPhase(null);
            setError(
              cause.status === 410
                ? "La tentative précédente a expiré. Vous pouvez créer une nouvelle carte."
                : "La tentative précédente ne peut pas être reprise dans cette session.",
            );
          }
        } else if (!cancelled) {
          setError(
            `${message(cause, "Reprise momentanément impossible.")} Ne générez pas une seconde carte.`,
          );
        }
      } finally {
        if (!cancelled) setRecovering(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [recover, recoveryScope]);

  function requestClose() {
    if (saving || recovering) return;
    if (mustConfirmQrHandoffClose(result?.qrToken ?? null)) {
      setCloseWarning(true);
      return;
    }
    onClose();
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving || recovering || result) return;
    if (!termsAccepted) {
      setError("Confirmez que le client a accepté les conditions du programme.");
      return;
    }

    const id = operationId ?? newLoyaltyOperationId();
    setSaving(true);
    setError(null);
    setNotice(null);
    let currentPhase: EnrollmentRecoveryPhase = "preparing";
    try {
      persist(id, currentPhase);
      const prepared = await loyaltyApi.prepareEnrollment({ operationId: id });
      if (prepared.status === "ready") {
        await recover(id);
        return;
      }

      currentPhase = "creating";
      persist(id, currentPhase);
      const created = await loyaltyApi.createMember({
        operationId: id,
        firstName: firstName.trim() || null,
        phone: phone.trim() || null,
        termsAccepted: true,
        termsNoticeVersion: LOYALTY_TERMS_NOTICE_VERSION,
      });
      currentPhase = "awaiting_handoff";
      persist(id, currentPhase);
      setResult(created);
      setFirstName("");
      setPhone("");
      setTermsAccepted(false);
      setNotice(
        "Carte créée. Elle deviendra utilisable uniquement après confirmation de sa remise.",
      );
    } catch (cause) {
      if (cause instanceof ApiError && cause.status >= 400 && cause.status < 500) {
        try {
          clearRecovery();
        } catch {
          // Le serveur a fermé l'intention ; l'entrée locale ne contient pas de PII.
        }
        setError(message(cause, "La création a été refusée. Corrigez le formulaire."));
      } else {
        setOperationId(id);
        setPhase(currentPhase);
        setError(
          `${message(cause, "Création momentanément impossible.")} La reprise est conservée dans cet onglet ; relancez la même adhésion.`,
        );
      }
    } finally {
      setSaving(false);
    }
  }

  async function acknowledgeHandoff() {
    if (!result || !operationId || saving) return;
    setSaving(true);
    setError(null);
    try {
      // Après cette écriture locale, un crash rejoue uniquement ACK. Le
      // navigateur ne tentera donc jamais de réafficher un QR déjà remis.
      persist(operationId, "ack_pending");
      await loyaltyApi.acknowledgeEnrollment({ operationId });
      clearRecovery();
      onCreated(result.member);
      setResult(null);
      onClose();
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 410) {
        try {
          clearRecovery();
        } catch {
          // La carte reste fermée côté serveur.
        }
        setResult(null);
        setError("Le délai de remise est expiré. Cette carte ne peut pas être activée.");
      } else {
        setError(
          `${message(cause, "Confirmation momentanément impossible.")} La confirmation sera rejouée dans cet onglet ; ne créez pas une autre carte.`,
        );
      }
    } finally {
      setSaving(false);
    }
  }

  async function retryRecovery() {
    if (!operationId || saving) return;
    setSaving(true);
    setError(null);
    try {
      await recover(operationId);
    } finally {
      setSaving(false);
    }
  }

  const canResubmitInterrupted =
    operationId !== null &&
    result === null &&
    (phase === "preparing" || phase === "creating");

  return (
    <>
      <Drawer
        open
        onClose={requestClose}
        title={
          completed
            ? "Remise confirmée"
            : result
              ? "Remettre la carte"
              : "Inscrire un client"
        }
        width={520}
        footer={
          completed ? (
            <Btn block onClick={onClose}>Fermer</Btn>
          ) : result ? (
            <Btn block disabled={saving} onClick={() => void acknowledgeHandoff()}>
              {saving ? "Confirmation…" : "QR remis · activer la carte"}
            </Btn>
          ) : (
            <div className="flex items-center justify-end gap-2">
              <Btn
                variant="ghost"
                size="sm"
                disabled={saving || recovering}
                onClick={requestClose}
              >
                Fermer
              </Btn>
              <Btn
                type="submit"
                form={formId}
                size="sm"
                disabled={saving || recovering}
                icon="plus"
              >
                {saving ? "Traitement…" : canResubmitInterrupted ? "Relancer la même adhésion" : "Créer la carte"}
              </Btn>
            </div>
          )
        }
      >
        {recovering ? (
          <div className="space-y-3 p-[18px]" aria-live="polite">
            <Skeleton className="h-20" />
            <Skeleton className="h-52" />
            <p className="text-center text-xs text-mut">Vérification d’une éventuelle remise interrompue…</p>
          </div>
        ) : completed ? (
          <div className="p-[18px]">
            <div className="rounded-card border border-ok/30 bg-ok/8 p-4" role="status">
              <p className="text-sm font-extrabold text-okt">Carte activée sans réexposer son secret</p>
              <p className="mt-1 text-xs leading-5 text-mut">{completed}</p>
            </div>
          </div>
        ) : result ? (
          <div className="space-y-4 p-[18px]">
            <EnrollmentSteps />
            {notice && <p className="rounded-card border border-ok/25 bg-ok/8 p-3 text-xs leading-5 text-okt" role="status">{notice}</p>}
            {error && <p className="rounded-card border border-alert/35 bg-alert/10 p-3 text-xs text-alertt" role="alert">{error}</p>}
            <QrHandoff token={result.qrToken} alias={result.member.alias} />
          </div>
        ) : (
          <form id={formId} onSubmit={submit} className="space-y-5 p-[18px]">
            <div className="rounded-card border border-accent/20 bg-accent/8 p-3 text-xs leading-5 text-ink">
              Le prénom et le téléphone sont facultatifs. Une carte QR seule reste possible pour minimiser les données collectées.
            </div>

            {notice && <p className="rounded-card border border-prep/30 bg-prep/8 p-3 text-xs leading-5 text-prept" role="status">{notice}</p>}

            {canResubmitInterrupted && (
              <Btn
                type="button"
                variant="ghost"
                size="sm"
                block
                disabled={saving}
                onClick={() => void retryRecovery()}
              >
                Vérifier d’abord si la carte existe déjà
              </Btn>
            )}

            <Field label="Prénom ou alias (facultatif)" htmlFor="loyalty-member-firstname">
              <Input
                id="loyalty-member-firstname"
                autoFocus
                autoComplete="off"
                value={firstName}
                maxLength={80}
                disabled={saving}
                onChange={(event) => setFirstName(event.target.value)}
              />
            </Field>
            <Field
              label="Téléphone (facultatif)"
              htmlFor="loyalty-member-phone"
              hint="Permet de retrouver la carte au comptoir. Jamais affiché en clair après l'inscription."
            >
              <Input
                id="loyalty-member-phone"
                type="tel"
                inputMode="tel"
                autoComplete="off"
                value={phone}
                maxLength={32}
                disabled={saving}
                onChange={(event) => setPhone(event.target.value)}
              />
            </Field>

            <label className="flex cursor-pointer items-start gap-3 rounded-card border border-white/8 bg-[image:var(--cf-elev-gradient)] p-3.5">
              <input
                type="checkbox"
                className="mt-0.5 size-4 accent-[var(--cf-accent)]"
                checked={termsAccepted}
                disabled={saving}
                onChange={(event) => setTermsAccepted(event.target.checked)}
              />
              <span>
                <span className="block text-sm font-bold text-ink">Adhésion au programme confirmée</span>
                <span className="mt-0.5 block text-xs leading-5 text-mut">Le client a pris connaissance des conditions fidélité. Cette adhésion n’autorise aucune prospection commerciale.</span>
              </span>
            </label>

            <div className="rounded-card border border-white/8 bg-white/[0.025] p-3.5" aria-label="Offres par SMS non disponibles pendant le pilote">
              <span className="block text-sm font-bold text-ink">Offres par SMS · canal non activé</span>
              <span className="mt-0.5 block text-xs leading-5 text-mut">Aucun accord marketing n’est recueilli pendant le pilote. L’adhésion fidélité reste pleinement disponible et indépendante.</span>
            </div>

            {error && <p className="rounded-card border border-alert/35 bg-alert/10 p-3 text-xs text-alertt" role="alert">{error}</p>}
          </form>
        )}
      </Drawer>

      <Modal
        open={closeWarning}
        onClose={() => setCloseWarning(false)}
        title="QR non remis"
        destructive
        footer={(
          <>
            <Btn variant="ghost" size="sm" onClick={() => setCloseWarning(false)}>Revenir confirmer la remise</Btn>
            <Btn
              variant="ghost"
              size="sm"
              className="border-alert/35 text-alertt hover:bg-alert/10"
              onClick={() => {
                setResult(null);
                setCloseWarning(false);
                onClose();
              }}
            >
              QR non remis · fermer
            </Btn>
          </>
        )}
      >
        <p className="text-xs leading-5 text-mut">
          Si le client a reçu ou photographié ce QR, revenez en arrière puis confirmez la remise pour activer sa carte. Fermez uniquement si le QR n’a pas été remis : la reprise restera liée à cet onglet, sans prénom, téléphone ni secret enregistré.
        </p>
      </Modal>
    </>
  );
}

function EnrollmentSteps() {
  return (
    <ol className="grid grid-cols-3 overflow-hidden rounded-card border border-white/8 bg-black/15 text-[10px] font-bold uppercase tracking-[0.06em]" aria-label="Étapes de remise de la carte">
      <li className="border-r border-white/8 px-3 py-2.5 text-okt"><span className="mr-1.5 opacity-70">01</span>Créée</li>
      <li className="border-r border-accent/20 bg-accent/8 px-3 py-2.5 text-accent" aria-current="step"><span className="mr-1.5 opacity-70">02</span>Remettre</li>
      <li className="px-3 py-2.5 text-mut"><span className="mr-1.5 opacity-70">03</span>Activer</li>
    </ol>
  );
}
