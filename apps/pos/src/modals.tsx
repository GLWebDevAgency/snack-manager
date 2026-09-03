/**
 * Surcouches de la caisse : encaissement espèces, confirmation d'envoi,
 * remise (PIN), aperçu du ticket, clôture de service.
 *
 * Règle commune : aucune de ces vues ne bloque le service. Si la commande
 * n'est pas encore partie de la file offline, on l'explique au lieu d'échouer.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, ScrollView, Text, View } from 'react-native';
import { TOUCH_MIN, euros, palette, type RejectedEntry } from '@sm/client-core';
import { FONT, R, S, TABULAR, sheet, type, withAlpha, type Brand } from './theme';
import { Btn, Chip, EmptyState, Field, Overlay, PanelHead, Press, useReducedMotion } from './ui';
import { useLayout } from './useLayout';
import { MODE_LABEL, PAY_LABEL, type DayEntry, type Mode, type ServiceZ } from './pos-state';
import {
  rejectedSaleAmount,
  rejectedSnapshotIds,
  serviceCloseBlockReason,
  serviceCloseStatus,
} from './pos-safety';
import { depasseLePlafond, plafondRemise, pourcentageParDefaut } from './service-state';

// ─────────────────────────────────────────────────────────────
// V3 · Encaissement espèces
// ─────────────────────────────────────────────────────────────

const BILLS = [500, 1000, 2000, 5000];

export function CashModal({
  total,
  brand,
  onClose,
  onValidate,
}: {
  total: number;
  brand: Brand;
  onClose: () => void;
  onValidate: (received: number, change: number) => void;
}) {
  const L = useLayout();
  const [received, setReceived] = useState(0);
  const change = received - total;
  const rounded = Math.ceil(total / 100) * 100;
  /** Sous 560 px, pavé et afficheur ne tiennent plus côte à côte. */
  const stacked = L.width < 560;

  const digit = (d: string) => setReceived((cur) => Math.min(99_999_99, cur * 10 + Number(d)));

  return (
    <Overlay onClose={onClose} accessibilityLabel="Encaissement espèces" width={460}>
      <PanelHead title="Encaissement espèces" sub={`Total à encaisser · ${euros(total)}`} onClose={onClose} />
      <View style={sheet.hairline} />

      <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ padding: L.sp(S.xl), gap: L.sp(S.lg) }}>
        {/* Coupures rapides */}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: S.sm }}>
          {BILLS.map((b) => (
            <Chip
              key={b}
              label={`+ ${euros(b)}`}
              onPress={() => setReceived((cur) => cur + b)}
              accent={brand.accent}
              onAccent={brand.onAccent}
              minHeight={50}
            />
          ))}
          <Chip label={`Appoint ${euros(rounded)}`} onPress={() => setReceived(rounded)} minHeight={50} />
          <Chip label="Compte juste" onPress={() => setReceived(total)} minHeight={50} />
        </View>

        {/* Saisie libre — l'afficheur passe au-dessus du pavé sur écran étroit */}
        <View style={{ flexDirection: stacked ? 'column-reverse' : 'row', gap: S.md }}>
          <View style={{ flex: 1, gap: 6 }}>
            {[
              ['1', '2', '3'],
              ['4', '5', '6'],
              ['7', '8', '9'],
              ['C', '0', '⌫'],
            ].map((row, i) => (
              <View key={i} style={{ flexDirection: 'row', gap: 6 }}>
                {row.map((k) => (
                  <Press
                    key={k}
                    accessibilityLabel={k === '⌫' ? 'Corriger' : k === 'C' ? 'Effacer' : k}
                    onPress={() => {
                      if (k === 'C') setReceived(0);
                      else if (k === '⌫') setReceived((cur) => Math.floor(cur / 10));
                      else digit(k);
                    }}
                    style={{
                      flex: 1,
                      minHeight: L.touch(TOUCH_MIN + 4),
                      borderRadius: R.ctrl,
                      backgroundColor: palette.surface2,
                      borderWidth: 1,
                      borderColor: palette.line2,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                    activeStyle={{ backgroundColor: '#2b2b2b' }}
                    scale={0.95}
                  >
                    <Text
                      style={{
                        fontFamily: FONT,
                        color: k === 'C' || k === '⌫' ? palette.mut : palette.text,
                        fontSize: L.fs(19),
                        fontWeight: '700',
                      }}
                    >
                      {k}
                    </Text>
                  </Press>
                ))}
              </View>
            ))}
          </View>

          <View style={{ flex: 1, gap: S.sm }}>
            <View style={[sheet.inset, { padding: S.md }]}>
              <Text style={type.eyebrow}>Reçu</Text>
              <Text style={[type.display, { fontSize: L.fs(30), marginTop: 4 }]}>{euros(received)}</Text>
            </View>
            <View
              style={[
                sheet.inset,
                {
                  padding: S.md,
                  flex: 1,
                  justifyContent: 'center',
                  backgroundColor: change >= 0 ? withAlpha(palette.green, 0.14) : palette.surface2,
                  borderColor: change >= 0 ? withAlpha(palette.green, 0.4) : palette.line2,
                },
              ]}
            >
              <Text style={[type.eyebrow, { color: change >= 0 ? palette.green : palette.mut }]}>
                {change >= 0 ? 'À rendre' : 'Reste dû'}
              </Text>
              <Text
                style={[
                  type.display,
                  { fontSize: L.fs(32), marginTop: 4, color: change >= 0 ? palette.green : palette.amber },
                ]}
              >
                {euros(Math.abs(change))}
              </Text>
            </View>
          </View>
        </View>
      </ScrollView>

      {/* La validation reste hors du défilement : elle ne doit jamais être à
          chercher, même sur un petit écran. */}
      <View style={{ paddingHorizontal: L.sp(S.xl), paddingBottom: L.sp(S.xl), paddingTop: S.sm }}>
        <Btn
          label="Valider l'encaissement"
          kind="primary"
          size="lg"
          accent={brand.accent}
          onAccent={brand.onAccent}
          disabled={received < total}
          onPress={() => onValidate(received, change)}
          block
          glyph="✓"
        />
      </View>
    </Overlay>
  );
}

