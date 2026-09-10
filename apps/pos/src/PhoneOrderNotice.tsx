import { useTheme } from './theme';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { euros } from '@sm/client-core';
import { S, type Brand } from './theme';
import { Btn, Overlay, PanelHead } from './ui';
import type { PhoneOrderAttempt, PhoneOrderReceipt } from './phone-order-attempt';

/** Présent même lorsqu'un autre ticket est ouvert : la reprise ne le remplace pas. */
export function PhoneOrderNotice({ attempt, error, busy, brand, onResume, onAbandon, onRelease, onFinish }: {
  attempt: PhoneOrderAttempt | null; error: string | null; busy: boolean; brand: Brand;
  onResume: () => void; onAbandon: () => void; onRelease: () => void; onFinish: () => void;
}) {
  const { palette, type } = useTheme();
  const [confirmAbandon, setConfirmAbandon] = useState(false);
  if (!attempt && !error) return null;
  const received = attempt?.state === 'received';
  const rejected = attempt?.state === 'rejected';
  return <View style={{ backgroundColor: palette.surface2, borderBottomWidth: 1, borderColor: palette.line,
    paddingHorizontal: S.lg, paddingVertical: S.md, gap: S.sm }}>
    <Text accessibilityRole="alert" style={[type.strong, { color: received ? palette.green : palette.amber }]}>
      {received ? `Commande n° ${attempt.receipt.number} confirmée · journal à finaliser`
        : rejected ? 'Réservation non créée · vous pouvez corriger le ticket'
          : attempt ? 'Commande téléphone · confirmation à vérifier' : 'Commande téléphone non confirmée'}
    </Text>
    {attempt ? <Text style={type.mut}>{attempt.body.pickup.customerName} · retrait {new Intl.DateTimeFormat('fr-FR', {
      timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    }).format(new Date(attempt.body.pickup.slot))}{received ? ` · ${euros(attempt.receipt.totalCents)}` : ''}</Text> : null}
    <Text style={type.mut}>{rejected ? attempt.rejection.message : received
      ? 'La commande existe déjà. Terminez uniquement son enregistrement local ; ne la ressaisissez pas.'
      : 'Ne promettez pas ce créneau et ne percevez aucun règlement avant la confirmation du serveur. Le ticket actuellement ouvert est conservé.'}</Text>
    {error ? <Text accessibilityRole="alert" style={[type.mut, { color: palette.amber }]}>{error}</Text> : null}
    {attempt ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: S.sm }}>
      <Btn label={busy ? 'Vérification…' : received ? 'Finaliser le journal' : rejected ? 'Corriger le ticket' : 'Reprendre la confirmation'}
        kind="primary" size="sm" accent={brand.accent} onAccent={brand.onAccent} disabled={busy}
        onPress={received ? onFinish : rejected ? onRelease : onResume} />
      {!received && !rejected ? <Btn label={confirmAbandon ? 'Confirmer l’abandon de cette tentative' : 'Abandonner cette tentative'}
        size="sm" disabled={busy} onPress={() => { if (confirmAbandon) onAbandon(); else setConfirmAbandon(true); }} /> : null}
      {confirmAbandon && !received && !rejected ? <Text style={type.mut}>Le serveur vérifiera d’abord si la commande existe. Aucun effacement local anticipé.</Text> : null}
    </View> : null}
  </View>;
}

export function PhoneOrderConfirmed({ receipt, brand, onClose, onCollect }: {
  receipt: PhoneOrderReceipt; brand: Brand; onClose: () => void; onCollect: () => void;
}) {
  const { type, sheet } = useTheme();
  const canCollect = receipt.payment.status === 'pending' && ['new', 'preparing', 'ready'].includes(receipt.status);
  return <Overlay onClose={onClose} accessibilityLabel="Réservation téléphone confirmée" width={480}>
    <PanelHead title={receipt.status === 'cancelled' ? 'Commande annulée' : 'Créneau confirmé'} sub="État confirmé par le restaurant" onClose={onClose} />
    <View style={{ padding: S.xl, gap: S.md }}>
      <Text style={[type.display, { color: brand.accent, fontSize: 42 }]}>N° {receipt.number}</Text>
      <Text style={type.strong}>Retrait {new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(receipt.slot))}</Text>
      <View style={sheet.between}><Text style={type.body}>Total confirmé</Text><Text style={[type.h2, { color: brand.accent }]}>{euros(receipt.totalCents)}</Text></View>
      <Text style={type.mut}>{canCollect ? 'La commande est réservée. Aucun règlement n’a été enregistré.'
        : receipt.payment.status === 'paid' ? 'Cette commande a déjà été payée. Ne percevez aucun nouveau règlement.' : 'Consultez le service pour vérifier l’état actuel de cette commande.'}</Text>
      {canCollect ? <Btn label="Encaisser maintenant" kind="primary" accent={brand.accent} onAccent={brand.onAccent} onPress={onCollect} block /> : null}
      <Btn label={canCollect ? 'À payer au retrait' : 'Retour à la caisse'} onPress={onClose} block />
    </View>
  </Overlay>;
}
