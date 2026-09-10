import { useTheme } from './theme';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { euros, uuid, type KeyValueStore } from '@sm/client-core';
import { PAYMENT_TENDER_LABELS, type CollectOrderPayment } from '@sm/contracts';
import { S, type Brand } from './theme';
import { Btn, Chip, Overlay, PanelHead, Press } from './ui';
import { useLayout } from './useLayout';
import type { ServerOrderRow } from './service-state';
import { canCollectOrder, clearPaidCollection, collectionRecovery, discardRejectedCollection, isCollectedElsewhere, isCollectionRejected, prepareCollection } from './service-payment';

export interface ServicePaymentActions {
  read: (id: string) => Promise<ServerOrderRow>;
  collect: (row: ServerOrderRow, operation: CollectOrderPayment) => Promise<ServerOrderRow>;
  store: KeyValueStore;
}

function subscribeConnection(onChange: () => void): () => void {
  globalThis.addEventListener?.('online', onChange);
  globalThis.addEventListener?.('offline', onChange);
  return () => { globalThis.removeEventListener?.('online', onChange); globalThis.removeEventListener?.('offline', onChange); };
}
const browserOffline = () => globalThis.navigator?.onLine === false;

/** Le panier reste derrière la vue Service : cette modale ne reçoit aucun port de création. */
export function CollectPaymentModal({ orderId, number, brand, actions, offline: menuOffline, onClose }: {
  orderId: string; number: number; brand: Brand; actions: ServicePaymentActions;
  offline?: boolean; onClose: () => void;
}) {
  const { sheet, type, palette } = useTheme();
  const L = useLayout();
  const disconnected = useSyncExternalStore(subscribeConnection, browserOffline, () => false);
  const offline = menuOffline || disconnected;
  const [row, setRow] = useState<ServerOrderRow | null>(null);
  const [operation, setOperation] = useState<CollectOrderPayment | null>(null);
  const [tender, setTender] = useState<CollectOrderPayment['tender']>('cash');
  const [received, setReceived] = useState(0);
  const [attested, setAttested] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [collectedElsewhere, setCollectedElsewhere] = useState(false);
  const inFlight = useRef(false);
  const mounted = useRef(false);
  const actionsRef = useRef(actions);
  actionsRef.current = actions;
  const paid = row?.payment?.status === 'paid';
  const refunded = row?.payment?.status === 'refunded';
  const locked = busy || !!operation;
  const canClose = !busy && !operation;
  const total = row?.totals?.total ?? 0;
  const selectedTender = operation?.tender ?? tender;
  const cashReceived = operation?.tender === 'cash' ? operation.cashReceivedCents : received;

  const inspect = useCallback(async () => {
    const api = actionsRef.current;
    // Read the durable identity first: a failed network read must not unlock a prior attempt.
    const recovery = await collectionRecovery(api.store, orderId);
    if (mounted.current) setOperation(recovery);
    const current = await api.read(orderId);
    if (!current || current._id !== orderId) throw new Error('La commande reçue ne correspond pas. Aucun encaissement autorisé.');
    if (mounted.current) { setRow(current); setLoaded(true); }
    // GET paid does not prove the audit completed after a lost POST response.
    // A durable operation is retained and safely replayed, even for a paid snapshot.
    return current;
  }, [orderId]);

  useEffect(() => {
    mounted.current = true;
    void inspect().catch((cause: unknown) => {
      if (mounted.current) setError(cause instanceof Error ? cause.message : 'Impossible de vérifier la commande.');
    }).finally(() => { if (mounted.current) setBusy(false); });
    return () => { mounted.current = false; };
  }, [inspect]);

  const refresh = async () => {
    if (inFlight.current || offline) return;
    inFlight.current = true; setBusy(true); setError(null);
    try { await inspect(); }
    catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : 'Vérification indisponible.'); }
    finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  };

  const confirm = async () => {
    if (!row || inFlight.current || busy || offline || (!operation && !canCollectOrder(row))) return;
    if (!operation && (tender === 'cash' ? received < total : !attested)) return;
    inFlight.current = true; setBusy(true); setError(null);
    let attempted = operation;
    try {
      const proposed: CollectOrderPayment = operation ?? (tender === 'cash'
        ? { operationId: uuid(), tender, expectedTotalCents: total, cashReceivedCents: received }
        : { operationId: uuid(), tender, expectedTotalCents: total });
      const durable = await prepareCollection(actionsRef.current.store, orderId, proposed);
      attempted = durable;
      if (mounted.current) setOperation(durable);
      // A competing tab may already have persisted another tender: do not silently adopt it as a new gesture.
      if (durable.operationId !== proposed.operationId) {
        throw new Error('Un encaissement a déjà été commencé sur ce poste. Vérifiez son état sans reprendre le règlement.');
      }
      const confirmed = await actionsRef.current.collect(row, durable);
      if (mounted.current) setRow(confirmed);
      await clearPaidCollection(actionsRef.current.store, confirmed, durable.operationId);
      if (mounted.current) setOperation(null);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Le paiement n’a pas pu être confirmé.';
      try {
        const current = await inspect();
        if (attempted && (isCollectionRejected(cause) || (isCollectedElsewhere(cause) && current.payment?.status === 'paid'))) {
          await discardRejectedCollection(actionsRef.current.store, orderId, attempted.operationId);
          if (mounted.current) { setOperation(null); setAttested(false); }
        }
        if (mounted.current && isCollectedElsewhere(cause)) setCollectedElsewhere(true);
        if (mounted.current) setError(message);
      } catch { if (mounted.current) setError(message); }
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  const close = () => { if (canClose && !inFlight.current) onClose(); };
  return (
    <Overlay onClose={close} accessibilityLabel={`Encaisser la commande ${number}`} width={540} focusKey={paid ? 'paid' : operation ? 'verify' : 'form'}>
      <PanelHead title={!operation && refunded ? 'Commande remboursée' : paid && !operation ? 'Paiement confirmé' : `Encaisser la commande n° ${number}`} sub="Même commande · aucun nouveau ticket" onClose={canClose ? close : undefined} />
      <View style={sheet.hairline} />
      <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ padding: L.sp(S.xl), gap: S.md }}>
        <View style={[sheet.inset, { padding: S.md, gap: S.xs }]}>
          <Text style={type.eyebrow}>{refunded ? 'Montant de la commande remboursée' : paid ? 'Montant réglé' : 'Total vérifié sur le serveur'}</Text>
          <Text style={[type.display, { fontSize: L.fs(34), color: paid ? palette.green : brand.accent }]}>{loaded ? euros(total) : 'Vérification…'}</Text>
          <Text style={type.mut}>{row?.pickup?.customerName ?? `Commande n° ${number}`}</Text>
        </View>
        {refunded && !operation ? <Text accessibilityRole="alert" style={type.strong}>Le serveur confirme que ce paiement a été remboursé. Aucun nouvel encaissement n’est lancé ; faites vérifier la commande par un responsable.</Text> : paid && !operation ? <>
          <Text accessibilityRole="alert" style={type.strong}>Le serveur confirme que cette commande est payée. Ne percevez aucun autre règlement.</Text>
          {row?.payment?.tender === 'cash' && Number.isSafeInteger(row.payment.cashReceived) && Number.isSafeInteger(row.payment.changeGiven) ? (
            <View style={[sheet.inset, { padding: S.md, gap: S.sm }]}>
              <Text style={type.mut}>Reçu · {euros(row.payment.cashReceived!)}</Text>
              <Text style={[type.strong, { color: palette.green }]}>À rendre · {euros(row.payment.changeGiven!)}</Text>
            </View>
          ) : null}
          {collectedElsewhere ? <Text accessibilityRole="alert" style={[type.strong, { color: palette.amber }]}>Déjà encaissée depuis une autre opération. Si vous avez aussi reçu de l’argent, faites contrôler ce doublon par un responsable avant de remettre la commande.</Text> : null}
          <Text style={type.mut}>{row?.status === 'ready' ? 'Vous pourrez ensuite confirmer la remise au client, après lui avoir remis la commande.' : 'La préparation et la remise restent distinctes du paiement.'}</Text>
        </> : <>
          {operation ? <View style={[sheet.inset, { padding: S.md, gap: S.sm }]}>
            <Text accessibilityRole="alert" style={[type.strong, { color: palette.amber }]}>Encaissement à vérifier</Text>
            <Text style={type.body}>Ne reprenez pas l’argent et ne relancez pas le TPE. La reprise enregistre uniquement le règlement déjà constaté, avec la même référence.</Text>
            <Text style={type.mut}>{PAYMENT_TENDER_LABELS[operation.tender]} · {euros(operation.expectedTotalCents)}{operation.tender === 'cash' ? ` · reçu ${euros(operation.cashReceivedCents)}` : ''}</Text>
          </View> : <Text style={type.mut}>Enregistrez le règlement réellement reçu. Ce geste ne crée aucune commande et ne confirme pas sa remise.</Text>}
          {paid && operation ? <Text accessibilityRole="alert" style={type.strong}>Le paiement apparaît déjà reçu. Finalisez uniquement sa vérification ; ne percevez rien de plus.</Text> : loaded && !canCollectOrder(row!) ? <Text accessibilityRole="alert" style={[type.strong, { color: palette.amber }]}>Cette commande n’est pas encaissable au comptoir dans son état actuel. Vérifiez son paiement ou demandez à un responsable.</Text> : null}
          {!operation && loaded && canCollectOrder(row!) ? <>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: S.sm }}>
              {(['cash', 'card', 'meal_voucher'] as const).map((value) => <Chip key={value} label={value === 'card' ? 'Carte · TPE' : PAYMENT_TENDER_LABELS[value]} on={tender === value} accessibilityRole="radio" accent={brand.accent} onAccent={brand.onAccent} disabled={locked} onPress={() => { setTender(value); setAttested(false); }} />)}
            </View>
            {selectedTender === 'cash' ? <>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: S.sm }}>
                {[1000, 2000, 5000].map((cents) => <Btn key={cents} label={`+ ${euros(cents)}`} size="sm" disabled={locked} onPress={() => setReceived((value) => Math.min(100_000_000, value + cents))} />)}
                <Btn label="Compte juste" size="sm" disabled={locked} onPress={() => setReceived(total)} />
              </View>
              <View style={sheet.between}><Text style={type.body}>Reçu · {euros(cashReceived)}</Text><Text style={[type.strong, { color: cashReceived >= total ? palette.green : palette.amber }]}>{cashReceived >= total ? 'À rendre' : 'Reste dû'} · {euros(Math.abs(cashReceived - total))}</Text></View>
              {[['1', '2', '3'], ['4', '5', '6'], ['7', '8', '9'], ['C', '0', '⌫']].map((keys, index) => <View key={index} style={{ flexDirection: 'row', gap: S.sm }}>{keys.map((key) => <Btn key={key} label={key} accessibilityLabel={key === 'C' ? 'Effacer le montant reçu' : key === '⌫' ? 'Corriger le montant reçu' : key} disabled={locked} style={{ flex: 1 }} onPress={() => setReceived((value) => key === 'C' ? 0 : key === '⌫' ? Math.floor(value / 10) : Math.min(100_000_000, value * 10 + Number(key)))} />)}</View>)}
            </> : <>
              <Text style={type.mut}>{selectedTender === 'card' ? 'Effectuez le paiement sur votre terminal de paiement habituel. Cette caisse ne pilote pas le TPE et ne lance aucun paiement Stripe.' : 'Vérifiez que le titre-restaurant couvre la totalité du montant et qu’il a bien été accepté.'}</Text>
              <Press disabled={locked} accessibilityRole="checkbox" selected={attested} onPress={() => setAttested((value) => !value)} accessibilityLabel={selectedTender === 'card' ? 'Confirmer le paiement accepté sur le TPE' : 'Confirmer le titre-restaurant accepté'} style={[sheet.inset, { padding: S.md }]}><Text style={type.strong}>{attested ? '✓ ' : '○ '}{selectedTender === 'card' ? 'Le TPE a confirmé le paiement' : 'Le titre-restaurant a été accepté'}</Text></Press>
            </>}
          </> : null}
        </>}
        {offline ? <Text accessibilityRole="alert" style={[type.mut, { color: palette.amber }]}>Connexion requise : cet encaissement ne peut pas être mis en file hors ligne.</Text> : null}
        {error ? <Text accessibilityRole="alert" style={[type.body, { color: palette.red }]}>{error}</Text> : null}
      </ScrollView>
      <View style={{ padding: L.sp(S.xl), paddingTop: S.sm, gap: S.sm }}>
        {(paid || refunded) && !operation ? <Btn label="Retour à la commande" kind="primary" accent={brand.accent} onAccent={brand.onAccent} onPress={close} block /> : <>
          {(operation || error || !loaded) ? <Btn label={busy ? 'Vérification en cours…' : 'Vérifier le paiement'} onPress={() => void refresh()} disabled={busy || offline} block /> : null}
          {loaded && row && (operation || canCollectOrder(row)) ? <Btn label={busy ? 'Confirmation en cours…' : operation ? 'Reprendre la confirmation du règlement' : `Confirmer ${euros(total)} encaissés`} kind="primary" accent={brand.accent} onAccent={brand.onAccent} onPress={() => void confirm()} disabled={busy || offline || (!operation && (selectedTender === 'cash' ? cashReceived < total : !attested))} block /> : null}
        </>}
      </View>
    </Overlay>
  );
}