// ─────────────────────────────────────────────────────────────
// V5 · Confirmation d'envoi en cuisine
// ─────────────────────────────────────────────────────────────

export function SentOverlay({
  entry,
  brand,
  synced,
  onClose,
  onPrint,
  onDiscount,
}: {
  entry: DayEntry;
  brand: Brand;
  synced: boolean;
  onClose: () => void;
  onPrint: () => void;
  onDiscount: () => void;
}) {
  const L = useLayout();
  const reduced = useReducedMotion();
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduced) {
      pulse.setValue(1);
      return;
    }
    Animated.timing(pulse, {
      toValue: 1,
      duration: 420,
      easing: Easing.bezier(0.2, 0.8, 0.2, 1),
      useNativeDriver: true,
    }).start();
  }, [pulse, reduced]);

  const number = entry.serverNumber ?? entry.localNumber;

  return (
    <Overlay onClose={onClose} accessibilityLabel="Commande envoyée en cuisine" width={440} dim={0.72}>
      <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ padding: L.sp(28), alignItems: 'center' }}>
        <Animated.View
          style={{
            width: 68,
            height: 68,
            borderRadius: 34,
            backgroundColor: withAlpha(palette.green, 0.16),
            borderWidth: 1.5,
            borderColor: palette.green,
            alignItems: 'center',
            justifyContent: 'center',
            transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] }) }],
          }}
        >
          <Text style={{ fontFamily: FONT, color: palette.green, fontSize: 30, fontWeight: '700' }}>✓</Text>
        </Animated.View>

        <Text style={[type.h1, { marginTop: 16, fontSize: L.fs(22) }]}>Envoyée en cuisine</Text>

        <Text style={[type.eyebrow, { marginTop: 22 }]}>Numéro de retrait</Text>
        <Text
          style={[
            type.display,
            // Le numéro de retrait est lu à travers le comptoir : c'est le
            // premier élément qui doit profiter d'un grand écran.
            { fontSize: L.fs(76), lineHeight: L.fs(84), color: brand.accent, letterSpacing: -3, marginTop: 2 },
          ]}
        >
          {number}
        </Text>

        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            marginTop: 6,
            paddingHorizontal: 12,
            paddingVertical: 7,
            borderRadius: R.pill,
            backgroundColor: synced ? withAlpha(palette.green, 0.12) : withAlpha(palette.amber, 0.12),
          }}
        >
          <View
            style={{
              width: 7,
              height: 7,
              borderRadius: 4,
              backgroundColor: synced ? palette.green : palette.amber,
            }}
          />
          <Text
            style={{
              fontFamily: FONT,
              fontSize: L.fs(13),
              fontWeight: '700',
              color: synced ? palette.green : palette.amber,
              textAlign: 'center',
            }}
          >
            {synced ? 'Confirmée par le serveur' : 'Numéro provisoire · en file de synchronisation'}
          </Text>
        </View>

        <Text style={[type.mut, { marginTop: 14, textAlign: 'center', fontSize: L.fs(14) }]}>
          {MODE_LABEL[entry.mode]} · {euros(entry.total)} ·{' '}
          {entry.paid ? `Payé (${PAY_LABEL[entry.method].toLowerCase()})` : 'À encaisser au retrait'}
        </Text>

        {entry.loyalty ? (
          <View
            style={{
              alignSelf: 'stretch',
              marginTop: 14,
              paddingVertical: 11,
              paddingHorizontal: 14,
              borderRadius: R.ctrl,
              backgroundColor: withAlpha(
                entry.loyalty.state === 'credited'
                  ? palette.green
                  : entry.loyalty.state === 'failed'
                    ? palette.red
                    : palette.amber,
                0.11,
              ),
              borderWidth: 1,
              borderColor: withAlpha(
                entry.loyalty.state === 'credited'
                  ? palette.green
                  : entry.loyalty.state === 'failed'
                    ? palette.red
                    : palette.amber,
                0.3,
              ),
              flexDirection: 'row',
              alignItems: 'center',
              gap: 9,
            }}
          >
            <Text
              style={{
                color:
                  entry.loyalty.state === 'credited'
                    ? palette.green
                    : entry.loyalty.state === 'failed'
                      ? palette.red
                      : palette.amber,
                fontSize: L.fs(17),
              }}
            >
              ★
            </Text>
            <Text
              style={{
                flex: 1,
                fontFamily: FONT,
                color:
                  entry.loyalty.state === 'credited'
                    ? palette.green
                    : entry.loyalty.state === 'failed'
                      ? palette.red
                      : palette.amber,
                fontSize: L.fs(13),
                fontWeight: '700',
                textAlign: 'left',
              }}
            >
              {entry.loyalty.state === 'credited'
                ? 'Fidélité traitée par le serveur'
                : entry.loyalty.state === 'failed'
                  ? 'Fidélité à reprendre manuellement'
                  : entry.loyalty.state === 'queued'
                    ? 'Traitement fidélité sécurisé · envoi en cours'
                    : 'Fidélité en attente de confirmation de la vente'}
            </Text>
          </View>
        ) : null}

        {/* Le rendu de monnaie ne doit pas être un message fugace : il reste
            affiché tant que le caissier n'a pas fermé la confirmation. */}
        {entry.change && entry.change > 0 ? (
          <View
            style={{
              alignSelf: 'stretch',
              marginTop: 16,
              paddingVertical: 12,
              paddingHorizontal: 16,
              borderRadius: R.ctrl,
              backgroundColor: withAlpha(palette.green, 0.14),
              borderWidth: 1,
              borderColor: withAlpha(palette.green, 0.4),
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <Text style={[type.eyebrow, { color: palette.green }]}>À rendre</Text>
            <Text style={[type.display, { fontSize: L.fs(26), color: palette.green }]}>{euros(entry.change)}</Text>
          </View>
        ) : null}

        <View style={{ marginTop: 24, alignSelf: 'stretch', gap: S.sm }}>
          <View style={{ flexDirection: 'row', gap: S.sm }}>
            <Btn label="Ticket client" kind="ghost" size="md" onPress={onPrint} style={{ flex: 1 }} />
            <Btn label="Remise" kind="ghost" size="md" onPress={onDiscount} style={{ flex: 1 }} />
          </View>
          <Btn
            label="Nouvelle commande"
            kind="primary"
            size="lg"
            accent={brand.accent}
            onAccent={brand.onAccent}
            onPress={onClose}
            block
          />
        </View>
      </ScrollView>
    </Overlay>
  );
}

