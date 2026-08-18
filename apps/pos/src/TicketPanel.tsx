/**
 * Panneau ticket (zone D) — 384 px fixes à droite de l'écran.
 *
 * C'est la colonne que le caissier regarde en permanence : hiérarchie franche
 * (nom en gras, options en second niveau gris), total en très grande graisse
 * accent, boutons d'encaissement pleine largeur en pied fixe.
 */
import { useEffect, useRef, useState } from 'react';
import { ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { cartTotal, euros, TOUCH_MIN, type CartLine } from '@sm/client-core';
import { FONT, R, S, TICKET_W, palette, sheet, type, withAlpha, type Brand } from './theme';
import { MODE_LABEL, lineDetail, pickupSlots, type Mode } from './pos-state';
import { Btn, Chip, EmptyState, Field, Press, Stepper } from './ui';

export function TicketPanel({
  lines,
  mode,
  brand,
  note,
  onNote,
  customerName,
  onCustomerName,
  customerPhone,
  onCustomerPhone,
  slotIso,
  onSlot,
  onQty,
  onEdit,
  onPark,
  onClear,
  onPay,
  busy,
}: {
  lines: CartLine[];
  mode: Mode;
  brand: Brand;
  note: string;
  onNote: (v: string) => void;
  customerName: string;
  onCustomerName: (v: string) => void;
  customerPhone: string;
  onCustomerPhone: (v: string) => void;
  slotIso: string | null;
  onSlot: (iso: string) => void;
  onQty: (lineId: string, qty: number) => void;
  onEdit: (line: CartLine) => void;
  onPark: () => void;
  onClear: () => void;
  onPay: (method: 'cb' | 'especes' | 'retrait') => void;
  busy: boolean;
}) {
  const { width: screenW } = useWindowDimensions();
  // 384 px sur la tablette cible ; on resserre plutôt que d'étouffer la grille
  // sur un écran plus étroit.
  const panelWidth = screenW < 1120 ? 320 : TICKET_W;
  const subtotal = cartTotal(lines);
  const count = lines.reduce((n, l) => n + l.qty, 0);
  const phoneOk = customerName.trim().length > 0 && customerPhone.replace(/\D/g, '').length >= 8;
  const canSend = lines.length > 0 && (mode !== 'tel' || phoneOk) && !busy;
  const slots = pickupSlots();

  return (
    <View
      style={{
        width: panelWidth,
        backgroundColor: palette.surface,
        borderLeftWidth: 1,
        borderLeftColor: palette.line,
      }}
    >
      {/* En-tête */}
      <View style={[sheet.between, { paddingHorizontal: S.lg, paddingVertical: S.md, gap: S.sm }]}>
        <View style={{ flex: 1 }}>
          <Text style={type.eyebrow}>Ticket</Text>
          <Text style={[type.h2, { marginTop: 2 }]}>{MODE_LABEL[mode]}</Text>
        </View>
        {lines.length > 0 ? (
          <View style={[sheet.row, { gap: 6 }]}>
            <TextAction label="En attente" tone={palette.amber} onPress={onPark} />
            <ConfirmAction label="Vider" confirmLabel="Confirmer ?" tone={palette.red} onConfirm={onClear} />
          </View>
        ) : null}
      </View>
      <View style={sheet.hairline} />

      {/* Bloc client — commande téléphone */}
      {mode === 'tel' ? (
        <View style={{ paddingHorizontal: S.lg, paddingVertical: S.md, gap: S.sm, backgroundColor: '#0d0d0d' }}>
          <Field
            value={customerName}
            onChangeText={onCustomerName}
            placeholder="Nom du client *"
            accent={brand.accent}
          />
          <Field
            value={customerPhone}
            onChangeText={onCustomerPhone}
            placeholder="Téléphone *"
            keyboardType="phone-pad"
            accent={brand.accent}
            /* Un champ vide n'est pas une erreur : seul un numéro trop court en est une. */
            invalid={customerPhone.length > 0 && customerPhone.replace(/\D/g, '').length < 8}
          />
          <Text style={[type.eyebrow, { marginTop: 2 }]}>Heure de retrait</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
            {slots.map((s) => (
              <Chip
                key={s.key}
                label={s.label}
                on={slotIso === s.iso || (slotIso === null && s.key === 'asap')}
                onPress={() => onSlot(s.iso)}
                accent={brand.accent}
                onAccent={brand.onAccent}
                minHeight={TOUCH_MIN}
              />
            ))}
          </ScrollView>
          {lines.length > 0 && !phoneOk ? (
            <View style={[sheet.row, { gap: 8 }]}>
              <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: palette.amber }} />
              <Text style={{ fontFamily: FONT, color: palette.amber, fontSize: 13, fontWeight: '600', flex: 1 }}>
                Nom et téléphone requis pour envoyer une commande téléphone
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}
      {mode === 'tel' ? <View style={sheet.hairline} /> : null}

      {/* Lignes */}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: S.lg, paddingBottom: S.md }}>
        {lines.length === 0 ? (
          <EmptyState
            glyph="+"
            title="Tapez un produit pour démarrer"
            sub="La configuration s'ouvre au premier appui."
          />
        ) : (
          lines.map((line) => (
            <TicketLine
              key={line.lineId}
              line={line}
              onQty={(q) => onQty(line.lineId, q)}
              onEdit={() => onEdit(line)}
            />
          ))
        )}

        {lines.length > 0 ? (
          <View style={{ marginTop: S.md }}>
            <Field
              value={note}
              onChangeText={onNote}
              placeholder="Note cuisine (allergie, à part…)"
              accent={brand.accent}
              maxLength={500}
            />
          </View>
        ) : null}
      </ScrollView>

      {/* Pied fixe */}
      <View
        style={{
          borderTopWidth: 1,
          borderTopColor: palette.line,
          backgroundColor: '#0c0c0c',
          paddingHorizontal: S.lg,
          paddingTop: S.md,
          paddingBottom: S.lg,
          gap: S.md,
        }}
      >
        <View style={sheet.between}>
          <Text style={type.mut}>
            Sous-total · {count} article{count > 1 ? 's' : ''}
          </Text>
          <Text style={[type.num, { fontSize: 14, fontWeight: '600', color: palette.mut }]}>{euros(subtotal)}</Text>
        </View>

        <View style={[sheet.between, { alignItems: 'flex-end' }]}>
          <Text style={[type.eyebrow, { fontSize: 13, marginBottom: 6 }]}>Total</Text>
          <Text
            style={[
              type.display,
              { fontSize: 38, fontWeight: '900', color: lines.length ? brand.accent : '#3a3a3a', letterSpacing: -1.4 },
            ]}
          >
            {euros(subtotal)}
          </Text>
        </View>

        <View style={{ gap: S.sm }}>
          <View style={{ flexDirection: 'row', gap: S.sm }}>
            <Btn
              label="Espèces"
              kind="solid"
              size="md"
              disabled={!canSend}
              onPress={() => onPay('especes')}
              style={{ flex: 1 }}
            />
            <Btn
              label="Carte"
              kind="primary"
              size="md"
              accent={brand.accent}
              onAccent={brand.onAccent}
              disabled={!canSend}
              onPress={() => onPay('cb')}
              style={{ flex: 1 }}
            />
          </View>
          {mode === 'tel' ? (
            <Btn
              label="Payer au retrait"
              kind="ghost"
              size="md"
              disabled={!canSend}
              onPress={() => onPay('retrait')}
              block
            />
          ) : null}
        </View>
      </View>
    </View>
  );
}

