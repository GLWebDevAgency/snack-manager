/**
 * Panneau ticket (zone D) — colonne de droite du poste.
 *
 * C'est la colonne que le caissier regarde en permanence : hiérarchie franche
 * (nom en gras, options en second niveau gris), total en très grande graisse
 * accent, boutons d'encaissement pleine largeur en pied fixe.
 *
 * Sa largeur n'est plus figée à 384 px : elle suit l'écran entre 340 et 460
 * (`useLayout`). Sous 900 px de large (mode compact), le panneau quitte la
 * disposition en trois colonnes pour devenir un TIROIR, ouvert depuis la barre
 * `TicketDock` restée visible en pied d'écran.
 */
import { useEffect, useRef, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { cartTotal, euros, type CartLine } from '@sm/client-core';
import { FONT, R, S, palette, sheet, type, withAlpha, type Brand } from './theme';
import { MODE_LABEL, lineDetail, type Mode } from './pos-state';
import { phoneServiceDay, type PhoneTicketControls } from './usePhoneOrder';
import { Btn, Chip, CloseBtn, EmptyState, Field, Press, Stepper } from './ui';
import { useLayout, type Layout } from './useLayout';
import type { LoyaltyTicketMember } from './loyalty-state';

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
  loyalty,
  onLoyalty,
  onCollapse,
  phone,
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
  onPay: (method: 'cb' | 'especes' | 'tr' | 'retrait') => void;
  busy: boolean;
  loyalty: LoyaltyTicketMember | null;
  onLoyalty: () => void;
  /** Fourni en mode tiroir : referme le ticket et rend la grille au caissier. */
  onCollapse?: () => void;
  phone: PhoneTicketControls;
}) {
  const L = useLayout();
  const drawer = !!onCollapse;
  const subtotal = cartTotal(lines);
  const count = lines.reduce((n, l) => n + l.qty, 0);
  const phoneOk = customerName.trim().length > 0 && customerPhone.replace(/\D/g, '').length >= 8;
  const canSend = lines.length > 0 && mode !== 'tel' && !busy;
  const today = phoneServiceDay();
  const tomorrow = new Date(new Date(`${today}T12:00:00Z`).getTime() + 86_400_000).toISOString().slice(0, 10);

  return (
    <View
      style={{
        // Ancré : largeur fluide bornée. Tiroir : il remplit la largeur que le
        // tiroir lui donne.
        ...(drawer ? { flex: 1 } : { width: L.ticketW }),
        backgroundColor: palette.surface,
        borderLeftWidth: 1,
        borderLeftColor: palette.line,
      }}
    >
      {/* En-tête */}
      <View style={[sheet.between, { paddingHorizontal: S.lg, paddingVertical: S.md, gap: S.sm }]}>
        <View style={{ flex: 1 }}>
          <Text style={[type.eyebrow, { fontSize: L.fs(12) }]}>Ticket</Text>
          <Text style={[type.h2, { marginTop: 2, fontSize: L.fs(17) }]}>{MODE_LABEL[mode]}</Text>
        </View>
        {lines.length > 0 ? (
          <View style={[sheet.row, { gap: 6 }]}>
            <TextAction label="En attente" tone={palette.amber} onPress={onPark} />
            <ConfirmAction label="Vider" confirmLabel="Confirmer ?" tone={palette.red} onConfirm={onClear} />
          </View>
        ) : null}
        {onCollapse ? <CloseBtn onPress={onCollapse} label="Replier le ticket" /> : null}
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
            maxLength={80}
            disabled={busy}
          />
          <Field
            value={customerPhone}
            onChangeText={onCustomerPhone}
            placeholder="Téléphone *"
            keyboardType="phone-pad"
            accent={brand.accent}
            maxLength={32}
            disabled={busy}
            /* Un champ vide n'est pas une erreur : seul un numéro trop court en est une. */
            invalid={customerPhone.length > 0 && customerPhone.replace(/\D/g, '').length < 8}
          />
          <Text style={[type.eyebrow, { marginTop: 2, fontSize: L.fs(12) }]}>Heure de retrait</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: S.xs }}>
            {[[today, 'Aujourd’hui'], [tomorrow, 'Demain'],
              ...(phone.slots?.nextOpenDate && ![today, tomorrow].includes(phone.slots.nextOpenDate)
                ? [[phone.slots.nextOpenDate, `Le ${phone.slots.nextOpenDate.slice(8)}/${phone.slots.nextOpenDate.slice(5, 7)}`]] : [])].map(([date, label]) => (
              <Chip key={date} label={label!} on={phone.date === date} disabled={busy || phone.slotsBusy || !!phone.unavailable}
                accessibilityRole="radio" onPress={() => phone.onDate(date!)} accent={brand.accent} onAccent={brand.onAccent} />
            ))}
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
            {(phone.slots?.slots ?? []).map((s) => (
              <Chip
                key={s.iso}
                label={`${s.label}${s.full ? ' · complet' : ''}`}
                accessibilityRole="radio"
                on={slotIso === s.iso}
                disabled={busy || phone.slotsBusy || s.full}
                onPress={() => onSlot(s.iso)}
                accent={brand.accent}
                onAccent={brand.onAccent}
              />
            ))}
          </ScrollView>
          {phone.slotsBusy ? <Text accessibilityRole="alert" style={type.mut}>Vérification des créneaux…</Text> : null}
          {phone.slots?.closedToday ? <Text style={type.mut}>{phone.slots.closureReason ?? 'Aucun créneau disponible pour cette journée.'}</Text> : null}
          {phone.slotsError || phone.unavailable ? <Text accessibilityRole="alert" style={[type.mut, { color: palette.amber }]}>{phone.unavailable ?? phone.slotsError}</Text> : null}
          <Btn label="Actualiser les créneaux" kind="ghost" size="sm" disabled={busy || phone.slotsBusy || !!phone.unavailable} onPress={phone.onRefresh} />
          <Text style={type.mut}>La fidélité n’est pas encore rattachable aux commandes téléphone.</Text>
          {lines.length > 0 && !phoneOk ? (
            <View style={[sheet.row, { gap: 8 }]}>
              <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: palette.amber }} />
              <Text style={{ fontFamily: FONT, color: palette.amber, fontSize: L.fs(13), fontWeight: '600', flex: 1 }}>
                Nom et téléphone requis pour envoyer une commande téléphone
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}
      {mode === 'tel' ? <View style={sheet.hairline} /> : null}

      {/* Le pilote crédite uniquement une vente POS : une prise de commande
          téléphonique ne doit jamais persister identité client + UUID carte. */}
      {mode !== 'tel' ? <Press
        onPress={onLoyalty}
        accessibilityLabel={
          loyalty
            ? `Fidélité rattachée à ${loyalty.alias}. Ouvrir la carte.`
            : 'Rattacher une carte fidélité au ticket'
        }
        style={{
          marginHorizontal: S.lg,
          marginVertical: S.sm,
          minHeight: L.touch(52),
          paddingHorizontal: S.md,
          paddingVertical: S.sm,
          borderRadius: R.ctrl,
          borderWidth: 1,
          borderColor: loyalty ? withAlpha(brand.accent, 0.42) : palette.line2,
          backgroundColor: loyalty ? withAlpha(brand.accent, 0.09) : '#101010',
          flexDirection: 'row',
          alignItems: 'center',
          gap: S.sm,
        }}
        activeStyle={{ backgroundColor: '#282828' }}
      >
        <View
          style={{
            width: 34,
            height: 34,
            borderRadius: 12,
            backgroundColor: loyalty ? withAlpha(brand.accent, 0.18) : palette.surface2,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ color: loyalty ? brand.accent : palette.mut, fontSize: L.fs(17) }}>★</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[type.strong, { fontSize: L.fs(14) }]} numberOfLines={1}>
            {loyalty ? loyalty.alias : 'Carte fidélité'}
          </Text>
          <Text style={[type.mut, { marginTop: 1, fontSize: L.fs(12) }]}>
            {loyalty
              ? `${loyalty.balanceUnits} unité${loyalty.balanceUnits > 1 ? 's' : ''} · rattachée`
              : 'Scanner, rechercher ou créer'}
          </Text>
        </View>
        <Text style={{ color: loyalty ? brand.accent : palette.mut, fontSize: L.fs(18) }}>›</Text>
      </Press> : null}
      {mode !== 'tel' ? <View style={sheet.hairline} /> : null}

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
              layout={L}
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
          <Text style={[type.mut, { fontSize: L.fs(13) }]}>
            Sous-total · {count} article{count > 1 ? 's' : ''}
          </Text>
          <Text style={[type.num, { fontSize: L.fs(14), fontWeight: '600', color: palette.mut }]}>
            {euros(subtotal)}
          </Text>
        </View>

        <View style={[sheet.between, { alignItems: 'flex-end' }]}>
          <Text style={[type.eyebrow, { fontSize: L.fs(13), marginBottom: 6 }]}>Total</Text>
          <Text
            style={[
              type.display,
              {
                // Le total est l'information la plus lue du poste : c'est elle
                // qui doit profiter le plus d'un grand écran.
                fontSize: L.fs(38),
                fontWeight: '900',
                color: lines.length ? brand.accent : '#3a3a3a',
                letterSpacing: -1.4,
              },
            ]}
          >
            {euros(subtotal)}
          </Text>
        </View>

        <View style={{ gap: S.sm }}>
          {mode === 'tel' ? <>
            <Text style={type.mut}>Le restaurant confirme le créneau avant tout encaissement.</Text>
            <Btn label={busy ? 'Confirmation…' : 'Confirmer le créneau'} kind="primary" accent={brand.accent}
              onAccent={brand.onAccent} disabled={!phone.canSubmit || busy} onPress={phone.onSubmit} block />
          </> : <>
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
          {/* Le déjeuner d'un snack se règle souvent en titre-restaurant —
              encaissé sur le terminal TR du restaurant, pas par nous. Le
              bouton existe pour enregistrer le moyen local correctement ; en
              fantôme, car il pèse moins que les deux gestes dominants. */}
          <Btn
            label="Titre-restaurant"
            kind="ghost"
            size="md"
            disabled={!canSend}
            onPress={() => onPay('tr')}
            block
          />
          </>}
        </View>
      </View>
    </View>
  );
}

