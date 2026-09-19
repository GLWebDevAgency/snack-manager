import { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { readDeliveryAssignments, type DeliveryAssignmentOperation } from '@sm/client-core';
import { Btn, Overlay, PanelHead, Press } from './ui';
import { R, S, withAlpha, type Brand, useTheme } from './theme';
import { useLayout } from './useLayout';
import { useDeliveryAssignment, type DeliveryAssignmentAccess } from './useDeliveryAssignment';

export function DeliveryAssignmentPanel({ missionId, access, offline: menuOffline, brand, recoveryOnly = false }: {
  missionId: string; access: DeliveryAssignmentAccess; offline: boolean; brand: Brand; recoveryOnly?: boolean;
}) {
  const state = useDeliveryAssignment(missionId, access, menuOffline);
  const offline = state.offline;
  const { type, palette, sheet, semanticText } = useTheme();
  const L = useLayout();
  const mission = state.mission;
  const locked = offline || state.loading || state.busy || !!state.pending || !!state.error;
  const canChoose = !recoveryOnly && mission?.orderStatus === 'ready' && mission.canAssign && !mission.operator && !mission.dispatchedAt;
  return <View style={[sheet.inset, { padding: S.md, gap: S.sm }]}>
    <View style={[sheet.between, { gap: S.sm, flexWrap: 'wrap' }]}>
      <Text style={type.eyebrow}>Livreur</Text>
      <Btn label={state.loading ? 'Actualisation…' : 'Actualiser les livreurs'} kind="ghost" size="sm"
        disabled={offline || state.loading || state.busy} onPress={() => void state.refresh()} />
    </View>
    {mission?.operator ? <>
      <Text style={[type.strong, { fontSize: L.fs(17) }]}>{mission.operator.name}</Text>
      <Text style={type.mut}>{mission.orderStatus === 'delivered' ? 'Livraison terminée.'
        : mission.orderStatus === 'cancelled' ? 'Commande annulée.'
        : mission.dispatchedAt ? 'Livraison en route.' : 'Affecté à cette commande. Le départ reste à confirmer par le livreur ou depuis le back-office.'}</Text>
    </> : <Text style={type.mut}>{mission?.orderStatus === 'delivered' ? 'Livraison terminée.'
      : mission?.orderStatus === 'cancelled' ? 'Commande annulée.'
      : mission?.dispatchedAt ? 'Livraison en route.'
      : mission && mission.orderStatus !== 'ready'
      ? 'Le choix du livreur sera disponible lorsque la cuisine aura terminé la préparation.'
      : state.loading && !mission ? 'Vérification de la commande et des livreurs…' : 'Choisissez un livreur pour cette commande prête.'}</Text>}
    {state.pending ? <View style={{ gap: S.sm }}>
      <Text style={[type.strong, { color: semanticText.warning }]}>Affectation à vérifier</Text>
      <Text style={type.mut}>{state.pending.ownerId === access.ownerId
        ? 'La réponse précédente doit être vérifiée avant une nouvelle affectation. La même référence sera utilisée.'
        : 'L’équipier ayant commencé cette affectation doit se reconnecter pour la vérifier.'}</Text>
      <Btn label={state.busy ? 'Vérification…' : 'Vérifier l’affectation'} kind="primary" block
        accent={brand.accent} onAccent={brand.onAccent}
        disabled={offline || state.loading || state.busy || state.pending.ownerId !== access.ownerId}
        onPress={() => void state.resume()} />
    </View> : null}
    {canChoose && !state.pending ? <View style={{ gap: S.sm }}>
      <Text style={type.mut}>Les commandes en attente peuvent être regroupées dans une tournée avant le départ.</Text>
      {!state.loading && !state.error && !state.nextCursor && state.operators.length === 0
        ? <Text style={type.strong}>Aucun livreur disponible pour le moment.</Text> : null}
      {state.operators.map(operator => {
        const selected = state.selection === operator.id;
        return <Press key={operator.id} accessibilityRole="radio"
          accessibilityLabel={`Choisir le livreur ${operator.name}`}
          selected={selected}
          disabled={locked || operator.departedCount > 0} onPress={() => state.setSelection(operator.id)}
          style={{ minHeight: L.sp(60), padding: L.sp(12), borderRadius: R.ctrl, borderWidth: 2,
            borderColor: selected ? brand.accent : palette.line,
            backgroundColor: selected ? withAlpha(brand.accent, 0.08) : palette.surface,
            opacity: locked ? 0.6 : 1, flexDirection: 'row', alignItems: 'center', gap: S.sm }}>
          <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
            <Text style={type.strong}>{operator.name}</Text>
            <Text style={type.mut}>{operator.assignedCount === 0 ? 'Aucune commande en attente'
              : `${operator.assignedCount} commande${operator.assignedCount > 1 ? 's' : ''} en attente de départ`}</Text>
          </View>
          <Text style={[type.strong, { color: selected ? brand.accent : palette.mut }]}>{selected ? '✓' : '○'}</Text>
        </Press>;
      })}
      {state.nextCursor ? <Btn label="Charger plus de livreurs" kind="ghost" block disabled={locked} onPress={() => void state.more()} /> : null}
      <Btn label={state.busy ? 'Affectation en cours…' : 'Confirmer l’affectation'} kind="primary" block
        accent={brand.accent} onAccent={brand.onAccent} disabled={locked || !state.selection} onPress={() => void state.assign()} />
      <Text style={type.mut}>Cette action affecte la commande ; elle ne confirme pas le départ.</Text>
    </View> : null}
    {offline ? <Text style={[type.mut, { color: semanticText.warning }]}>Connexion requise pour affecter un livreur.</Text> : null}
    {state.error ? <Text accessibilityRole="alert" style={[type.mut, { color: semanticText.danger }]}>{state.error}</Text> : null}
    {state.feedback ? <Text accessibilityLiveRegion="polite" style={[type.strong, { color: palette.text }]}>{state.feedback}</Text> : null}
  </View>;
}

/** Recovery remains reachable even if an order has left the active service list. */
export function DeliveryAssignmentRecoveries({ access, offline, brand }: {
  access: DeliveryAssignmentAccess; offline: boolean; brand: Brand;
}) {
  const [pending, setPending] = useState<DeliveryAssignmentOperation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const { type, sheet } = useTheme();
  useEffect(() => {
    let alive = true;
    const load = () => { void readDeliveryAssignments(access.client.tenantStore).then(rows => {
      if (alive) { setPending(rows); setError(null); }
    }, () => { if (alive) setError('Une référence d’affectation est illisible. Conservez les données du poste et faites-la vérifier.'); }); };
    load(); const timer = setInterval(load, 3000);
    return () => { alive = false; clearInterval(timer); };
  }, [access.client, access.ownerId]);
  if (!pending.length && !error && !selected) return null;
  return <>
    <View style={[sheet.inset, { margin: S.md, padding: S.md, gap: S.sm }]}>
      <Text style={type.strong}>Affectations à vérifier</Text>
      {error ? <Text accessibilityRole="alert" style={type.mut}>{error}</Text> : null}
      {pending.map((operation, index) => <Btn key={operation.missionId}
        label={operation.ownerId === access.ownerId ? `Vérifier l’affectation ${index + 1}` : 'Affectation à reprendre par l’équipier précédent'}
        disabled={operation.ownerId !== access.ownerId} kind="ghost" block onPress={() => setSelected(operation.missionId)} />)}
    </View>
    {selected ? <Overlay accessibilityLabel="Affectation à vérifier" width={520} onClose={() => setSelected(null)}>
      <PanelHead title="Affectation à vérifier" onClose={() => setSelected(null)} />
      <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ padding: S.md }}>
        <DeliveryAssignmentPanel key={`${access.ownerId}:${selected}`} missionId={selected} access={access} offline={offline} brand={brand} recoveryOnly />
      </ScrollView>
    </Overlay> : null}
  </>;
}