function TicketLine({
  line,
  onQty,
  onEdit,
}: {
  line: CartLine;
  onQty: (qty: number) => void;
  onEdit: () => void;
}) {
  const detail = lineDetail(line);
  return (
    <View style={{ paddingVertical: S.md, borderBottomWidth: 1, borderBottomColor: palette.line2 }}>
      <View style={[sheet.row, { alignItems: 'flex-start', gap: S.sm }]}>
        <Press
          onPress={onEdit}
          accessibilityLabel={`Modifier ${line.name}`}
          style={{ flex: 1, paddingRight: 4 }}
          activeStyle={{ opacity: 0.7 }}
          scale={0.99}
        >
          <Text style={[type.strong, { fontSize: 15.5, lineHeight: 19 }]}>{line.name}</Text>
          {detail ? (
            <Text style={{ fontFamily: FONT, color: palette.mut, fontSize: 13, lineHeight: 17, marginTop: 3 }}>
              {detail}
            </Text>
          ) : null}
          {line.note ? (
            <Text
              style={{ fontFamily: FONT, color: palette.amber, fontSize: 13, lineHeight: 17, marginTop: 3 }}
            >
              « {line.note} »
            </Text>
          ) : null}
          <Text style={[type.num, { color: '#7a7a7a', fontSize: 12.5, marginTop: 4 }]}>
            {euros(line.unitPrice)} / u
          </Text>
        </Press>
        <Text style={[type.num, { fontSize: 16, fontWeight: '800', letterSpacing: -0.4 }]}>
          {euros(line.unitPrice * line.qty)}
        </Text>
      </View>
      <View style={[sheet.between, { marginTop: S.sm }]}>
        <Press
          onPress={() => onQty(0)}
          accessibilityLabel={`Supprimer ${line.name}`}
          style={{
            minHeight: TOUCH_MIN,
            paddingHorizontal: 12,
            justifyContent: 'center',
            borderRadius: R.pill,
          }}
          activeStyle={{ backgroundColor: withAlpha(palette.red, 0.14) }}
        >
          <Text style={{ fontFamily: FONT, color: palette.red, fontSize: 13.5, fontWeight: '700' }}>Supprimer</Text>
        </Press>
        <Stepper qty={line.qty} onChange={onQty} min={0} compact />
      </View>
    </View>
  );
}

/**
 * Action destructive en deux temps : vider un ticket par mégarde pendant un
 * coup de feu coûte une commande entière. Le second appui doit être délibéré,
 * sans imposer une modale.
 */
function ConfirmAction({
  label,
  confirmLabel,
  tone,
  onConfirm,
}: {
  label: string;
  confirmLabel: string;
  tone: string;
  onConfirm: () => void;
}) {
  const [armed, setArmed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return (
    <TextAction
      label={armed ? confirmLabel : label}
      tone={tone}
      filled={armed}
      onPress={() => {
        if (armed) {
          if (timer.current) clearTimeout(timer.current);
          setArmed(false);
          onConfirm();
          return;
        }
        setArmed(true);
        timer.current = setTimeout(() => setArmed(false), 3000);
      }}
    />
  );
}

function TextAction({
  label,
  tone,
  onPress,
  filled,
}: {
  label: string;
  tone: string;
  onPress: () => void;
  filled?: boolean;
}) {
  return (
    <Press
      onPress={onPress}
      accessibilityLabel={label}
      style={{
        minHeight: TOUCH_MIN,
        paddingHorizontal: 12,
        justifyContent: 'center',
        borderRadius: R.pill,
        borderWidth: 1,
        borderColor: withAlpha(tone, filled ? 0.9 : 0.32),
        backgroundColor: filled ? withAlpha(tone, 0.18) : 'transparent',
      }}
      activeStyle={{ backgroundColor: withAlpha(tone, 0.16) }}
    >
      <Text style={{ fontFamily: FONT, color: tone, fontSize: 13, fontWeight: '700' }}>{label}</Text>
    </Press>
  );
}