// ─────────────────────────────────────────────────────────────
// Remise — exige la re-saisie d'un PIN (traçabilité NF525)
// ─────────────────────────────────────────────────────────────

/** Les remises proposées en un geste — inchangées, mais désormais situées. */
const REMISE_POURCENTS = [5, 10, 20] as const;

export function DiscountModal({
  entry,
  brand,
  /** Rôle du code ouvert sur ce poste (`Session.staffRole`). */
  staffRole,
  onClose,
  onApply,
}: {
  entry: DayEntry;
  brand: Brand;
  staffRole: string;
  onClose: () => void;
  onApply: (amountCents: number, reason: string, pin: string) => Promise<string | null>;
}) {
  const L = useLayout();
  const [pin, setPin] = useState('');
  const [reason, setReason] = useState('');
  /**
   * LE PLAFOND DU RÔLE, ENFIN LU PAR L'ÉCRAN.
   *
   * `REMISE_PLAFOND_CENTS` et `plafondRemiseLabel` vivent dans `@sm/contracts`
   * depuis que le serveur a cessé d'accepter n'importe quelle remise contre
   * n'importe quel PIN — et aucun client ne les importait. La modale proposait
   * « − 20 % » : sur une commande à 100 €, cela fait 20 €, au-dessus des 15 €
   * qu'autorise un code `caisse`. Le bouton validait, le serveur refusait après
   * coup, et le caissier l'apprenait devant le client.
   *
   * La sélection d'ouverture est donc le pourcentage le plus fort qui tienne
   * SOUS le plafond de la session, au lieu de 10 % au jugé.
   */
  const plafond = useMemo(() => plafondRemise(staffRole), [staffRole]);
  const [percent, setPercent] = useState<number | null>(() =>
    pourcentageParDefaut(entry.total, REMISE_POURCENTS, plafond),
  );
  const [custom, setCustom] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const amount = useMemo(() => {
    if (percent !== null) return Math.round((entry.total * percent) / 100);
    const cents = Math.round(Number(custom.replace(',', '.')) * 100);
    return Number.isFinite(cents) && cents > 0 ? cents : 0;
  }, [custom, entry.total, percent]);

  /**
   * Dépassement = « il faudra le code du gérant », JAMAIS « c'est interdit ».
   *
   * Le serveur juge le rôle du PIN RE-SAISI, pas celui de la session
   * (`orders.controller.ts` : « C'est le PIN re-saisi qui décide, pas la
   * session ouverte »), précisément pour que le gérant puisse venir autoriser
   * un geste sur une tablette ouverte en caisse. Bloquer le bouton ici
   * casserait ce geste-là, qui est le cas normal d'une grosse remise.
   */
  const horsPlafond = depasseLePlafond(amount, plafond);

  const synced = !!entry.serverId;
  /**
   * Le MOTIF est obligatoire, comme il l'est côté serveur.
   *
   * Il ne l'était ni ici ni là-bas : le champ existait, il pouvait rester vide,
   * et la remise partait sans raison. NF525 n'admet pas une minoration de
   * recette sans motif — et six mois plus tard, « −5,00 € » sans un mot
   * n'explique rien à personne, ni au gérant ni au contrôle.
   *
   * La même borne des deux côtés : un écran plus permissif que son API produit
   * un bouton qui valide et un serveur qui refuse.
   */
  const valid =
    synced &&
    amount > 0 &&
    amount <= entry.total &&
    reason.trim().length >= 3 &&
    /^\d{4,6}$/.test(pin);

  return (
    <Overlay onClose={onClose} accessibilityLabel="Appliquer une remise" width={440}>
      <PanelHead
        title="Remise"
        sub={`Commande n° ${entry.serverNumber ?? entry.localNumber} · ${euros(entry.total)}`}
        onClose={onClose}
      />
      <View style={sheet.hairline} />

      {!synced ? (
        <View style={{ padding: S.xl }}>
          <Notice
            tone={palette.amber}
            title="Commande pas encore synchronisée"
            body="Elle attend dans la file offline. La remise est tracée côté serveur (NF525) : elle ne peut être appliquée qu'une fois la commande enregistrée. Réessayez dès le retour du réseau."
          />
          <Btn label="Compris" kind="solid" size="md" onPress={onClose} block style={{ marginTop: S.lg }} />
        </View>
      ) : (
        <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ padding: L.sp(S.xl), gap: L.sp(S.lg) }}>
          <View style={{ gap: S.sm }}>
            <View style={[sheet.between, { gap: S.sm }]}>
              <Text style={type.eyebrow}>Montant</Text>
              {/* Ce que le code ouvert sur ce poste autorise, écrit avant le
                  geste plutôt que découvert dans un refus. */}
              <Text
                style={{
                  fontFamily: FONT,
                  color: palette.mut,
                  fontSize: L.fs(12),
                  fontWeight: '700',
                  textAlign: 'right',
                  flexShrink: 1,
                }}
              >
                Code {staffRole} · {plafond.label}
              </Text>
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: S.sm }}>
              {REMISE_POURCENTS.map((p) => {
                const cents = Math.round((entry.total * p) / 100);
                const trop = depasseLePlafond(cents, plafond);
                return (
                  <Chip
                    key={p}
                    // Le « ! » marque la proposition qui dépassera le plafond de
                    // la session : elle reste offerte — le gérant peut la
                    // valider avec SON code —, elle n'est simplement plus
                    // proposée comme si elle allait de soi.
                    label={trop ? `− ${p} % !` : `− ${p} %`}
                    detail={euros(cents)}
                    on={percent === p}
                    onPress={() => setPercent(p)}
                    accent={brand.accent}
                    onAccent={brand.onAccent}
                  />
                );
              })}
              <Chip label="Montant libre" on={percent === null} onPress={() => setPercent(null)} />
            </View>
            {percent === null ? (
              <Field
                value={custom}
                onChangeText={setCustom}
                placeholder="Montant en euros (ex. 2,50)"
                keyboardType="number-pad"
                accent={brand.accent}
              />
            ) : null}
            {horsPlafond ? (
              <Notice
                tone={palette.amber}
                title={
                  plafond.aucun
                    ? 'Ce code n’autorise aucune remise'
                    : `Au-dessus de ce qu’un code ${staffRole} peut accorder (${plafond.label})`
                }
                body="Le serveur vérifie le rôle du PIN saisi ci-dessous, pas celui de la session : faites taper son code au gérant et la remise passera. Avec un autre code, elle sera refusée."
              />
            ) : null}
          </View>

          <Field
            value={reason}
            onChangeText={setReason}
            label="Motif (obligatoire)"
            placeholder="Geste commercial, plat renversé…"
            accent={brand.accent}
          />

          <Field
            value={pin}
            onChangeText={(v) => setPin(v.replace(/\D/g, '').slice(0, 6))}
            label="PIN du responsable"
            placeholder="••••"
            keyboardType="number-pad"
            accent={brand.accent}
            invalid={!!error}
          />

          {error ? (
            <Text style={{ fontFamily: FONT, color: palette.red, fontSize: L.fs(13.5), fontWeight: '600' }}>
              {error}
            </Text>
          ) : null}

          <View style={[sheet.between, sheet.inset, { padding: S.md }]}>
            <Text style={type.mut}>Nouveau total</Text>
            <Text style={[type.display, { fontSize: L.fs(22), color: brand.accent }]}>
              {euros(entry.total - amount)}
            </Text>
          </View>

          <Btn
            label={
              busy
                ? 'Application…'
                : horsPlafond
                  ? `Appliquer − ${euros(amount)} · code gérant`
                  : `Appliquer − ${euros(amount)}`
            }
            kind="primary"
            size="lg"
            accent={brand.accent}
            onAccent={brand.onAccent}
            disabled={!valid || busy}
            block
            onPress={async () => {
              setBusy(true);
              setError(null);
              const err = await onApply(amount, reason.trim() || 'Geste commercial', pin);
              setBusy(false);
              if (err) {
                setError(err);
                setPin('');
              } else onClose();
            }}
          />
        </ScrollView>
      )}
    </Overlay>
  );
}

