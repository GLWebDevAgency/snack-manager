import { useTheme } from './theme';
/**
 * Fidélité au comptoir — autonome de la commande en ligne.
 *
 * Frontière de confidentialité : le téléphone exact et le secret QR ne
 * quittent jamais l'état mémoire de ce composant. Toutes les opérations qui
 * les portent sont immédiates (jamais la file persistée, jamais une URL).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import * as QRCode from 'qrcode';
import {
  type LoyaltyEnrollmentAcknowledgementResult,
  type LoyaltyEnrollmentPrepareResult,
  type LoyaltyEnrollmentRecoveryResult,
  type LoyaltyMemberCreateResult,
  type LoyaltyMemberSummary,
  type LoyaltyProgramView,
  type LoyaltyRewardView,
} from '@sm/contracts';
import { SmApiError, uuid } from '@sm/client-core';
import { client, KEYS } from './client';
import {
  LOYALTY_TERMS_NOTICE_VERSION,
  activeRewardsFor,
  discardTerminalEnrollmentRecovery,
  extractLoyaltyQrToken,
  isTerminalEnrollmentError,
  loyaltyQrPayload,
  parseLoyaltyEnrollmentRecovery,
  resumePreparingEnrollment,
  type LoyaltyEnrollmentRecoveryState,
  type LoyaltyTicketMember,
} from './loyalty-state';
import { FONT, R, S, withAlpha, type Brand } from './theme';
import { Btn, Chip, Field, Overlay, PanelHead, Press, ScrollView } from './ui';
import { useLayout } from './useLayout';

type MainTab = 'find' | 'create';
type FindMode = 'qr' | 'phone';
type CreateMode = 'qr' | 'phone';

function ticketMember(member: LoyaltyMemberSummary): LoyaltyTicketMember {
  return {
    id: member.id,
    alias: member.alias,
    balanceUnits: member.balanceUnits,
    status: member.status,
    maskedPhone: member.maskedPhone,
  };
}

function safeMessage(error: unknown, fallback: string): string {
  if (error instanceof SmApiError || error instanceof Error) return error.message;
  return fallback;
}

function unitLabel(program: LoyaltyProgramView | null, value: number): string {
  if (!program) return value === 1 ? 'unité' : 'unités';
  return value === 1 ? program.unitLabelSingular : program.unitLabelPlural;
}

export function LoyaltyPanel({
  brand,
  tenantSlug,
  publicSiteOrigin,
  offline,
  attached,
  pendingEarns,
  onAttach,
  onDetach,
  onUnauthorized,
  onClose,
}: {
  brand: Brand;
  tenantSlug: string;
  publicSiteOrigin: string | null;
  offline: boolean;
  attached: LoyaltyTicketMember | null;
  pendingEarns: number;
  onAttach: (member: LoyaltyTicketMember) => void;
  onDetach: () => void;
  onUnauthorized: () => void;
  onClose: () => void;
}) {
  const { type, palette, sheet } = useTheme();
  const L = useLayout();
  const [tab, setTab] = useState<MainTab>('find');
  const [findMode, setFindMode] = useState<FindMode>('qr');
  const [createMode, setCreateMode] = useState<CreateMode>('qr');
  const [program, setProgram] = useState<LoyaltyProgramView | null>(null);
  const [allRewards, setAllRewards] = useState<LoyaltyRewardView[]>([]);
  const [member, setMember] = useState<LoyaltyTicketMember | null>(attached);
  const [loading, setLoading] = useState(true);
  const [transportReady, setTransportReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [qrLookup, setQrLookup] = useState('');
  const [phoneLookup, setPhoneLookup] = useState('');
  const [firstName, setFirstName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [issuedQr, setIssuedQr] = useState<string | null>(null);
  const [recoveryOperationId, setRecoveryOperationId] = useState<string | null>(null);
  const [recoveryPhase, setRecoveryPhase] =
    useState<LoyaltyEnrollmentRecoveryState['phase'] | null>(null);
  const [closeWarning, setCloseWarning] = useState(false);
  const createOperation = useRef<string | null>(null);

  const rewards = useMemo(
    () => (program ? activeRewardsFor(allRewards, program.id) : []),
    [allRewards, program],
  );
  const issuedPayload = useMemo(
    () =>
      issuedQr ? loyaltyQrPayload(issuedQr, publicSiteOrigin, tenantSlug) : null,
    [issuedQr, publicSiteOrigin, tenantSlug],
  );

  const handleUnauthorized = useCallback(
    (_reason: string) => {
      onClose();
      onUnauthorized();
    },
    [onClose, onUnauthorized],
  );

  const persistEnrollmentPhase = useCallback(
    async (
      operationId: string,
      phase: LoyaltyEnrollmentRecoveryState['phase'],
    ) => {
      await client.tenantStore.setItem(
        KEYS.loyaltyEnrollmentRecovery,
        JSON.stringify({ operationId, phase }),
      );
      setRecoveryOperationId(operationId);
      setRecoveryPhase(phase);
    },
    [],
  );

  const resetEnrollmentRecoveryState = useCallback(() => {
    createOperation.current = null;
    setRecoveryOperationId(null);
    setRecoveryPhase(null);
  }, []);

  const clearEnrollmentRecovery = useCallback(async () => {
    await client.tenantStore.removeItem(KEYS.loyaltyEnrollmentRecovery);
    resetEnrollmentRecoveryState();
  }, [resetEnrollmentRecoveryState]);

  const closeTerminalEnrollmentRecovery = useCallback(async () => {
    await discardTerminalEnrollmentRecovery(
      () => client.tenantStore.removeItem(KEYS.loyaltyEnrollmentRecovery),
      resetEnrollmentRecoveryState,
    );
    setIssuedQr(null);
    setMember(attached);
    setTab('create');
    setNotice('La tentative précédente est clôturée. Une nouvelle adhésion peut être créée.');
    setError(null);
  }, [attached, resetEnrollmentRecoveryState]);

  const recoverEnrollment = useCallback(
    async (operationId: string): Promise<'recovered' | 'closed' | 'pending'> => {
      setRecoveryOperationId(operationId);
      setRecoveryPhase('creating');
      try {
        const recovered = await client.direct<LoyaltyEnrollmentRecoveryResult>(
          'POST',
          '/loyalty/members/enrollments/recover',
          { operationId },
        );
        if (recovered.status === 'pending') {
          setError(
            `La création est encore traitée par le serveur. Réessayez dans ${Math.ceil(recovered.retryAfterMs / 100) / 10} s.`,
          );
          return 'pending';
        }
        const enrollment = recovered.enrollment;
        await persistEnrollmentPhase(operationId, 'awaiting_handoff');
        setMember(ticketMember(enrollment.member));
        setIssuedQr(enrollment.qrToken);
        createOperation.current = null;
        setFirstName('');
        setNewPhone('');
        setTermsAccepted(false);
        setError(null);
        setNotice('Adhésion récupérée. Remettez le QR avant tout rattachement au ticket.');
        return 'recovered';
      } catch (cause) {
        if (cause instanceof SmApiError && cause.status === 401) {
          handleUnauthorized('Session expirée');
          return 'pending';
        }
        if (isTerminalEnrollmentError(cause)) {
          await closeTerminalEnrollmentRecovery();
          return 'closed';
        }
        setError(
          `${safeMessage(cause, "Impossible de vérifier l'adhésion.")} La reprise reste liée à cette caisse et n’est pas abandonnée.`,
        );
        return 'pending';
      }
    },
    [closeTerminalEnrollmentRecovery, handleUnauthorized, persistEnrollmentPhase],
  );

  const acknowledgeEnrollment = useCallback(
    async (operationId: string, resumed: boolean): Promise<boolean> => {
      try {
        await client.direct<LoyaltyEnrollmentAcknowledgementResult>(
          'POST',
          '/loyalty/members/enrollments/acknowledge',
          { operationId },
        );
        setIssuedQr(null);
        await clearEnrollmentRecovery();
        setError(null);
        setNotice(
          resumed
            ? 'La remise précédente est confirmée. Rescannez la carte pour la rattacher à ce ticket.'
            : 'QR remis et reprise clôturée. Rattachez maintenant la carte au ticket si nécessaire.',
        );
        return true;
      } catch (cause) {
        if (cause instanceof SmApiError && cause.status === 401) {
          handleUnauthorized('Session expirée');
          return false;
        }
        if (cause instanceof SmApiError && cause.status === 410) {
          setIssuedQr(null);
          await clearEnrollmentRecovery().catch(() => {});
          setMember(attached);
          setError('Le délai de remise a expiré. Cette carte ne peut pas être rattachée.');
          return false;
        }
        setError(
          `${safeMessage(cause, 'Impossible de confirmer la remise du QR.')} La confirmation sera rejouée sur cette caisse.`,
        );
        return false;
      }
    },
    [attached, clearEnrollmentRecovery, handleUnauthorized],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [nextProgram, nextRewards] = await Promise.all([
        client.get<LoyaltyProgramView | null>('/loyalty/program'),
        client.get<LoyaltyRewardView[]>('/loyalty/rewards'),
      ]);
      setProgram(nextProgram);
      setAllRewards(nextRewards);
      setTransportReady(true);

      const rawRecovery = await client.tenantStore.getItem(
        KEYS.loyaltyEnrollmentRecovery,
      );
      const pendingRecovery = parseLoyaltyEnrollmentRecovery(rawRecovery);
      if (rawRecovery && !pendingRecovery) {
        await client.tenantStore.removeItem(KEYS.loyaltyEnrollmentRecovery).catch(() => {});
      }
      if (pendingRecovery) {
        createOperation.current = pendingRecovery.operationId;
        setRecoveryOperationId(pendingRecovery.operationId);
        setRecoveryPhase(pendingRecovery.phase);
        if (pendingRecovery.phase === 'ack_pending') {
          await acknowledgeEnrollment(pendingRecovery.operationId, true);
        } else if (pendingRecovery.phase === 'preparing') {
          const outcome = await resumePreparingEnrollment({
            operationId: pendingRecovery.operationId,
            prepare: (operationId) =>
              client.direct<LoyaltyEnrollmentPrepareResult>(
                'POST',
                '/loyalty/members/enrollments/prepare',
                { operationId },
              ),
            onClosed: closeTerminalEnrollmentRecovery,
          });
          if (outcome === 'recover') {
            await recoverEnrollment(pendingRecovery.operationId);
          } else if (outcome === 'resume_form') {
            setTab('create');
            setNotice(
              'Préparation retrouvée. Ressaisissez les informations puis relancez la même adhésion.',
            );
          }
        } else {
          await recoverEnrollment(pendingRecovery.operationId);
        }
      }
    } catch (cause) {
      setTransportReady(false);
      if (cause instanceof SmApiError && cause.status === 401) {
        handleUnauthorized('Session expirée');
        return;
      }
      setError(safeMessage(cause, 'La fidélité est momentanément indisponible.'));
    } finally {
      setLoading(false);
    }
  }, [acknowledgeEnrollment, closeTerminalEnrollmentRecovery, handleUnauthorized, recoverEnrollment]);

  useEffect(() => {
    void load();
  }, [load]);

  const resetCreateOperation = () => {
    if (recoveryOperationId) return;
    createOperation.current = null;
    setError(null);
  };

  const resolve = async () => {
    const qrToken =
      findMode === 'qr' ? extractLoyaltyQrToken(qrLookup, tenantSlug) : null;
    const body =
      findMode === 'qr'
        ? { by: 'qr_token' as const, qrToken: qrToken ?? '' }
        : { by: 'phone' as const, phone: phoneLookup };
    if (findMode === 'qr' && !qrToken) {
      setQrLookup('');
      setError('Carte QR illisible. Scannez le code complet puis validez.');
      return;
    }
    if (findMode === 'phone' && phoneLookup.replace(/\D/g, '').length < 8) {
      setError('Saisissez le numéro complet du client.');
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const found = await client.direct<LoyaltyMemberSummary>(
        'POST',
        '/loyalty/members/resolve',
        body,
      );
      setMember(found);
      // Les deux secrets de recherche sortent immédiatement de la mémoire de
      // formulaire, y compris lorsque la recherche était téléphonique.
      setQrLookup('');
      setPhoneLookup('');
    } catch (cause) {
      setQrLookup('');
      setPhoneLookup('');
      if (cause instanceof SmApiError && cause.status === 401) {
        handleUnauthorized('Session expirée');
        return;
      }
      setError(safeMessage(cause, 'Carte fidélité introuvable.'));
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    if (!program || program.status !== 'active') {
      setError("Le programme n'est pas actif.");
      return;
    }
    if (!termsAccepted) {
      setError("L'acceptation des conditions de fidélité est obligatoire.");
      return;
    }
    if (
      createMode === 'phone' &&
      (firstName.trim().length === 0 || newPhone.replace(/\D/g, '').length < 8)
    ) {
      setError('Le prénom et le numéro complet sont requis pour cette carte.');
      return;
    }

    const operationId = createOperation.current ?? uuid();
    createOperation.current = operationId;
    setBusy(true);
    setError(null);
    setNotice(null);
    let phase: LoyaltyEnrollmentRecoveryState['phase'] = 'preparing';
    try {
      // L'intention est durable AVANT toute PII. PREPARE rend ensuite la ligne
      // visible au serveur avant la transaction de création : un recover
      // concurrent verra `pending`, jamais un faux « absent ».
      await persistEnrollmentPhase(operationId, 'preparing');
      const prepared = await client.direct<LoyaltyEnrollmentPrepareResult>(
        'POST',
        '/loyalty/members/enrollments/prepare',
        { operationId },
      );
      if (prepared.status === 'ready') {
        await recoverEnrollment(operationId);
        return;
      }
      phase = 'creating';
      await persistEnrollmentPhase(operationId, phase);
      // Direct uniquement : mettre ce body en file écrirait le téléphone en
      // clair dans le stockage persistant de la tablette.
      const created = await client.direct<LoyaltyMemberCreateResult>(
        'POST',
        '/loyalty/members',
        {
          operationId,
          firstName: createMode === 'phone' ? firstName.trim() : null,
          phone: createMode === 'phone' ? newPhone.trim() : null,
          termsAccepted: true,
          termsNoticeVersion: LOYALTY_TERMS_NOTICE_VERSION,
        },
      );

      phase = 'awaiting_handoff';
      await persistEnrollmentPhase(operationId, phase);
      setMember(ticketMember(created.member));
      setIssuedQr(created.qrToken);
      setFirstName('');
      setNewPhone('');
      setTermsAccepted(false);
      createOperation.current = null;
      setNotice('Carte créée. Remettez le QR avant de choisir de la rattacher au ticket.');
    } catch (cause) {
      if (cause instanceof SmApiError && cause.status === 401) {
        handleUnauthorized('Session expirée');
        return;
      }
      if (isTerminalEnrollmentError(cause)) {
        await closeTerminalEnrollmentRecovery();
        return;
      }
      if (cause instanceof SmApiError && cause.status >= 400 && cause.status < 500) {
        await clearEnrollmentRecovery().catch(() => {});
        setError(safeMessage(cause, 'La création a été refusée. Corrigez le formulaire.'));
        return;
      }
      setRecoveryOperationId(operationId);
      setRecoveryPhase(phase);
      setError(
        `${safeMessage(cause, 'Impossible de créer la carte.')} L’intention est conservée ; reprenez-la sans générer une seconde carte.`,
      );
    } finally {
      setBusy(false);
    }
  };

  const retryRecovery = async () => {
    if (!recoveryOperationId || busy) return;
    setBusy(true);
    setError(null);
    try {
      await recoverEnrollment(recoveryOperationId);
    } finally {
      setBusy(false);
    }
  };

  const completeQrHandoff = async () => {
    if (busy || !recoveryOperationId) return;
    setBusy(true);
    setError(null);
    try {
      // En cas de crash après ce write, le redémarrage rejoue ACK — jamais la
      // récupération du QR qui vient d'être remis.
      await persistEnrollmentPhase(recoveryOperationId, 'ack_pending');
      await acknowledgeEnrollment(recoveryOperationId, false);
    } catch (cause) {
      setError(
        `${safeMessage(cause, 'Impossible de préparer la confirmation de remise.')} Réessayez avant de fermer.`,
      );
    } finally {
      setBusy(false);
    }
  };

  const requestClose = () => {
    if (busy) {
      setError('L’action en cours doit répondre avant la fermeture.');
      return;
    }
    if (issuedQr) {
      setCloseWarning(true);
      return;
    }
    onClose();
  };

  if (closeWarning) {
    return (
      <Overlay
        onClose={() => setCloseWarning(false)}
        accessibilityLabel="QR fidélité non remis"
        width={480}
        dim={0.74}
      >
        <PanelHead
          title="QR non remis"
          sub="Ne fermez pas si le client a déjà reçu ou photographié ce QR."
        />
        <View style={{ padding: L.sp(S.xl), gap: S.md }}>
          <Text style={[type.body, { lineHeight: L.fs(21) }]}>
            Si le client a reçu sa carte, revenez au QR puis confirmez sa remise : cette étape
            active définitivement la carte. Fermez uniquement lorsque le QR n’a pas encore été
            remis. Le secret n’est jamais enregistré sur la tablette ; seule l’intention
            technique, liée à cette caisse, reste conservée jusqu’à sa remise ou son expiration.
          </Text>
          <View style={{ flexDirection: 'row', gap: S.sm }}>
            <Btn
              label="Revenir confirmer la remise"
              kind="ghost"
              onPress={() => setCloseWarning(false)}
              style={{ flex: 1 }}
            />
            <Btn
              label="QR non remis · fermer"
              kind="danger"
              onPress={() => {
                setIssuedQr(null);
                onClose();
              }}
              style={{ flex: 1 }}
            />
          </View>
        </View>
      </Overlay>
    );
  }

  return (
    <Overlay
      onClose={requestClose}
      accessibilityLabel="Fidélité client"
      width={780}
      align="top"
      dim={0.72}
      initialFocus="input"
      focusKey={
        loading
          ? 'loading'
          : issuedQr
            ? 'qr-handoff'
            : member
              ? 'member'
              : `${tab}:${tab === 'find' ? findMode : createMode}`
      }
    >
      <PanelHead
        title="Fidélité"
        sub="Carte autonome · QR ou téléphone exact · aucun téléphone ni QR dans l’URL"
        onClose={requestClose}
        right={
          pendingEarns > 0 ? (
            <View
              style={{
                paddingHorizontal: 11,
                paddingVertical: 6,
                borderRadius: R.pill,
                backgroundColor: withAlpha(palette.amber, 0.12),
                borderWidth: 1,
                borderColor: withAlpha(palette.amber, 0.32),
              }}
            >
              <Text style={{ fontFamily: FONT, color: palette.amber, fontSize: L.fs(12.5), fontWeight: '700' }}>
                {pendingEarns} traitement{pendingEarns > 1 ? 's' : ''} en attente
              </Text>
            </View>
          ) : null
        }
      />

      <View style={{ flexDirection: 'row', gap: S.sm, paddingHorizontal: S.xl, paddingBottom: S.md }}>
        <Chip
          label="Retrouver une carte"
          accessibilityRole="tab"
          on={tab === 'find'}
          disabled={busy}
          onPress={() => {
            setTab('find');
            setError(null);
          }}
          accent={brand.accent}
          onAccent={brand.onAccent}
        />
        <Chip
          label="Créer une carte"
          accessibilityRole="tab"
          on={tab === 'create'}
          disabled={busy}
          onPress={() => {
            setTab('create');
            setMember(null);
            setError(null);
          }}
          accent={brand.accent}
          onAccent={brand.onAccent}
        />
      </View>
      <View style={sheet.hairline} />

      <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ padding: L.sp(S.xl), gap: S.lg }}>
        {loading ? (
          <StatusCard tone={brand.accent} title="Ouverture du programme…" body="Lecture sécurisée du programme et des avantages." />
        ) : error && !transportReady ? (
          <View style={{ gap: S.md }}>
            <StatusCard
              tone={offline ? palette.amber : palette.red}
              title="Connexion requise"
              body={`${error} La commande continue hors ligne ; recherche et adhésion restent bloquées pour protéger le compte client.`}
            />
            <Btn label="Réessayer" kind="ghost" onPress={() => void load()} />
          </View>
        ) : (
          <>
            {program?.status !== 'active' ? (
              <StatusCard
                tone={palette.amber}
                title={program ? 'Programme en pause' : 'Programme non configuré'}
                body="Les cartes existantes restent consultables, mais aucune nouvelle adhésion ne sera enregistrée."
              />
            ) : null}

            {notice ? <StatusCard tone={palette.green} title="C’est enregistré" body={notice} /> : null}
            {error ? <StatusCard tone={palette.red} title="Action non terminée" body={error} /> : null}
            {recoveryOperationId &&
            !issuedQr &&
            (recoveryPhase === 'creating' || recoveryPhase === 'awaiting_handoff') ? (
              <Btn
                label={busy ? 'Vérification…' : 'Vérifier la création'}
                kind="ghost"
                disabled={busy}
                onPress={() => void retryRecovery()}
                block
              />
            ) : null}
            {recoveryOperationId && !issuedQr && recoveryPhase === 'ack_pending' ? (
              <Btn
                label={busy ? 'Confirmation…' : 'Rejouer la confirmation de remise'}
                kind="ghost"
                disabled={busy}
                onPress={() => void acknowledgeEnrollment(recoveryOperationId, true)}
                block
              />
            ) : null}

            {issuedQr && issuedPayload ? (
              <QrHandoff
                payload={issuedPayload}
                deepLinked={issuedPayload !== issuedQr}
                member={member}
                brand={brand}
                busy={busy}
                onDone={() => void completeQrHandoff()}
              />
            ) : member ? (
              <MemberView
                member={member}
                program={program}
                rewards={rewards}
                attached={attached?.id === member.id}
                brand={brand}
                onAttach={() => {
                  if (attached && attached.id !== member.id) {
                    setError(
                      `Une autre carte (${attached.alias}) est déjà rattachée. Détachez-la avant de la remplacer.`,
                    );
                    return;
                  }
                  onAttach(member);
                }}
                onDetach={onDetach}
                onAnother={() => {
                  setMember(null);
                  setNotice(null);
                  setError(null);
                }}
              />
            ) : tab === 'find' ? (
              <FindCard
                mode={findMode}
                onMode={(next) => {
                  setFindMode(next);
                  setQrLookup('');
                  setPhoneLookup('');
                  setError(null);
                }}
                qr={qrLookup}
                onQr={setQrLookup}
                phone={phoneLookup}
                onPhone={setPhoneLookup}
                busy={busy}
                disabled={!transportReady}
                brand={brand}
                onSubmit={() => void resolve()}
              />
            ) : (
              <CreateCard
                mode={createMode}
                onMode={(next) => {
                  setCreateMode(next);
                  setFirstName('');
                  setNewPhone('');
                  resetCreateOperation();
                }}
                firstName={firstName}
                onFirstName={(value) => {
                  setFirstName(value);
                  resetCreateOperation();
                }}
                phone={newPhone}
                onPhone={(value) => {
                  setNewPhone(value);
                  resetCreateOperation();
                }}
                termsAccepted={termsAccepted}
                onTerms={(value) => {
                  setTermsAccepted(value);
                  resetCreateOperation();
                }}
                termsSummary={program?.termsSummary ?? ''}
                busy={busy}
                disabled={
                  !transportReady ||
                  program?.status !== 'active' ||
                  (recoveryOperationId !== null && recoveryPhase !== 'preparing')
                }
                brand={brand}
                onSubmit={() => void create()}
              />
            )}
          </>
        )}
      </ScrollView>
    </Overlay>
  );
}

function FindCard({
  mode,
  onMode,
  qr,
  onQr,
  phone,
  onPhone,
  busy,
  disabled,
  brand,
  onSubmit,
}: {
  mode: FindMode;
  onMode: (mode: FindMode) => void;
  qr: string;
  onQr: (value: string) => void;
  phone: string;
  onPhone: (value: string) => void;
  busy: boolean;
  disabled: boolean;
  brand: Brand;
  onSubmit: () => void;
}) {
  const { sheet, type } = useTheme();
  const L = useLayout();
  return (
    <View style={[sheet.inset, { padding: L.sp(S.lg), gap: S.lg }]}>
      <View>
        <Text style={[type.h2, { fontSize: L.fs(18) }]}>Identifier le client</Text>
        <Text style={[type.mut, { marginTop: 4, lineHeight: L.fs(18) }]}>
          Le scan reste prioritaire. Le téléphone est une recherche exacte, jamais une liste de clients.
        </Text>
      </View>
      <View style={{ flexDirection: 'row', gap: S.sm }}>
        <Chip label="Scanner QR" accessibilityRole="radio" on={mode === 'qr'} onPress={() => onMode('qr')} disabled={busy} accent={brand.accent} onAccent={brand.onAccent} />
        <Chip label="Téléphone exact" accessibilityRole="radio" on={mode === 'phone'} onPress={() => onMode('phone')} disabled={busy} accent={brand.accent} onAccent={brand.onAccent} />
      </View>
      {mode === 'qr' ? (
        <Field
          label="Lecteur QR"
          value={qr}
          onChangeText={onQr}
          placeholder="Scannez la carte puis Entrée"
          autoFocus
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="off"
          secureTextEntry
          maxLength={512}
          accent={brand.accent}
          onSubmitEditing={onSubmit}
          disabled={busy || disabled}
        />
      ) : (
        <Field
          label="Numéro complet"
          value={phone}
          onChangeText={onPhone}
          placeholder="06 12 34 56 78"
          keyboardType="phone-pad"
          autoComplete="off"
          maxLength={32}
          accent={brand.accent}
          onSubmitEditing={onSubmit}
          disabled={busy || disabled}
        />
      )}
      <Btn
        label={busy ? 'Recherche…' : 'Retrouver la carte'}
        kind="primary"
        accent={brand.accent}
        onAccent={brand.onAccent}
        disabled={busy || disabled}
        onPress={onSubmit}
        block
      />
    </View>
  );
}

function CreateCard({
  mode,
  onMode,
  firstName,
  onFirstName,
  phone,
  onPhone,
  termsAccepted,
  onTerms,
  termsSummary,
  busy,
  disabled,
  brand,
  onSubmit,
}: {
  mode: CreateMode;
  onMode: (mode: CreateMode) => void;
  firstName: string;
  onFirstName: (value: string) => void;
  phone: string;
  onPhone: (value: string) => void;
  termsAccepted: boolean;
  onTerms: (value: boolean) => void;
  termsSummary: string;
  busy: boolean;
  disabled: boolean;
  brand: Brand;
  onSubmit: () => void;
}) {
  const { sheet, type, palette } = useTheme();
  const L = useLayout();
  return (
    <View style={[sheet.inset, { padding: L.sp(S.lg), gap: S.lg }]}>
      <View>
        <Text style={[type.h2, { fontSize: L.fs(18) }]}>Nouvelle carte</Text>
        <Text style={[type.mut, { marginTop: 4, lineHeight: L.fs(18) }]}>
          Choisissez la donnée minimale nécessaire. Une carte QR-only ne demande aucune identité.
        </Text>
      </View>
      <View style={{ flexDirection: 'row', gap: S.sm, flexWrap: 'wrap' }}>
        <Chip label="QR uniquement" accessibilityRole="radio" on={mode === 'qr'} onPress={() => onMode('qr')} disabled={busy} accent={brand.accent} onAccent={brand.onAccent} />
        <Chip label="Prénom + téléphone" accessibilityRole="radio" on={mode === 'phone'} onPress={() => onMode('phone')} disabled={busy} accent={brand.accent} onAccent={brand.onAccent} />
      </View>
      {mode === 'phone' ? (
        <View style={{ gap: S.sm }}>
          <Field
            label="Prénom"
            value={firstName}
            onChangeText={onFirstName}
            maxLength={80}
            autoComplete="off"
            accent={brand.accent}
            disabled={busy || disabled}
          />
          <Field
            label="Téléphone"
            value={phone}
            onChangeText={onPhone}
            placeholder="06 12 34 56 78"
            keyboardType="phone-pad"
            autoComplete="off"
            maxLength={32}
            accent={brand.accent}
            disabled={busy || disabled}
          />
        </View>
      ) : null}
      <ConsentRow
        checked={termsAccepted}
        onPress={() => onTerms(!termsAccepted)}
        label="Le client accepte les conditions du programme de fidélité."
        detail={termsSummary || 'Cumul et utilisation des avantages selon le programme affiché par le restaurant.'}
        required
        accent={brand.accent}
        disabled={busy || disabled}
      />
      {mode === 'phone' ? (
        <StatusCard
          tone={palette.mut}
          title="Offres par SMS · canal non activé"
          body="Aucun accord marketing n’est recueilli pendant le pilote. La carte fidélité reste disponible et indépendante."
        />
      ) : null}
      <Btn
        label={busy ? 'Création…' : 'Créer et afficher le QR'}
        kind="primary"
        accent={brand.accent}
        onAccent={brand.onAccent}
        disabled={busy || disabled || !termsAccepted}
        onPress={onSubmit}
        block
      />
    </View>
  );
}

function ConsentRow({
  checked,
  onPress,
  label,
  detail,
  required,
  accent,
  disabled,
}: {
  checked: boolean;
  onPress: () => void;
  label: string;
  detail: string;
  required?: boolean;
  accent: string;
  disabled?: boolean;
}) {
  const { palette, type } = useTheme();
  const L = useLayout();
  return (
    <Press
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="checkbox"
      selected={checked}
      accessibilityLabel={`${label} ${required ? 'Obligatoire.' : 'Facultatif.'}`}
      style={{
        minHeight: L.touch(58),
        padding: S.md,
        borderRadius: R.ctrl,
        borderWidth: 1,
        borderColor: checked ? withAlpha(accent, 0.65) : palette.line2,
        backgroundColor: checked ? withAlpha(accent, 0.09) : '#111111',
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: S.md,
      }}
      activeStyle={{ backgroundColor: palette.press2 }}
    >
      <View
        style={{
          width: 24,
          height: 24,
          borderRadius: 7,
          marginTop: 1,
          borderWidth: 1.5,
          borderColor: checked ? accent : palette.line,
          backgroundColor: checked ? accent : 'transparent',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text style={{ color: checked ? '#101010' : 'transparent', fontWeight: '900' }}>✓</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[type.strong, { fontSize: L.fs(14.5) }]}>
          {label} {required ? <Text style={{ color: palette.amber }}>*</Text> : null}
        </Text>
        <Text style={[type.mut, { marginTop: 3, lineHeight: L.fs(17) }]}>{detail}</Text>
      </View>
    </Press>
  );
}

function MemberView({
  member,
  program,
  rewards,
  attached,
  brand,
  onAttach,
  onDetach,
  onAnother,
}: {
  member: LoyaltyTicketMember;
  program: LoyaltyProgramView | null;
  rewards: LoyaltyRewardView[];
  attached: boolean;
  brand: Brand;
  onAttach: () => void;
  onDetach: () => void;
  onAnother: () => void;
}) {
  const { sheet, type, palette } = useTheme();
  const L = useLayout();
  return (
    <View style={{ gap: S.lg }}>
      <View
        style={[
          sheet.inset,
          {
            padding: L.sp(S.xl),
            gap: S.lg,
            backgroundColor: withAlpha(brand.accent, 0.08),
            borderColor: withAlpha(brand.accent, 0.34),
          },
        ]}
      >
        <View style={[sheet.between, { alignItems: 'flex-start', gap: S.md, flexWrap: 'wrap' }]}>
          <View style={{ flex: 1, minWidth: 180 }}>
            <Text style={type.eyebrow}>Carte retrouvée</Text>
            <Text style={[type.h1, { marginTop: 5 }]}>{member.alias}</Text>
            {member.maskedPhone ? <Text style={[type.mut, { marginTop: 3 }]}>{member.maskedPhone}</Text> : null}
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={[type.display, { color: brand.accent, fontSize: L.fs(36) }]}>{member.balanceUnits}</Text>
            <Text style={type.mut}>{unitLabel(program, member.balanceUnits)}</Text>
          </View>
        </View>
        {member.status !== 'active' ? (
          <StatusCard tone={palette.red} title="Carte bloquée" body="Aucun gain ni avantage ne peut être enregistré sur cette carte." />
        ) : null}
        <View style={{ flexDirection: 'row', gap: S.sm, flexWrap: 'wrap' }}>
          <Btn
            label={attached ? 'Rattachée au ticket' : 'Rattacher au ticket'}
            kind={attached ? 'positive' : 'primary'}
            accent={brand.accent}
            onAccent={brand.onAccent}
            disabled={member.status !== 'active' || attached}
            onPress={attached ? undefined : onAttach}
            style={{ flexGrow: 1 }}
          />
          {attached ? <Btn label="Détacher" kind="ghost" onPress={onDetach} /> : null}
          <Btn label="Autre carte" kind="quiet" onPress={onAnother} />
        </View>
      </View>

      <View>
        <Text style={type.eyebrow}>Catalogue des avantages</Text>
        <Text style={[type.mut, { marginTop: 4 }]}>Catalogue visible · activation sur ticket bientôt disponible.</Text>
      </View>
      <StatusCard
        tone={palette.amber}
        title="Consommation sécurisée en préparation"
        body="Les points ne sont pas débités tant que l’avantage n’est pas appliqué automatiquement au ticket."
      />
      {rewards.length === 0 ? (
        <StatusCard tone={palette.mut} title="Aucun avantage actif" body="Le gérant peut publier les récompenses depuis le back-office." />
      ) : (
        <View style={{ gap: S.sm }}>
          {rewards.map((reward) => {
            const affordable = member.balanceUnits >= reward.costUnits;
            return (
              <View
                key={reward.id}
                accessible
                accessibilityLabel={`${reward.name}, ${reward.costUnits} ${unitLabel(program, reward.costUnits)}, aperçu non actionnable${affordable ? '' : ', solde insuffisant'}`}
                style={[
                  sheet.inset,
                  {
                    padding: S.md,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: S.md,
                    borderColor: affordable ? palette.line : palette.line2,
                  },
                ]}
              >
                <View
                  style={{
                    width: 42,
                    height: 42,
                    borderRadius: 14,
                    backgroundColor: affordable ? withAlpha(brand.accent, 0.14) : palette.surface2,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Text style={{ color: affordable ? brand.accent : palette.mut, fontSize: 20 }}>★</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[type.strong, { fontSize: L.fs(15) }]}>{reward.name}</Text>
                  {reward.description ? <Text style={[type.mut, { marginTop: 3 }]}>{reward.description}</Text> : null}
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={[type.num, { fontSize: L.fs(17), fontWeight: '800', color: affordable ? brand.accent : palette.mut }]}>
                    {reward.costUnits}
                  </Text>
                  <Text style={[type.mut, { fontSize: L.fs(11.5) }]}>{unitLabel(program, reward.costUnits)}</Text>
                </View>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

function QrHandoff({
  payload,
  deepLinked,
  member,
  brand,
  busy,
  onDone,
}: {
  payload: string;
  deepLinked: boolean;
  member: LoyaltyTicketMember | null;
  brand: Brand;
  busy: boolean;
  onDone: () => void;
}) {
  const { type } = useTheme();
  const L = useLayout();
  return (
    <View style={{ alignItems: 'center', gap: S.lg }}>
      <View style={{ alignItems: 'center' }}>
        <Text style={[type.h1, { textAlign: 'center' }]}>Carte prête</Text>
        <Text style={[type.mut, { marginTop: 5, textAlign: 'center', lineHeight: L.fs(19), maxWidth: 520 }]}>
          {deepLinked
            ? 'Présentez ce QR au client : il ouvre sa carte dans l’application du restaurant. Le secret reste dans le fragment du lien et disparaît de la caisse à la fermeture.'
            : 'Présentez ce QR au client pour qu’il le photographie. Le secret ne sera pas conservé sur la caisse après fermeture.'}
        </Text>
      </View>
      <QrMatrix payload={payload} accent={brand.accent} />
      {member ? (
        <Text style={[type.strong, { textAlign: 'center' }]}>
          {member.alias} · {member.balanceUnits} unité{member.balanceUnits > 1 ? 's' : ''}
        </Text>
      ) : null}
      <Btn
        label={busy ? 'Finalisation…' : 'QR remis au client'}
        kind="primary"
        accent={brand.accent}
        onAccent={brand.onAccent}
        disabled={busy}
        onPress={onDone}
      />
    </View>
  );
}

function QrMatrix({ payload, accent }: { payload: string; accent: string }) {
  const matrix = useMemo(
    () => QRCode.create(payload, { errorCorrectionLevel: 'M' }).modules,
    [payload],
  );
  const moduleSize = 5;
  const rows = Array.from({ length: matrix.size }, (_, row) => row);
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel="QR de la nouvelle carte fidélité"
      style={{
        padding: moduleSize * 4,
        borderRadius: 18,
        backgroundColor: '#ffffff',
        borderWidth: 3,
        borderColor: withAlpha(accent, 0.65),
      }}
    >
      {rows.map((row) => (
        <View key={row} style={{ flexDirection: 'row' }}>
          {rows.map((col) => (
            <View
              key={col}
              style={{
                width: moduleSize,
                height: moduleSize,
                backgroundColor: matrix.get(row, col) ? '#090909' : '#ffffff',
              }}
            />
          ))}
        </View>
      ))}
    </View>
  );
}

function StatusCard({ tone, title, body }: { tone: string; title: string; body: string }) {
  const { palette, type } = useTheme();
  const L = useLayout();
  const textTone = tone === palette.red ? '#ff776b' : tone;
  return (
    <View
      accessible
      role={tone === palette.red ? 'alert' : 'status'}
      accessibilityLiveRegion={tone === palette.red ? 'assertive' : 'polite'}
      style={{
        padding: S.md,
        borderRadius: R.ctrl,
        backgroundColor: withAlpha(tone, 0.09),
        borderWidth: 1,
        borderColor: withAlpha(tone, 0.28),
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: S.sm,
      }}
    >
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: tone, marginTop: 5 }} />
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: FONT, color: textTone, fontSize: L.fs(14), fontWeight: '800' }}>{title}</Text>
        <Text style={[type.mut, { marginTop: 3, lineHeight: L.fs(18), color: palette.text }]}>{body}</Text>
      </View>
    </View>
  );
}
