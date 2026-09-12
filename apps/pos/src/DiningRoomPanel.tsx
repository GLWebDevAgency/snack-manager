import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { euros, uuid } from '@sm/client-core';
import { ORDER_STATUS_LABELS, type DiningTable } from '@sm/contracts';
import { Icon } from './Icon';
import { Btn, Field, Overlay, PanelHead, Press } from './ui';
import { FONT, R, S, useTheme, type Brand } from './theme';
import { useLayout } from './useLayout';
import { canCollectOrder } from './service-payment';
import { canConfirmCounterHandover, isCounterHandoverRole } from './service-handover';
import type { ServerOrderRow } from './service-state';
import type { DiningController } from './useDining';
import { canReleaseDiningSession } from './dining-state';

export function DiningRoomPanel({ dining, brand, role, onCompose, onCollect, onHandover }: {
  dining: DiningController; brand: Brand; role: string;
  onCompose: (id: string) => void; onCollect: (row: ServerOrderRow) => void;
  onHandover: (row: ServerOrderRow) => Promise<unknown>;
}) {
  const { palette, type, sheet, semanticText } = useTheme();
  const L = useLayout();
  const [opening, setOpening] = useState<DiningTable | null>(null);
  const [guests, setGuests] = useState('2');
  const [transfer, setTransfer] = useState(false);
  const [closing, setClosing] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [handoverBusy, setHandoverBusy] = useState(false);
  const canManage = isCounterHandoverRole(role);
  const blocked = !canManage || !dining.ready || dining.busy || !!dining.pending || dining.stale;
  const session = dining.session;
  const orders = dining.details?.session.id === session?.id ? dining.details?.orders ?? [] : [];
  const free = (dining.room?.tables ?? []).filter((table) => table.active && !(dining.room?.sessions ?? []).some((item) => item.tableId === table.id && item.state === 'open'));
  const complete = canReleaseDiningSession(session, dining.details?.session.id === session?.id ? orders : null);
  const due = orders.filter((row) => row.status !== 'cancelled' && row.payment?.status === 'pending');
  const dueKnown = due.every((row) => Number.isSafeInteger(row.totals?.total));

  async function act(work: () => Promise<unknown>, done?: () => void) {
    setLocalError(null);
    try { await work(); done?.(); } catch (e) { setLocalError(e instanceof Error ? e.message : 'Opération non confirmée.'); }
  }
  const recovery = dining.pending && dining.pending.action !== 'order' ? <Btn label="Vérifier cette opération" icon="refresh" kind="solid"
    disabled={dining.busy || dining.ownerMismatch} onPress={() => void act(() => dining.execute(dining.pending!),
      () => { setOpening(null); setTransfer(false); setClosing(false); })} /> : null;
  return <View style={{ flex: 1, minWidth: 0, backgroundColor: palette.bg }}>
    <ScrollView contentContainerStyle={{ padding: L.sp(L.compact ? 16 : 28), gap: L.sp(20) }}>
      <View style={[sheet.between, { gap: S.md, flexWrap: 'wrap' }]}>
        <View style={{ gap: S.sm }}><Text accessibilityRole="header" style={type.h1}>La salle</Text>
          <Text style={type.mut}>Les tables et leurs commandes, de l’accueil au règlement.</Text></View>
        <Btn label="Actualiser la salle" icon="refresh" kind="solid" onPress={() => void dining.refresh()} disabled={dining.busy} />
      </View>
      {dining.stale ? <Text accessibilityRole="alert" style={{ fontFamily: FONT, color: semanticText.warning }}>
        {dining.readAt ? 'Données de salle anciennes. Actualisez avant de modifier une table.' : 'La salle doit être confirmée par le serveur avant toute action.'}
      </Text> : <Text style={type.mut}>Situation actualisée · {dining.room?.sessions.length ?? 0} table(s) occupée(s)</Text>}
      {dining.error || localError ? <Text accessibilityRole="alert" style={{ fontFamily: FONT, color: semanticText.danger }}>{localError ?? dining.error}</Text> : null}
      {dining.room?.tables.length === 0 ? <View style={[sheet.card, { padding: L.sp(24), gap: S.md }]}>
        <Icon name="table" size={32} color={palette.mut} /><Text style={type.h2}>Préparez votre salle</Text>
        <Text style={type.body}>Ajoutez vos tables dans les réglages du restaurant, rubrique Salle. Elles apparaîtront ici après actualisation.</Text>
      </View> : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: L.sp(12) }}>
        {dining.room?.tables.filter((table) => table.active || dining.room?.sessions.some((item) => item.tableId === table.id)).map((table) => {
          const occupation = dining.room?.sessions.find((item) => item.tableId === table.id && item.state === 'open');
          const selected = occupation?.id === dining.selectedId;
          return <Press key={table.id} accessibilityLabel={`${table.label}, ${occupation ? `occupée, ${occupation.guestCount} couverts` : `libre, ${table.seats} places`}`}
            onPress={() => { setLocalError(null); if (occupation) dining.selectSession(occupation.id); else { setGuests(String(Math.min(2, table.seats))); setOpening(table); } }}
            disabled={!occupation && blocked} selected={selected}
            style={{ width: L.compact ? '47%' : 188, minHeight: L.touch(154), padding: L.sp(18), borderRadius: R.card, gap: L.sp(12), borderWidth: selected ? 2 : 1,
              borderColor: selected ? brand.accent : palette.line2, backgroundColor: palette.surface }}>
            <View style={sheet.between}><Icon name="table" size={28} color={occupation ? brand.accent : palette.mut} /><Text style={{ fontFamily: FONT, fontSize: 12, color: occupation ? palette.text : semanticText.positive }}>{occupation ? 'Occupée' : 'Libre'}</Text></View>
            <Text style={type.h2}>{table.label}</Text><Text style={type.mut}>{occupation ? `${occupation.guestCount} couverts · ${occupation.orderIds.length} ticket(s)` : `${table.seats} places`}</Text>
          </Press>;
        })}
      </View>
      {session ? <View style={[sheet.card, { padding: L.sp(20), gap: L.sp(18) }]}>
        <View style={[sheet.between, { gap: S.md, flexWrap: 'wrap' }]}>
          <View style={{ gap: 4 }}><Text accessibilityRole="header" style={type.h2}>{session.tableLabel}</Text><Text style={type.mut}>{session.guestCount} couverts · {session.state === 'closed' ? 'Tablée clôturée' : 'Tablée ouverte'}</Text></View>
          <Btn label="Ajouter des plats" icon="plus" kind="primary" accent={brand.accent} onAccent={brand.onAccent} disabled={blocked || session.state !== 'open'} onPress={() => onCompose(session.id)} />
        </View>
        {!dining.details ? <Text style={type.mut}>Lecture des commandes…</Text> : orders.length === 0 ? <Text style={type.body}>Aucun ticket envoyé. Composez la première commande de cette table.</Text> : orders.map((row) => <View key={row._id} style={{ paddingVertical: L.sp(14), gap: S.md, borderTopWidth: 1, borderTopColor: palette.line2 }}>
          <View style={[sheet.between, { gap: S.md, flexWrap: 'wrap' }]}>
            <View style={{ gap: 4 }}><Text style={type.strong}>Commande #{row.number}</Text><Text style={type.mut}>{row.dining?.servedAt ? 'Servie à table' : ORDER_STATUS_LABELS[row.status as keyof typeof ORDER_STATUS_LABELS] ?? row.status} · {row.payment?.status === 'paid' ? 'Payée' : row.payment?.status === 'pending' ? 'À encaisser' : row.payment?.status}</Text></View>
            <Text style={[type.strong, { fontVariant: ['tabular-nums'] }]}>{Number.isSafeInteger(row.totals?.total) ? euros(row.totals!.total!) : 'Montant à vérifier'}</Text>
          </View>
          {row.lines?.map((line, index) => <View key={`${row._id}-${index}`} style={{ gap: 4 }}>
            <Text style={type.body}>{line.qty} × {line.name}{line.variantName ? ` · ${line.variantName}` : ''}</Text>
            {line.options?.length || line.removed?.length ? <Text style={type.mut}>{[...(line.options ?? []).map((option) => option.name), ...(line.removed ?? []).map((name) => `sans ${name}`)].join(' · ')}</Text> : null}
            {line.note ? <Text style={[type.body, { color: semanticText.warning }]}>{line.note}</Text> : null}
          </View>)}
          {row.note ? <Text style={[type.body, { color: semanticText.warning }]}>{row.note}</Text> : null}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: S.sm }}>
            {row.status === 'ready' && !row.dining?.servedAt && ['pending', 'paid'].includes(row.payment?.status ?? '') ? <Btn label={`Confirmer le service #${row.number}`} icon="table" kind="primary" accent={brand.accent} onAccent={brand.onAccent} disabled={blocked}
              onPress={() => void act(() => dining.execute({ action: 'serve', sessionId: session.id, orderId: row._id, body: { operationId: uuid() } }))} /> : null}
            {canCollectOrder(row) ? <Btn label={`Encaisser #${row.number}`} icon="card" onPress={() => onCollect(row)} disabled={blocked} /> : null}
            {row.dining?.servedAt && canConfirmCounterHandover(row) ? <Btn label={`Terminer le ticket #${row.number}`} icon="check" disabled={blocked || handoverBusy}
              onPress={() => { setHandoverBusy(true); void act(() => onHandover(row), () => void dining.refresh()).finally(() => setHandoverBusy(false)); }} /> : null}
          </View>
        </View>)}
        {session.pendingOperationCount > 0 ? <Text accessibilityRole="alert" style={{ fontFamily: FONT, color: semanticText.warning }}>{session.pendingOperationCount} envoi(s) en cours de confirmation. La table reste occupée.</Text> : null}
        <View style={[sheet.between, { paddingTop: L.sp(14), borderTopWidth: 1, borderTopColor: palette.line2 }]}><Text style={type.body}>Reste à encaisser</Text><Text style={[type.h1, { fontVariant: ['tabular-nums'] }]}>{dining.details && dueKnown ? euros(due.reduce((sum, row) => sum + row.totals!.total!, 0)) : 'À vérifier'}</Text></View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: S.sm }}>
          <Btn label="Changer de table" icon="arrow" kind="solid" disabled={blocked || session.state !== 'open' || free.length === 0} onPress={() => setTransfer(true)} />
          <Btn label="Libérer la table" icon="check" kind="ghost" disabled={blocked || !complete || session.state !== 'open'} onPress={() => setClosing(true)} />
        </View>
        {!complete && session.state === 'open' ? <Text style={type.mut}>La table pourra être libérée après confirmation de tous les envois, règlements et remises.</Text> : null}
      </View> : null}
    </ScrollView>
    {opening ? <Overlay width={460} accessibilityLabel="Ouvrir une tablée" onClose={() => { if (!dining.busy) setOpening(null); }}>
      <PanelHead title={opening.label} sub={`${opening.seats} places`} onClose={() => { if (!dining.busy) setOpening(null); }} />
      <View style={{ padding: L.sp(24), gap: S.lg }}>
        <Field label="Nombre de couverts" value={guests} onChangeText={setGuests} keyboardType="number-pad" />
        <Btn label="Ouvrir la tablée" kind="primary" accent={brand.accent} onAccent={brand.onAccent} disabled={blocked || !/^[1-9]\d?$|^100$/.test(guests)}
          onPress={() => void act(() => dining.execute({ action: 'open', body: { operationId: uuid(), tableId: opening.id, guestCount: Number(guests) } }), () => setOpening(null))} />
        {localError || dining.error ? <Text accessibilityRole="alert" style={{ color: semanticText.danger }}>{localError ?? dining.error}</Text> : null}
        {recovery}
        <Btn label="Fermer" disabled={dining.busy} onPress={() => setOpening(null)} />
      </View>
    </Overlay> : null}
    {transfer && session ? <Overlay width={500} accessibilityLabel="Changer de table" onClose={() => { if (!dining.busy) setTransfer(false); }}>
      <PanelHead title="Changer de table" sub="La tablée et ses commandes restent liées." onClose={() => { if (!dining.busy) setTransfer(false); }} />
      <ScrollView contentContainerStyle={{ padding: L.sp(20), gap: S.md }}>{free.map((table) => <Btn key={table.id} label={`${table.label} · ${table.seats} places`} disabled={blocked}
        onPress={() => void act(() => dining.execute({ action: 'transfer', sessionId: session.id, body: { operationId: uuid(), expectedRevision: session.revision, tableId: table.id } }), () => setTransfer(false))} />)}</ScrollView>
      <View style={{ padding: L.sp(20), gap: S.sm }}>{localError ? <Text accessibilityRole="alert" style={{ color: semanticText.danger }}>{localError}</Text> : null}{recovery}<Btn label="Fermer" disabled={dining.busy} onPress={() => setTransfer(false)} /></View>
    </Overlay> : null}
    {closing && session ? <Overlay width={460} accessibilityLabel="Libérer la table" onClose={() => { if (!dining.busy) setClosing(false); }}>
      <PanelHead title={`Libérer ${session.tableLabel} ?`} sub="Les commandes restent dans l’historique du restaurant." onClose={() => { if (!dining.busy) setClosing(false); }} />
      <View style={{ padding: L.sp(24), gap: S.md }}><Btn label="Confirmer la libération" kind="primary" accent={brand.accent} onAccent={brand.onAccent} disabled={blocked || !complete}
        onPress={() => void act(() => dining.execute({ action: 'close', sessionId: session.id, body: { operationId: uuid(), expectedRevision: session.revision } }), () => setClosing(false))} />
        {localError ? <Text accessibilityRole="alert" style={{ color: semanticText.danger }}>{localError}</Text> : null}
        {recovery}
        <Btn label="Annuler" disabled={dining.busy} onPress={() => setClosing(false)} /></View>
    </Overlay> : null}
  </View>;
}