// ─────────────────────────────────────────────────────────────
// Aperçu du ticket (GET /public/orders/:id/ticket)
// ─────────────────────────────────────────────────────────────

export interface TicketOption {
  name: string;
  priceDelta: number;
}
export interface TicketLineDto {
  qty: number;
  name: string;
  variantName: string | null;
  options: TicketOption[];
  removed: string[];
  note: string | null;
  unitPrice: number;
  lineTotal: number;
}
export interface OrderTicketDto {
  orderId: string;
  pickupNumber: number;
  header: { tenantName: string; slug: string; address: string; phones: string[] };
  createdAt: string;
  printedAt: string;
  channelLabel: string;
  typeLabel: string;
  statusLabel: string;
  pickup: { slotLabel: string; customerName: string; customerPhone: string | null } | null;
  lines: TicketLineDto[];
  totals: { subtotal: number; discount: { amount: number; reason: string } | null; total: number };
  payment: {
    methodLabel: string;
    /** Moyen réellement encaissé — prime sur `methodLabel` quand il est connu. */
    tenderLabel?: string | null;
    statusLabel: string;
    paid: boolean;
    cashReceived?: number | null;
    changeGiven?: number | null;
  };
  note: string | null;
}

const MONO = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' } as const;

export function TicketPreview({
  entry,
  fetchTicket,
  onClose,
}: {
  entry: DayEntry;
  /** Le jeton de suivi conditionne l'accès : le ticket est nominatif. */
  fetchTicket: (orderId: string, token: string | null | undefined) => Promise<OrderTicketDto>;
  onClose: () => void;
}) {
  const L = useLayout();
  const [ticket, setTicket] = useState<OrderTicketDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const orderId = entry.serverId;
  const token = entry.trackingToken;

  const load = useCallback(async () => {
    if (!orderId) return;
    setError(null);
    try {
      setTicket(await fetchTicket(orderId, token));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ticket indisponible');
    }
  }, [fetchTicket, orderId, token]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Overlay onClose={onClose} accessibilityLabel="Ticket client" width={430}>
      <PanelHead title="Ticket client" sub={`Commande n° ${entry.serverNumber ?? entry.localNumber}`} onClose={onClose} />
      <View style={sheet.hairline} />

      {!orderId ? (
        <View style={{ padding: S.xl }}>
          <Notice
            tone={palette.amber}
            title="Ticket pas encore disponible"
            body="La commande est encore dans la file de synchronisation : le serveur ne lui a pas attribué son numéro définitif. La commande est enregistrée localement et partira dès le retour du réseau — le ticket sera imprimable juste après."
          />
          <Btn label="Fermer" kind="solid" size="md" onPress={onClose} block style={{ marginTop: S.lg }} />
        </View>
      ) : error ? (
        <View style={{ padding: S.xl }}>
          <Notice tone={palette.red} title="Impression impossible" body={error} />
          <View style={{ flexDirection: 'row', gap: S.sm, marginTop: S.lg }}>
            <Btn label="Réessayer" kind="solid" size="md" onPress={() => void load()} style={{ flex: 1 }} />
            <Btn label="Fermer" kind="ghost" size="md" onPress={onClose} style={{ flex: 1 }} />
          </View>
        </View>
      ) : !ticket ? (
        <View style={{ padding: 40 }}>
          <Text style={[type.mut, { textAlign: 'center' }]}>Préparation du ticket…</Text>
        </View>
      ) : (
        <>
          <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ padding: L.sp(S.xl) }}>
            <View style={{ backgroundColor: '#f6f4ef', borderRadius: 6, padding: 18 }}>
              <Paper center bold size={15}>
                {ticket.header.tenantName}
              </Paper>
              {ticket.header.address ? <Paper center>{ticket.header.address}</Paper> : null}
              {ticket.header.phones.map((p) => (
                <Paper center key={p}>
                  {p}
                </Paper>
              ))}
              <Rule />
              <Paper center bold size={26}>
                N° {ticket.pickupNumber}
              </Paper>
              <Paper center>
                {ticket.channelLabel} · {ticket.typeLabel}
              </Paper>
              {ticket.pickup ? (
                <Paper center>
                  Retrait {ticket.pickup.slotLabel} · {ticket.pickup.customerName}
                </Paper>
              ) : null}
              <Rule />
              {ticket.lines.map((line, i) => (
                <View key={i} style={{ marginBottom: 6 }}>
                  <View style={sheet.between}>
                    <Paper bold>{`${line.qty} × ${line.name}`}</Paper>
                    <Paper bold>{euros(line.lineTotal)}</Paper>
                  </View>
                  {line.variantName ? <Paper indent>{line.variantName}</Paper> : null}
                  {line.options.map((o, j) => (
                    <Paper indent key={j}>
                      {o.name}
                      {o.priceDelta ? ` (+${euros(o.priceDelta)})` : ''}
                    </Paper>
                  ))}
                  {line.removed.map((r, j) => (
                    <Paper indent key={`r${j}`}>
                      sans {r}
                    </Paper>
                  ))}
                  {line.note ? <Paper indent>« {line.note} »</Paper> : null}
                </View>
              ))}
              <Rule />
              <View style={sheet.between}>
                <Paper>Sous-total</Paper>
                <Paper>{euros(ticket.totals.subtotal)}</Paper>
              </View>
              {ticket.totals.discount ? (
                <View style={sheet.between}>
                  <Paper>Remise · {ticket.totals.discount.reason}</Paper>
                  <Paper>− {euros(ticket.totals.discount.amount)}</Paper>
                </View>
              ) : null}
              <View style={[sheet.between, { marginTop: 4 }]}>
                <Paper bold size={16}>
                  TOTAL
                </Paper>
                <Paper bold size={16}>
                  {euros(ticket.totals.total)}
                </Paper>
              </View>
              <Rule />
              <Paper center>
                {ticket.payment.tenderLabel ?? ticket.payment.methodLabel} ·{' '}
                {ticket.payment.statusLabel}
              </Paper>
              {typeof ticket.payment.cashReceived === 'number' ? (
                <>
                  <View style={sheet.between}>
                    <Paper>Reçu</Paper>
                    <Paper>{euros(ticket.payment.cashReceived)}</Paper>
                  </View>
                  <View style={sheet.between}>
                    <Paper>Rendu</Paper>
                    <Paper>{euros(ticket.payment.changeGiven ?? 0)}</Paper>
                  </View>
                </>
              ) : null}
              {ticket.note ? <Paper center>Note : {ticket.note}</Paper> : null}
              <Paper center>Merci et à bientôt !</Paper>
            </View>
          </ScrollView>
          <View style={sheet.hairline} />
          <View style={{ padding: S.lg, gap: S.sm }}>
            <Text style={[type.mut, { fontSize: L.fs(12.5) }]}>
              Aperçu fidèle du ticket ESC/POS (42 colonnes). L'envoi à l'imprimante réseau se branche sur ce même
              rendu.
            </Text>
            <Btn label="Fermer" kind="solid" size="md" onPress={onClose} block />
          </View>
        </>
      )}
    </Overlay>
  );
}