function TicketLine({
  line,
  layout: L,
  onQty,
  onEdit,
}: {
  line: CartLine;
  layout: Layout;
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
          <Text style={[type.strong, { fontSize: L.fs(15.5), lineHeight: L.fs(19) }]}>{line.name}</Text>
          {detail ? (
            <Text
              style={{ fontFamily: FONT, color: palette.mut, fontSize: L.fs(13), lineHeight: L.fs(17), marginTop: 3 }}
            >
              {detail}
            </Text>
          ) : null}
          {line.note ? (
            <Text
              style={{ fontFamily: FONT, color: palette.amber, fontSize: L.fs(13), lineHeight: L.fs(17), marginTop: 3 }}
            >
              « {line.note} »
            </Text>
          ) : null}
          <Text style={[type.num, { color: '#7a7a7a', fontSize: L.fs(12.5), marginTop: 4 }]}>
            {euros(line.unitPrice)} / u
          </Text>
        </Press>
        <Text style={[type.num, { fontSize: L.fs(16), fontWeight: '800', letterSpacing: -0.4 }]}>
          {euros(line.unitPrice * line.qty)}
        </Text>
      </View>
      <View style={[sheet.between, { marginTop: S.sm }]}>
        <Press
          onPress={() => onQty(0)}
          accessibilityLabel={`Supprimer ${line.name}`}
          style={{
            minHeight: L.touch(),
            paddingHorizontal: 12,
            justifyContent: 'center',
            borderRadius: R.pill,
          }}
          activeStyle={{ backgroundColor: withAlpha(palette.red, 0.14) }}
        >
          <Text style={{ fontFamily: FONT, color: palette.red, fontSize: L.fs(13.5), fontWeight: '700' }}>
            Supprimer
          </Text>
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
        borderColor: withAlpha(tone, filled ? 0.9 : 0.32),
        backgroundColor: filled ? withAlpha(tone, 0.18) : 'transparent',
      }}
      activeStyle={{ backgroundColor: withAlpha(tone, 0.16) }}
    >
      <Text style={{ fontFamily: FONT, color: tone, fontSize: L.fs(13), fontWeight: '700' }}>{label}</Text>
    </Press>
  );
}

