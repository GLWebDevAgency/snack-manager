import { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { euros, readCounterRefundIntents, uuid, type CounterRefundLocalIntent } from '@sm/client-core';
import type { CounterRefundIntent, CounterRefundJournal, CounterRefundOperationView } from '@sm/contracts';
import { Btn, Field, Overlay, PanelHead, Press } from './ui';
import { S, useTheme, type Brand } from './theme';
import { useCounterRefund } from './useCounterRefund';
import type { CounterRefundAccess } from './counter-refund';

function cents(value: string) {
  if (!/^\d{1,7}(?:[,.]\d{1,2})?$/.test(value.trim())) return null;
  const [whole, fraction = ''] = value.trim().replace(',', '.').split('.');
  const amount = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(amount) && amount <= 100_000_000 ? amount : null;
}
const bodyOf = (operation: CounterRefundOperationView): CounterRefundIntent => ({ operationId: operation.operationId, amountCents: operation.amountCents,
  reason: operation.reason, tender: operation.tender, allocation: operation.allocation });

export function CounterRefundModal({ orderId, access, offline, brand, onClose, onChanged, onJournal }: {
  orderId: string; access: CounterRefundAccess; offline: boolean; brand: Brand; onClose: () => void; onChanged?: () => void; onJournal?: (view: CounterRefundJournal) => void;
}) {
  const state = useCounterRefund(orderId, access, offline), { type, sheet, palette, semanticText } = useTheme();
  const [merchandise, setMerchandise] = useState(''), [delivery, setDelivery] = useState('0'), [reason, setReason] = useState('');
  const [secret, setSecret] = useState(''), [attested, setAttested] = useState(false), [resolutionReason, setResolutionReason] = useState('');
  const [resolve, setResolve] = useState<CounterRefundOperationView | null>(null);
  useEffect(() => { setSecret(''); setAttested(false); }, [state.clearInputs]);
  const view = state.journal, local = state.pending;
  useEffect(() => { if (view) onJournal?.(view); }, [view, onJournal]);
  const operation = local ? view?.operations.find(op => op.operationId === local.body.operationId) : undefined;
  const owner = access.role === 'owner' && access.ownerId.includes(':user:');
  const locked = state.busy || state.loading || state.offline;
  const authorized = owner ? secret.length > 0 && secret.length <= 1024 : /^\d{4,6}$/.test(secret);
  const goods = cents(merchandise), shipping = cents(delivery);
  const amount = goods !== null && shipping !== null ? goods + shipping : null;
  const resumable = view?.operations.filter(op => op.canResume && ['prepared', 'started'].includes(op.state)) ?? [];
  const validDraft = Boolean(view?.enabled && view.available && view.tender && !local && !resumable.length && !state.blocked && !state.error
    && amount && goods !== null && goods <= view.remaining.merchandiseCents && shipping !== null && shipping <= view.remaining.deliveryCents && amount <= view.remainingCents
    && reason.trim().length >= 3 && reason.trim().length <= 200 && view.operations.length < 128);
  const selectedResolution = resolve ?? (local?.phase === 'no_effect_requested' ? operation : undefined);
  const supersededResolution = local?.phase === 'no_effect_requested' && operation && ['confirmed', 'withdrawn', 'not_executed'].includes(operation.state);
  const canStart = operation?.state === 'prepared' && operation.canResume && local && ['prepared', 'start_requested'].includes(local.phase);
  const canWithdraw = local && ['prepared', 'withdraw_requested'].includes(local.phase) && (!operation || operation.state === 'prepared') && !state.blocked;
  const canConfirm = operation?.state === 'started' && operation.canResume && local && !['withdraw_requested', 'no_effect_requested'].includes(local.phase);
  function close() { if (!state.busy) { onChanged?.(); onClose(); } }
  async function action(step: Parameters<typeof state.act>[0], body?: CounterRefundIntent, resolution?: string) {
    const credential = secret; setSecret(''); setAttested(false); await state.act(step, credential, body, resolution); onChanged?.();
  }
  return <Overlay accessibilityLabel="Remboursement comptoir" onClose={close} width={560} focusKey={`${operation?.state ?? 'new'}:${state.permission ?? ''}`}>
    <PanelHead title="Remboursement comptoir" sub="Espèces ou TPE · connexion requise" onClose={close} />
    <ScrollView contentContainerStyle={{ padding: S.lg, gap: S.md }}>
      <Text style={type.mut}>Ce parcours enregistre un remboursement effectué au comptoir. Il n’envoie aucun remboursement à Stripe ni au terminal bancaire.</Text>
      {state.error ? <Text accessibilityRole="alert" style={{ ...type.mut, color: semanticText.danger }}>{state.error}</Text> : null}
      {state.feedback ? <Text accessibilityRole="alert" style={{ ...type.strong, color: semanticText.positive }}>{state.feedback}</Text> : null}
      {state.processingWarning ? <Text style={type.mut}>{state.processingWarning}</Text> : null}
      {state.offline ? <Text accessibilityRole="alert" style={type.mut}>Hors connexion : aucun nouveau geste de remboursement n’est autorisé. La demande reste sauvegardée.</Text> : null}
      <Btn label={state.loading ? 'Vérification…' : 'Vérifier le remboursement'} kind="ghost" disabled={locked} onPress={() => void state.refresh()} />
      {view ? <View style={[sheet.inset, { padding: S.md, gap: S.sm }]}>
        <Text style={type.strong}>{view.tender === 'cash' ? 'Encaissement en espèces' : view.tender === 'card' ? 'Encaissement par carte au TPE' : 'Moyen de paiement non confirmé'}</Text>
        <Text style={type.mut}>{`Encaissé ${euros(view.originalPaidCents)} · remboursé ${euros(view.refundedCents)} · réservé ${euros(view.pendingRefundCents)}`}</Text>
        <Text style={type.strong}>{`Disponible : ${euros(view.remainingCents)}`}</Text>
        {!view.available ? <Text accessibilityRole="alert" style={type.mut}>La preuve de paiement ou de remboursement ne permet pas de poursuivre. Faites vérifier cette commande par un responsable.</Text> : null}
        {!view.enabled ? <Text accessibilityRole="alert" style={type.mut}>Les nouveaux remboursements comptoir ne sont pas ouverts. Les dossiers existants restent consultables.</Text> : null}
      </View> : null}
      {state.blocked ? <Text accessibilityRole="alert" style={type.mut}>Une demande de cette commande appartient à un autre équipier. Reconnectez cet équipier ou faites examiner le dossier par un propriétaire.</Text> : null}
      {!local && !resumable.length && !state.blocked && view?.available && view.enabled && !selectedResolution && !state.feedback ? <View style={{ gap: S.md }}>
        <Text style={type.eyebrow}>Montant à rembourser</Text>
        <Field label="Part produits (€)" value={merchandise} onChangeText={setMerchandise} maxLength={10} disabled={locked} />
        {view.basis.deliveryCents > 0 ? <Field label="Part livraison (€)" value={delivery} onChangeText={setDelivery} maxLength={10} disabled={locked} /> : null}
        <Text style={type.mut}>{`Plafonds : produits ${euros(view.remaining.merchandiseCents)} · livraison ${euros(view.remaining.deliveryCents)}`}</Text>
        <Field label="Motif du remboursement" value={reason} onChangeText={setReason} maxLength={200} disabled={locked} multiline />
        <Text style={type.strong}>{`Total : ${amount === null ? 'à compléter' : euros(amount)}`}</Text>
      </View> : null}
      {!local && !state.blocked ? resumable.map(op => <Btn key={op.operationId}
        label={`Reprendre la demande enregistrée de ${euros(op.amountCents)}`} kind="ghost" disabled={locked}
        onPress={() => void state.adopt(op.operationId)} />) : null}
      {local ? <View style={[sheet.inset, { padding: S.md, gap: S.sm }]}>
        <Text style={type.strong}>{`Demande sauvegardée · ${euros(local.body.amountCents)}`}</Text>
        <Text style={type.mut}>{`${local.body.reason} · produits ${euros(local.body.allocation.merchandiseCents)} · livraison ${euros(local.body.allocation.deliveryCents)}`}</Text>
        {(!operation || local.phase === 'start_requested' && operation.state === 'prepared') ? <Text accessibilityRole="alert" style={type.mut}>La réponse reste à vérifier. Ne rendez pas d’argent tant que l’autorisation n’est pas affichée ici.</Text> : null}
      </View> : null}
      {state.permission && canConfirm ? <View style={[sheet.inset, { padding: S.md, gap: S.sm }]}>
        <Text accessibilityRole="alert" style={{ ...type.strong, color: semanticText.warning }}>{local!.body.tender === 'cash'
          ? `Rendez une seule fois ${euros(local!.body.amountCents)} en espèces, puis confirmez le geste ci-dessous.`
          : `Effectuez une seule fois le remboursement de ${euros(local!.body.amountCents)} sur le TPE, puis attendez sa confirmation.`}</Text>
        <Text style={type.mut}>Cette autorisation disparaît en quittant la page ou à son expiration. Ne recommencez jamais un geste dont le résultat est incertain.</Text>
      </View> : operation?.state === 'started' ? <Text accessibilityRole="alert" style={{ ...type.strong, color: semanticText.warning }}>Un remboursement a été autorisé. Ne rendez pas une seconde fois l’argent. Confirmez uniquement le geste déjà effectué ; si vous ne pouvez pas le vérifier, faites intervenir un propriétaire.</Text> : null}
      {canConfirm && !selectedResolution ? <Press accessibilityRole="checkbox" accessibilityLabel="Le remboursement a bien été effectué" selected={attested} disabled={locked}
        onPress={() => setAttested(value => !value)} style={[sheet.inset, { padding: S.md, minHeight: 48 }]}>
        <Text style={type.strong}>{`${attested ? '☑' : '☐'} ${local!.body.tender === 'cash' ? 'Les espèces ont réellement été rendues au client.' : 'Le TPE a confirmé le remboursement, sans opération encore en attente.'}`}</Text>
      </Press> : null}
      {selectedResolution && !supersededResolution ? <View style={{ gap: S.md }}>
        <Text style={type.strong}>{`Décision propriétaire · ${euros(selectedResolution.amountCents)}`}</Text>
        <Text style={type.mut}>Confirmez qu’aucune somme n’a été rendue et qu’aucun remboursement TPE ne reste en cours. Une incertitude ne permet pas de libérer ce montant.</Text>
        <Field label="Motif de la décision" value={local?.phase === 'no_effect_requested' ? local.resolutionReason! : resolutionReason}
          onChangeText={setResolutionReason} maxLength={200} multiline disabled={locked || local?.phase === 'no_effect_requested'} />
        <Press accessibilityRole="checkbox" accessibilityLabel="Aucune somme rendue et aucun remboursement TPE en cours" selected={attested} disabled={locked}
          onPress={() => setAttested(value => !value)} style={[sheet.inset, { padding: S.md, minHeight: 48 }]}><Text style={type.strong}>{`${attested ? '☑' : '☐'} J’ai vérifié l’absence de tout remboursement.`}</Text></Press>
      </View> : null}
      {(validDraft || local || selectedResolution) && !state.feedback ? <Field label={owner ? 'Mot de passe du propriétaire' : 'PIN du responsable qui autorise ce remboursement'}
        value={secret} onChangeText={setSecret} secureTextEntry autoComplete="off" autoCorrect={false} autoCapitalize="none" maxLength={owner ? 1024 : 6} disabled={locked} /> : null}
      {!selectedResolution && validDraft ? <Btn label="Préparer le remboursement" kind="primary" accent={brand.accent} onAccent={brand.onAccent} disabled={locked || !authorized}
        onPress={() => void action('prepare', { operationId: uuid(), amountCents: amount!, reason: reason.trim(), tender: view!.tender!, allocation: { version: 1, merchandiseCents: goods!, deliveryCents: shipping! } })} /> : null}
      {!selectedResolution && local?.phase === 'prepared' && !operation ? <Btn label="Reprendre la préparation" disabled={locked || !authorized || !view?.enabled} onPress={() => void action('prepare')} /> : null}
      {!selectedResolution && canStart ? <Btn label={local!.phase === 'start_requested' ? 'Vérifier l’autorisation du geste' : 'Autoriser le geste de remboursement'} kind="primary" accent={brand.accent} onAccent={brand.onAccent}
        disabled={locked || !authorized || !view?.enabled} onPress={() => void action('start')} /> : null}
      {!selectedResolution && canConfirm ? <Btn label="Enregistrer le remboursement effectué" kind="primary" accent={brand.accent} onAccent={brand.onAccent}
        disabled={locked || !authorized || !attested} onPress={() => void action('confirm')} /> : null}
      {!selectedResolution && canWithdraw ? <Btn label="Fermer la demande sans rembourser" kind="ghost" disabled={locked || !authorized} onPress={() => void action('withdraw')} /> : null}
      {selectedResolution && !supersededResolution ? <Btn label="Confirmer qu’aucun remboursement n’a eu lieu" kind="primary" accent={brand.accent} onAccent={brand.onAccent}
        disabled={locked || !owner || !authorized || !attested || (local?.resolutionReason ?? resolutionReason).trim().length < 3}
        onPress={() => void action('no-effect', bodyOf(selectedResolution), local?.resolutionReason ?? resolutionReason.trim())} /> : null}
      {supersededResolution ? <><Text style={type.mut}>Une décision définitive existe déjà pour cette demande. Vérifiez son résultat ci-dessous avant de fermer votre décision locale.</Text>
        <Btn label="Fermer cette décision" kind="ghost" disabled={locked} onPress={() => void state.closeDecision()} /></> : null}
      {owner && view?.canResolveNoEffect && !selectedResolution ? view.operations.filter(op => op.state === 'started' && op.disburseExpiresAt
        && Date.parse(op.disburseExpiresAt) <= Date.parse(view.observedAt)).map(op => <Btn key={op.operationId}
        label={`Examiner l’absence de remboursement de ${euros(op.amountCents)}`} kind="ghost" disabled={locked} onPress={() => { setResolve(op); setAttested(false); setSecret(''); }} />) : null}
      {view?.operations.some(op => ['confirmed', 'withdrawn', 'not_executed'].includes(op.state)) ? <View style={{ gap: S.sm }}>
        <Text style={type.eyebrow}>Décisions enregistrées</Text>
        {view.operations.filter(op => ['confirmed', 'withdrawn', 'not_executed'].includes(op.state)).map(op => <Text key={op.operationId} style={type.mut}>
          {`${euros(op.amountCents)} · ${op.state === 'confirmed' ? 'Remboursement attesté' : op.state === 'withdrawn' ? 'Demande retirée' : 'Aucun remboursement effectué'} · ${op.reason}`}
        </Text>)}
      </View> : null}
      <Text style={{ ...type.mut, color: palette.mut }}>Fermer cette fenêtre conserve toute demande non confirmée pour la reprendre depuis le poste.</Text>
    </ScrollView>
  </Overlay>;
}

export function CounterRefundRecoveries({ access, onSelect, revision = 0 }: { access: CounterRefundAccess; onSelect: (id: string) => void; revision?: number }) {
  const [pending, setPending] = useState<CounterRefundLocalIntent[]>([]), [error, setError] = useState<string | null>(null);
  const { type } = useTheme();
  useEffect(() => { let alive = true;
    const read = () => { void readCounterRefundIntents(access.client.tenantStore, access.ownerId).then(value => { if (alive) { setPending(value); setError(null); } }, () => { if (alive) setError('Le journal des remboursements doit être vérifié avant tout effacement du poste.'); }); };
    read(); globalThis.addEventListener?.('focus', read); globalThis.addEventListener?.('storage', read);
    return () => { alive = false; globalThis.removeEventListener?.('focus', read); globalThis.removeEventListener?.('storage', read); };
  }, [access, revision]);
  if (!pending.length && !error) return null;
  return <View style={{ padding: S.md, gap: S.sm }}>
    {error ? <Text accessibilityRole="alert" style={type.mut}>{error}</Text> : null}
    {Array.from(new Map(pending.map(intent => [intent.orderId, intent])).values()).map(intent => <Btn key={intent.orderId} label={`Reprendre le remboursement de ${euros(intent.body.amountCents)}`} kind="ghost" onPress={() => onSelect(intent.orderId)} />)}
  </View>;
}