function Paper({
  children,
  bold,
  center,
  indent,
  size = 12.5,
}: {
  children: React.ReactNode;
  bold?: boolean;
  center?: boolean;
  indent?: boolean;
  size?: number;
}) {
  return (
    <Text
      style={{
        ...MONO,
        color: '#161310',
        fontSize: size,
        lineHeight: size * 1.5,
        fontWeight: bold ? '700' : '400',
        textAlign: center ? 'center' : 'left',
        paddingLeft: indent ? 14 : 0,
        ...TABULAR,
      }}
    >
      {children}
    </Text>
  );
}

function Rule() {
  return <View style={{ height: 1, backgroundColor: '#c9c3b6', marginVertical: 8 }} />;
}

// ─────────────────────────────────────────────────────────────
// V4 · Clôture de service
// ─────────────────────────────────────────────────────────────

export function CloseModal({
  entries,
  z,
  pending,
  rejected,
  pendingLoyalty,
  busy,
  offline,
  brand,
  staffName,
  onClose,
  onCloseService,
  onOpenTicket,
  onOpenDiscount,
}: {
  entries: DayEntry[];
  /** Ventilation du service par moyen de paiement — le cœur du Z. */
  z: ServiceZ;
  pending: number;
  rejected: number;
  pendingLoyalty: number;
  busy: boolean;
  offline: boolean;
  brand: Brand;
  staffName: string;
  onClose: () => void;
  onCloseService: () => void;
  onOpenTicket: (entry: DayEntry) => void;
  onOpenDiscount: (entry: DayEntry) => void;
}) {
  const L = useLayout();
  const [tab, setTab] = useState<'recap' | 'orders'>('recap');
  const closeSafety = {
    saleInFlight: busy,
    offline,
    pendingSync: pending,
    rejectedSync: rejected,
    pendingLoyalty,
  };
  const closeBlocked = serviceCloseBlockReason(closeSafety) !== null;
  const closeStatus = serviceCloseStatus(closeSafety);

  const counts = useMemo(() => {
    const byMode = (m: Mode) => entries.filter((e) => e.mode === m).length;
    return { surplace: byMode('surplace'), emporter: byMode('emporter'), tel: byMode('tel') };
  }, [entries]);

  /**
   * AUCUN MONTANT DE CE Z N'EST UN TOTAL QUAND LA FENÊTRE EST COUPÉE.
   *
   * Le serveur plafonne `GET /orders` à 200 lignes, les plus récentes, et le
   * dit. Au-delà, tout ce qui est calculé ici — chiffre d'affaires, espèces,
   * carte, titres-restaurant — porte sur une fenêtre amputée de ses lignes les
   * plus anciennes. On préfixe donc chaque montant par « ≥ », exactement comme
   * le back-office préfixe ses compteurs de statut : un chiffre et une borne
   * inférieure ne se lisent pas pareil, et c'est toute la différence entre
   * recompter son tiroir et croire qu'on l'a recompté.
   */
  const somme = (cents: number) => (z.partial ? `≥ ${euros(cents)}` : euros(cents));

  return (
    <Overlay onClose={onClose} accessibilityLabel="Clôture de service" width={560}>
      <PanelHead
        title="Clôture de service"
        sub={`${z.partial ? '≥ ' : ''}${z.orders} commande${z.orders > 1 ? 's' : ''} · poste 1 · ${staffName}`}
        onClose={onClose}
      />

      <View style={{ flexDirection: 'row', gap: S.sm, paddingHorizontal: S.xl, paddingBottom: S.md }}>
        <Chip label="Récapitulatif" on={tab === 'recap'} onPress={() => setTab('recap')} accent={brand.accent} onAccent={brand.onAccent} />
        <Chip
          label={`Commandes · ${entries.length}`}
          on={tab === 'orders'}
          onPress={() => setTab('orders')}
          accent={brand.accent}
          onAccent={brand.onAccent}
        />
      </View>
      <View style={sheet.hairline} />

      {tab === 'recap' ? (
        <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ padding: L.sp(S.xl), gap: S.md }}>
          {/*
            LE PLAFOND DE 200 COMMANDES, DIT AVANT LES CHIFFRES.
            Il vient d'abord parce qu'il change la nature de tout ce qui suit :
            ce ne sont plus des totaux, ce sont des minima.
          */}
          {z.partial ? (
            <Notice
              tone={palette.red}
              title="Ce Z est incomplet"
              body={`Le serveur ne renvoie que les 200 commandes les plus récentes : ${z.missing} commande${z.missing > 1 ? 's' : ''} plus ancienne${z.missing > 1 ? 's ne sont pas comptées' : ' n’est pas comptée'} ci-dessous. Chaque montant est donc un MINIMUM. Recoupez la journée depuis le back-office avant de clôturer.`}
            />
          ) : null}

          <View
            style={[
              sheet.inset,
              sheet.between,
              { padding: S.lg, gap: S.md },
              // Sur un écran étroit, le chiffre d'affaires passe SOUS son
              // intitulé : tronqué à « 70,… », il ne sert plus à rien.
              L.width < 620 ? { flexDirection: 'column', alignItems: 'flex-start' } : null,
            ]}
          >
            <View style={{ flexShrink: 1 }}>
              <Text style={type.eyebrow}>Chiffre d'affaires</Text>
              <Text style={[type.mut, { marginTop: 3, fontSize: L.fs(12.5) }]}>
                {z.partial
                  ? `Fenêtre plafonnée à 200 commandes sur ${z.orders + z.missing} — minimum, pas un total`
                  : z.source === 'server'
                    ? 'Commandes enregistrées — vente en ligne comprise'
                    : 'Hors ligne : journal de ce poste seul, sans la vente en ligne'}
              </Text>
            </View>
            <Text
              numberOfLines={1}
              style={[
                type.display,
                { fontSize: L.fs(32), color: z.partial ? palette.amber : brand.accent },
              ]}
            >
              {somme(z.ca)}
            </Text>
          </View>

          {/* Ce que le gérant recoupe réellement le soir : le tiroir, le
              bordereau du TPE, ce qui est déjà tombé sur le compte, le reste dû. */}
          <View style={{ gap: 2 }}>
            <StatRow label="Espèces" value={somme(z.cash)} />
            <StatRow label="Carte bancaire" value={somme(z.card)} />
            <StatRow label="Titres-restaurant" value={somme(z.mealVoucher)} />
            <StatRow label="En ligne" value={somme(z.online)} />
            <StatRow label="À encaisser au retrait" value={somme(z.due)} tone={palette.amber} />
            {/*
              Encaissé au retrait, sans moyen saisi. Ce n'est pas une anomalie
              de données : c'est ce que la cuisine encaisse en marquant
              « Remis », sans que personne ait dit comment le client a payé. Le
              montant est réel et doit être ventilé à la main.
            */}
            {z.unspecified > 0 ? (
              <StatRow
                label="Encaissé au retrait — à ventiler"
                value={somme(z.unspecified)}
                tone={palette.amber}
              />
            ) : null}
            {z.discounts > 0 ? (
              <StatRow label="Remises accordées" value={`− ${somme(z.discounts)}`} tone={palette.green} />
            ) : null}
          </View>

          <View style={[sheet.inset, { padding: S.md, flexDirection: 'row', justifyContent: 'space-between' }]}>
            <Counter label="Sur place" value={counts.surplace} />
            <Counter label="À emporter" value={counts.emporter} />
            <Counter label="Téléphone" value={counts.tel} />
          </View>

          <View
            accessibilityLiveRegion="polite"
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10,
              paddingHorizontal: 14,
              paddingVertical: 12,
              borderRadius: R.ctrl,
              backgroundColor: closeBlocked
                ? withAlpha(palette.amber, 0.1)
                : withAlpha(palette.green, 0.1),
            }}
          >
            <View
              style={{
                width: 8,
                height: 8,
                borderRadius: 4,
                backgroundColor: closeBlocked ? palette.amber : palette.green,
              }}
            />
            <Text
              style={{
                fontFamily: FONT,
                color: closeBlocked ? palette.amber : palette.green,
                fontSize: L.fs(13.5),
                fontWeight: '600',
                flex: 1,
              }}
            >
              {closeStatus}
            </Text>
          </View>

          <View style={{ flexDirection: 'row', gap: S.sm, marginTop: S.xs }}>
            <Btn label="Continuer le service" kind="ghost" size="md" onPress={onClose} style={{ flex: 1 }} />
            <Btn
              label="Clôturer le service"
              kind="primary"
              size="md"
              accent={brand.accent}
              onAccent={brand.onAccent}
              // Un service ne comptant que des commandes en ligne se clôture
              // aussi : le journal local est vide, la caisse ne l'est pas.
              disabled={z.orders === 0 || closeBlocked}
              onPress={onCloseService}
              style={{ flex: 1 }}
            />
          </View>
        </ScrollView>
      ) : (
        <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ padding: L.sp(S.lg) }}>
          {entries.length === 0 ? (
            <EmptyState title="Aucune commande sur ce service" sub="Le journal se remplit à chaque envoi en cuisine." />
          ) : (
            [...entries]
              .sort((a, b) => b.at - a.at)
              .map((e) => <OrderRow key={e.clientId} entry={e} onTicket={onOpenTicket} onDiscount={onOpenDiscount} />)
          )}
        </ScrollView>
      )}
    </Overlay>
  );
}