/**
 * Barre d'accès permanente du mode compact (< 900 px).
 *
 * Le ticket est replié, mais le caissier doit garder sous les yeux ce qu'il a
 * saisi ET pouvoir encaisser sans détour : à gauche « Ticket · N articles ·
 * total » ouvre le tiroir, à droite le paiement carte — le plus fréquent —
 * part en UN seul geste. Espèces et paiement au retrait restent dans le
 * tiroir, où le pied de ticket est inchangé.
 */
export function TicketDock({
  lines,
  mode,
  brand,
  busy,
  loyalty,
  onLoyalty,
  onOpen,
  onPay,
  phone,
}: {
  lines: CartLine[];
  mode: Mode;
  brand: Brand;
  busy: boolean;
  customerName: string;
  customerPhone: string;
  loyalty: LoyaltyTicketMember | null;
  onLoyalty: () => void;
  onOpen: () => void;
  onPay: (method: 'cb' | 'especes' | 'tr' | 'retrait') => void;
  phone: PhoneTicketControls;
}) {
  const L = useLayout();
  const subtotal = cartTotal(lines);
  const count = lines.reduce((n, l) => n + l.qty, 0);
  const canSend = lines.length > 0 && mode !== 'tel' && !busy;

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: S.sm,
        paddingHorizontal: S.md,
        paddingVertical: S.sm,
        backgroundColor: '#0c0c0c',
        borderTopWidth: 1,
        borderTopColor: palette.line,
      }}
    >
      {mode !== 'tel' ? <Press
        onPress={onLoyalty}
        accessibilityLabel={
          loyalty
            ? `Fidélité rattachée à ${loyalty.alias}`
            : 'Rattacher une carte fidélité'
        }
        style={{
          width: L.touch(52),
          height: L.touch(52),
          borderRadius: R.pill,
          borderWidth: 1,
          borderColor: loyalty ? withAlpha(brand.accent, 0.55) : palette.line,
          backgroundColor: loyalty ? withAlpha(brand.accent, 0.13) : palette.surface2,
          alignItems: 'center',
          justifyContent: 'center',
        }}
        activeStyle={{ backgroundColor: '#282828' }}
      >
        <Text style={{ color: loyalty ? brand.accent : palette.mut, fontSize: L.fs(21) }}>★</Text>
      </Press> : null}
      <Press
        onPress={onOpen}
        accessibilityLabel={`Ouvrir le ticket, ${count} article${count > 1 ? 's' : ''}, total ${euros(subtotal)}`}
        style={{
          flex: 1,
          minHeight: L.touch(52),
          paddingHorizontal: S.md,
          borderRadius: R.pill,
          borderWidth: 1,
          borderColor: lines.length ? withAlpha(brand.accent, 0.45) : palette.line,
          backgroundColor: palette.surface2,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: S.sm,
        }}
        activeStyle={{ backgroundColor: '#262626' }}
      >
        <Text numberOfLines={1} style={{ fontFamily: FONT, color: palette.text, fontSize: L.fs(14), fontWeight: '700' }}>
          Ticket · {count} art.
        </Text>
        <Text
          style={[
            type.num,
            { fontSize: L.fs(20), fontWeight: '900', color: lines.length ? brand.accent : '#3a3a3a', letterSpacing: -0.6 },
          ]}
        >
          {euros(subtotal)}
        </Text>
      </Press>

      {/* La barre compacte garde les deux gestes dominants ; le
          titre-restaurant s'encaisse depuis le tiroir du ticket, où la
          place ne manque pas. */}
      {mode === 'tel' ? <Btn label={busy ? 'Confirmation…' : 'Confirmer'} kind="primary" size="md"
        accent={brand.accent} onAccent={brand.onAccent} disabled={!phone.canSubmit || busy} onPress={phone.onSubmit}
        accessibilityLabel="Confirmer le créneau téléphone avant encaissement" /> : <><Btn
        label="Carte"
        kind="primary"
        size="md"
        accent={brand.accent}
        onAccent={brand.onAccent}
        disabled={!canSend}
        onPress={() => onPay('cb')}
        accessibilityLabel={`Encaisser ${euros(subtotal)} par carte`}
      />
      <Btn
        label="Espèces"
        kind="solid"
        size="md"
        disabled={!canSend}
        onPress={() => onPay('especes')}
        accessibilityLabel={`Encaisser ${euros(subtotal)} en espèces`}
      />
      </>}
    </View>
  );
}