function OrderRow({
  entry,
  onTicket,
  onDiscount,
}: {
  entry: DayEntry;
  onTicket: (e: DayEntry) => void;
  onDiscount: (e: DayEntry) => void;
}) {
  const L = useLayout();
  const time = new Date(entry.at);
  const hm = `${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}`;
  return (
    <View
      style={[
        sheet.inset,
        {
          padding: S.md,
          marginBottom: S.sm,
          flexDirection: 'row',
          alignItems: 'center',
          gap: S.md,
          // Sur un écran étroit la ligne se replie au lieu d'écraser le montant.
          flexWrap: 'wrap',
        },
      ]}
    >
      <View style={{ width: L.sp(52) }}>
        <Text style={[type.display, { fontSize: L.fs(20) }]}>{entry.serverNumber ?? entry.localNumber}</Text>
        <Text style={[type.mut, { fontSize: L.fs(12) }]}>{hm}</Text>
      </View>
      <View style={{ flex: 1, minWidth: 120 }}>
        <Text style={[type.strong, { fontSize: L.fs(15) }]}>
          {MODE_LABEL[entry.mode]} · {entry.items} art.
        </Text>
        <Text style={[type.mut, { fontSize: L.fs(12.5), marginTop: 2 }]}>
          {PAY_LABEL[entry.method]}
          {entry.serverId ? '' : ' · en file'}
          {entry.discount ? ` · remise ${euros(entry.discount)}` : ''}
        </Text>
        {entry.loyalty ? (
          <Text
            style={[
              type.mut,
              {
                fontSize: L.fs(12),
                marginTop: 2,
                color:
                  entry.loyalty.state === 'credited'
                    ? palette.green
                    : entry.loyalty.state === 'failed'
                      ? palette.red
                      : palette.amber,
              },
            ]}
          >
            ★ Fidélité ·{' '}
            {entry.loyalty.state === 'credited'
              ? 'traitée'
              : entry.loyalty.state === 'failed'
                ? 'à reprendre'
                : 'en cours'}
          </Text>
        ) : null}
      </View>
      <Text style={[type.num, { fontSize: L.fs(16), fontWeight: '800' }]}>
        {euros(entry.total - (entry.discount ?? 0))}
      </Text>
      <View style={{ flexDirection: 'row', gap: 6 }}>
        <MiniAction label="Ticket" onPress={() => onTicket(entry)} />
        <MiniAction label="Remise" onPress={() => onDiscount(entry)} />
      </View>
    </View>
  );
}

function MiniAction({ label, onPress }: { label: string; onPress: () => void }) {
  const L = useLayout();
  return (
    <Press
      onPress={onPress}
      accessibilityLabel={label}
      style={{
        minHeight: L.touch(),
        paddingHorizontal: 12,
        justifyContent: 'center',
        borderRadius: R.pill,
        borderWidth: 1,
        borderColor: palette.line,
      }}
      activeStyle={{ backgroundColor: '#262626' }}
    >
      <Text style={{ fontFamily: FONT, color: palette.text, fontSize: L.fs(13), fontWeight: '600' }}>{label}</Text>
    </Press>
  );
}

function StatRow({ label, value, tone }: { label: string; value: string; tone?: string }) {
  const L = useLayout();
  return (
    <View
      style={[sheet.between, { paddingVertical: L.sp(11), borderBottomWidth: 1, borderBottomColor: palette.line2 }]}
    >
      <Text style={[type.mut, { fontSize: L.fs(14) }]}>{label}</Text>
      <Text style={[type.num, { fontSize: L.fs(15), fontWeight: '700', color: tone ?? palette.text }]}>{value}</Text>
    </View>
  );
}

function Counter({ label, value }: { label: string; value: number }) {
  const L = useLayout();
  return (
    <View style={{ alignItems: 'center', flex: 1 }}>
      <Text style={[type.display, { fontSize: L.fs(22) }]}>{value}</Text>
      <Text style={[type.mut, { fontSize: L.fs(12.5), marginTop: 2, textAlign: 'center' }]}>{label}</Text>
    </View>
  );
}

export function Notice({ tone, title, body }: { tone: string; title: string; body: string }) {
  const L = useLayout();
  return (
    <View
      style={{
        borderRadius: R.ctrl,
        borderWidth: 1,
        borderColor: withAlpha(tone, 0.35),
        backgroundColor: withAlpha(tone, 0.1),
        padding: S.lg,
        gap: 6,
      }}
    >
      <Text style={{ fontFamily: FONT, color: tone, fontSize: L.fs(14.5), fontWeight: '700' }}>{title}</Text>
      <Text style={{ fontFamily: FONT, color: palette.mut, fontSize: L.fs(13.5), lineHeight: L.fs(19) }}>{body}</Text>
    </View>
  );
}

/**
 * LES VENTES REFUSÉES — l'écran qui manquait.
 *
 * Un refus définitif du serveur (produit supprimé, commande déjà servie…)
 * retirait l'entrée de la file offline et la JETAIT. Le raisonnement était juste
 * — rejouer ne changerait rien, et bloquer la file arrêterait le service — mais
 * retirer SANS TRACE ne l'est pas.
 *
 * Sur une commande déjà encaissée, l'argent est dans le tiroir et le client est
 * parti avec son ticket : la vente n'existe alors nulle part, et rien ne dit
 * laquelle. Le Z du soir tombe faux sans qu'on sache pourquoi.
 *
 * Cet écran montre ce qui a été refusé, avec le motif du serveur et le montant,
 * pour que le gérant puisse ressaisir. L'acquittement est un geste EXPLICITE :
 * un rejet qui s'efface tout seul ramène le défaut qu'on répare.
 */
export function RejetsModal({
  rejets,
  entries,
  brand,
  onClose,
  onAcquitter,
}: {
  rejets: readonly RejectedEntry[];
  entries: readonly DayEntry[];
  brand: Brand;
  onClose: () => void;
  onAcquitter: (ids: readonly string[]) => void;
}) {
  const heure = (ms: number) =>
    new Date(ms).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const idsAffiches = useMemo(() => rejectedSnapshotIds(rejets), [rejets]);

  /** Le prix client local, car le corps refusé ne transporte aucun montant. */
  const montant = (rejected: RejectedEntry): string => {
    const amount = rejectedSaleAmount(rejected, entries);
    return amount === null ? '—' : euros(amount);
  };

  return (
    <Overlay onClose={onClose} accessibilityLabel="Ventes refusées par le serveur" width={520}>
      <PanelHead
        title="Ventes refusées par le serveur"
        sub={`${rejets.length} à traiter`}
        onClose={onClose}
      />
      {/*
        DÉFILANT, comme la clôture. `Overlay` borne la hauteur à 94 % de
        l'écran sans zone de défilement : vingt rejets y seraient comprimés, et
        le bouton d'acquittement sortirait de la vue — sur une tablette de
        comptoir, un bouton hors écran est un bouton qui n'existe pas.
      */}
      <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ padding: S.lg, gap: S.md }}>
      <Paper>
        Ces mutations ont été refusées définitivement : les rejouer ne changerait
        rien. Si l&apos;une d&apos;elles était encaissée, l&apos;encaissement a bien eu lieu —
        ressaisissez la vente pour que le Z du soir tombe juste.
      </Paper>

      <View style={{ gap: S.sm, marginTop: S.lg }}>
        {rejets.map((r) => (
          <View
            key={r.id}
            style={{
              borderWidth: 1,
              borderColor: withAlpha(palette.red, 0.3),
              backgroundColor: withAlpha(palette.red, 0.08),
              borderRadius: R.card,
              padding: S.lg,
              gap: 4,
            }}
          >
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: S.sm }}>
              <Text style={{ fontFamily: FONT, color: palette.red, fontWeight: '800', fontSize: 15 }}>
                {montant(r)}
              </Text>
              <Text style={{ fontFamily: FONT, color: palette.mut, fontSize: 13 }}>
                {heure(r.at)} · {r.status}
              </Text>
            </View>
            {/* Le motif vient du serveur : sa longueur n'est pas bornée, et
                une phrase de dix lignes chasserait les rejets suivants. */}
            <Text
              numberOfLines={3}
              style={{ fontFamily: FONT, color: palette.text, fontSize: 13, lineHeight: 18 }}
            >
              {r.reason}
            </Text>
            <Text numberOfLines={1} style={{ fontFamily: FONT, color: palette.mut, fontSize: 12 }}>
              {r.path}
            </Text>
          </View>
        ))}
      </View>

      <Btn
        label="J'ai traité ces ventes"
        kind="solid"
        size="md"
        onPress={() => onAcquitter(idsAffiches)}
        block
        style={{ marginTop: S.lg }}
      />
      </ScrollView>
    </Overlay>
  );
}
