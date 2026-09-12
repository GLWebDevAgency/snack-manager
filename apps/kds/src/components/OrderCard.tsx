import { Icon } from '@sm/ui-native';
import { memo, useEffect, useRef } from 'react';
import { Animated, Easing, Platform, StyleSheet, Text, View } from 'react-native';
import { timerColor, TIMER_THRESHOLDS, type Order, type OrderLine } from '@sm/client-core';
import {
  ADVANCE_LABEL,
  alpha,
  CHANNEL_LABEL,
  contrastOn,
  makeUi,
  radius,
  STATUS_TONE,
  tabular,
  TYPE_LABEL,
  type BoardStatus,
} from '../ui';
import { useUi } from '../theme';
import { clockHM, elapsedLabel, elapsedSeconds, optionsText } from '../format';
import { scaledStyles, type Layout } from '../useLayout';
import { Check, Chevron, Pill, Tap } from './primitives';
import { kitchenNextStatus } from '../delivery-policy';

/**
 * La carte de commande — l'objet le plus lu de l'application.
 *
 * Contraintes de service qui dictent le dessin :
 *  - **hauteur stable** : `flexShrink: 0`, la carte n'est jamais comprimée par
 *    le nombre de tickets dans la colonne — mieux vaut une carte de moins
 *    qu'une carte illisible ;
 *  - **lisible de loin** : le n° de retrait, le minuteur et les retraits
 *    suivent l'échelle `far()` de `useLayout` — sur un 24" mural (1920×1080)
 *    le n° passe de 32 à 44 px et le minuteur de 22 à 30 px, sinon l'écran ne
 *    sert à rien depuis le piano de cuisson ;
 *  - **les retraits sautent aux yeux** : « SANS OIGNONS » est traité en rouge
 *    fonctionnel, encadré — c'est la première cause d'erreur de service ;
 *  - **un seul geste** : un bouton d'action pleine largeur, ≥ 56 px, plus haut
 *    à mesure que l'écran grandit.
 */

const RAIL = 3;

export interface OrderCardProps {
  order: Order;
  now: number;
  accent: string;
  reducedMotion: boolean;
  onAdvance: (order: Order) => void;
  layout: Layout;
  /** Une écriture attend encore le réseau pour cette commande. */
  pending?: boolean;
  /** La densité compacte les espacements, jamais les informations de préparation. */
  density?: 'comfort' | 'dense';
}

function ItemRow({
  line,
  accent,
  last,
  layout,
  density,
}: {
  line: OrderLine;
  accent: string;
  last: boolean;
  layout: Layout;
  density: 'comfort' | 'dense';
}) {
  const { theme, palette } = useUi();
  const styles = cardStyles(layout, theme, density);
  const options = optionsText(line);
  return (
    <View style={[styles.itemRow, !last && styles.itemDivider]}>
      <Text style={[styles.qty, { color: palette.text }]}>{line.qty}×</Text>

      <View style={styles.itemBody}>
        <View style={styles.itemHead}>
          <Text style={styles.itemName}>{line.name}</Text>
          {line.variantName ? (
            <View style={styles.variant}>
              <Text style={styles.variantText}>{line.variantName}</Text>
            </View>
          ) : null}
        </View>

        {options ? <Text style={styles.options}>{options}</Text> : null}

        {/* Retraits — traitement d'alerte : c'est ce qui fait les erreurs. */}
        {line.removed.length > 0 ? (
          <View style={styles.removedRow}>
            {line.removed.map((item) => (
              <View key={item} style={styles.removed}>
                <Text style={styles.removedText}>SANS {item.toUpperCase()}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {line.note ? (
          <View style={styles.lineNote}>
            <Text style={styles.lineNoteText}>{line.note}</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

function OrderCardBase({
  order,
  now,
  accent,
  reducedMotion,
  onAdvance,
  pending,
  layout,
  density = 'comfort',
}: OrderCardProps) {
  const { theme, palette, surface, ink, hair, shadow, statusColors } = useUi();
  const styles = cardStyles(layout, theme, density);
  const status = order.status as BoardStatus;
  const tone = STATUS_TONE[status] ?? STATUS_TONE.new;

  const seconds = elapsedSeconds(order, now);
  const minutes = seconds / 60;

  /**
   * Seuils du minuteur : `timerColor` / `TIMER_THRESHOLDS` du noyau partagé,
   * soit **vert < 10 min · ambre 10–15 · rouge ≥ 15** (valeurs du brief).
   *
   * Écart assumé avec la maquette, qui utilisait 5 / 10 min. Deux raisons de
   * retenir 10 / 15 : un tacos composé dépasse couramment 5 minutes de
   * production, et un écran où tout est ambre au bout de cinq minutes n'alerte
   * plus de rien. Les seuils sont centralisés dans `@sm/client-core/theme` pour
   * devenir paramétrables par tenant sans toucher à cette carte.
   */
  // Les seuils restent ceux du noyau ; seule l’encre s’adapte au fond.
  const timerTone = timerColor(minutes);
  const timer = timerTone === palette.red ? ink.onRed
    : timerTone === palette.amber ? ink.onAmber : ink.onGreen;
  const late = minutes >= TIMER_THRESHOLDS.late && status !== 'ready';
  const isNew = status === 'new';

  const title = order.pickup?.customerName ?? TYPE_LABEL[order.type] ?? 'Commande';
  const paid = order.payment.status === 'paid';
  const delivery = order.type === 'delivery';
  const next = kitchenNextStatus(order);
  const actionLabel = status === 'ready'
    ? delivery
      ? order.delivery?.dispatchedAt ? 'Prise en charge par le livreur' : 'En attente du livreur'
      : 'Remise à confirmer par la caisse'
    : ADVANCE_LABEL[status];
  const channelLabel = CHANNEL_LABEL[order.channel] ?? order.channel;

  const actionBg = status === 'preparing' ? statusColors.preparing.wash : surface.el;
  const actionFg = status === 'preparing' ? statusColors.preparing.ink : palette.text;

  // Une entrée ponctuelle ; le statut et l'alerte de retard restent statiques
  // afin de ne pas détourner la lecture pendant la préparation.
  const entrance = useRef(new Animated.Value(isNew && !reducedMotion ? 0 : 1)).current;
  useEffect(() => {
    if (reducedMotion) {
      entrance.setValue(1);
      return;
    }
    const animation = Animated.timing(entrance, {
      toValue: 1,
      duration: 300,
      easing: Easing.bezier(0.2, 0.8, 0.2, 1),
      useNativeDriver: Platform.OS !== 'web',
    });
    animation.start();
    return () => animation.stop();
  }, [entrance, reducedMotion]);

  return (
    <Animated.View
      accessibilityLabel={`Commande ${order.number}`}
      style={[
        styles.card,
        shadow.card,
        late && shadow.alert,
        late && { borderColor: alpha(palette.red, 0.45) },
        {
          opacity: entrance.interpolate({ inputRange: [0, 1], outputRange: [0.45, 1] }),
          transform: [{ translateY: entrance.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }],
        },
      ]}
    >
      <View style={[styles.rail, { backgroundColor: tone.bg }]} />

      {/* ─── En-tête ─── */}
      <View style={styles.header}>
        <View style={styles.headTop}>
          <Text style={styles.noValue}>#{order.number}</Text>
          <View style={styles.timerGroup}>
            <Icon name="clock" size={layout.fs(14)} color={timer} />
            <Text style={[styles.timer, { color: timer }]} accessibilityLabel={`Depuis ${Math.floor(minutes)} minutes`}>
              {elapsedLabel(seconds)}
            </Text>
          </View>
        </View>
        <View style={styles.identityRow}>
          <Text style={styles.title}>{title}</Text>
          {order.dining ? <View style={styles.table} accessibilityLabel={`Table : ${order.dining.tableLabel}`}>
            <Icon name="table" size={layout.fs(15)} color={palette.text} />
            <Text style={styles.tableText}>Table : {order.dining.tableLabel}</Text>
          </View> : null}
        </View>
          <View style={styles.pills}>
            {delivery ? <Pill text={order.delivery?.dispatchedAt ? 'En livraison' : 'Livraison'} color={ink.dim} background={surface.el2} border={hair} layout={layout} /> : null}
            {/* Canal en neutre : l'accent est réservé à ce qui appelle un geste
                (l'action, l'heure de retrait). Le canal informe, il n'urge pas. */}
            <Pill
              text={channelLabel}
              color={ink.dim}
              background={surface.el2}
              border={hair}
              layout={layout}
            />
            <Pill
              text={paid ? 'Payé' : 'À encaisser'}
              color={paid ? statusColors.ready.ink : ink.dim}
              background={paid ? statusColors.ready.wash : undefined}
              border={paid ? undefined : hair}
              layout={layout}
            />
            {late ? (
              <Pill text="En retard" color={statusColors.new.ink} background={statusColors.new.wash} layout={layout} />
            ) : null}
            {pending ? (
              <Pill
                text="Envoi en attente"
                color={ink.onAmber}
                background={alpha(palette.amber, 0.16)}
                border={alpha(palette.amber, 0.45)}
                layout={layout}
              />
            ) : null}

            {/* La méta ferme la ligne sans ressort d'alignement : dans un
                conteneur qui passe à la ligne, un `flex:1` intercalé produit
                une position différente selon le nombre de pastilles. */}
            {order.pickup?.slot ? (
              <Pill
                text={`${delivery ? 'Arrivée estimée' : 'Retrait'} ${clockHM(order.pickup.slot)}`}
                color={contrastOn(accent)}
                background={accent}
                layout={layout}
              />
            ) : (
              <Text style={styles.meta}>Reçue {clockHM(order.createdAt)}</Text>
            )}
          </View>
      </View>

      {delivery && order.delivery ? (
        <View style={styles.orderNote}>
          <Text style={styles.orderNoteLabel}>Adresse de livraison</Text>
          <Text style={styles.orderNoteText}>{[order.delivery.address.line1, order.delivery.address.line2, `${order.delivery.address.postalCode} ${order.delivery.address.city}`].filter(Boolean).join(', ')}</Text>
          {order.delivery.instructions ? <Text style={styles.orderNoteText}>{order.delivery.instructions}</Text> : null}
        </View>
      ) : null}

      {/* ─── Note du client ─── */}
      {order.note ? (
        <View style={styles.orderNote}>
          <Text style={styles.orderNoteLabel}>Note client</Text>
          <Text style={styles.orderNoteText}>{order.note}</Text>
        </View>
      ) : null}

      {/* ─── Articles ─── */}
      <View style={styles.items}>
        {order.lines.map((line, i) => (
          <ItemRow
            key={`${line.productId}-${i}`}
            line={line}
            accent={accent}
            last={i === order.lines.length - 1}
            layout={layout}
            density={density}
          />
        ))}
      </View>

      {/* ─── Action ─── */}
      {status === 'ready' ? (
        <View style={[styles.action, { backgroundColor: surface.el2 }]} accessible accessibilityLabel={`${actionLabel} — commande numéro ${order.number}`}>
          <View style={styles.actionInner}>
            <Text style={[styles.actionText, { color: ink.dim }]}>{actionLabel}</Text>
            <Check color={palette.green} size={layout.far(19)} />
          </View>
        </View>
      ) : (
      <Tap
        onPress={() => onAdvance(order)}
        disabled={!next || (delivery && pending)}
        reducedMotion={reducedMotion}
        label={`${actionLabel} — commande numéro ${order.number}`}
        style={[styles.action, { backgroundColor: actionBg, borderWidth: 1, borderColor: status === 'preparing' ? actionBg : hair }]}
        pressedStyle={{ opacity: 1, borderColor: actionFg }}
        flat
      >
        <View style={styles.actionInner}>
          <Text style={[styles.actionText, { color: actionFg }]}>{delivery && pending ? 'Confirmation…' : actionLabel}</Text>
          <Chevron color={actionFg} size={layout.far(17)} />
        </View>
      </Tap>
      )}

    </Animated.View>
  );
}

/**
 * Ré-rendu uniquement quand quelque chose de visible change. Le minuteur bat à
 * la seconde : sans ce filtre, une colonne de 20 tickets re-rendrait tout son
 * contenu 60 fois par minute.
 */
export const OrderCard = memo(OrderCardBase, (a, b) => {
  if (a.order !== b.order || a.accent !== b.accent) return false;
  if (a.reducedMotion !== b.reducedMotion || a.pending !== b.pending) return false;
  if (a.density !== b.density || a.onAdvance !== b.onAdvance) return false;
  // La mise en page change au redimensionnement : sans ce test, une carte
  // resterait dessinée à l'ancienne échelle jusqu'à sa prochaine mutation.
  if (a.layout !== b.layout) return false;
  return Math.floor(a.now / 1000) === Math.floor(b.now / 1000);
});

/**
 * Toutes les dimensions de la carte dérivent de `layout` :
 *  - `far()` pour ce qui se lit à 2-4 m (n°, minuteur, retraits, nom d'article) ;
 *  - `fs()` pour le reste (options, méta, notes) ;
 *  - `actionH` pour le bouton, jamais sous 56 px.
 * La feuille n'est fabriquée qu'une fois par palier d'échelle.
 */
const cardStyles = scaledStyles((l: Layout, theme, density) => {
  const { palette, surface, ink, hair, hair2, type } = makeUi(theme);
  const dense = density === 'dense';
  const pad = Math.round((dense ? 12 : 16) * l.scale);
  const gap = pad;
  return StyleSheet.create({
    card: {
      backgroundColor: surface.card,
      borderRadius: radius.card,
      borderWidth: 1,
      borderColor: hair2,
      overflow: 'hidden',
      flexShrink: 0, // hauteur dictée par le contenu, jamais par la colonne
    },
    rail: { position: 'absolute', left: 0, right: 0, top: 0, height: RAIL },

    header: {
      gap: l.fs(10),
      paddingHorizontal: pad,
      paddingTop: pad + RAIL,
      paddingBottom: dense ? l.fs(10) : l.fs(14),
      borderBottomWidth: 1,
      borderBottomColor: hair2,
    },
    noValue: {
      fontFamily: type.hero.fontFamily,
      fontSize: l.far(32),
      fontWeight: '700',
      letterSpacing: -1.1,
      lineHeight: l.far(36),
      color: palette.text,
      ...tabular,
    },
    headTop: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: l.fs(8) },
    timerGroup: { flexDirection: 'row', alignItems: 'center', gap: l.fs(6) },
    identityRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: l.fs(8) },
    title: {
      flexShrink: 1,
      minWidth: 0,
      fontFamily: type.body.fontFamily,
      fontSize: l.fs(14),
      fontWeight: '500',
      color: ink.dim,
    },
    table: { flexDirection: 'row', alignItems: 'center', gap: l.fs(5), flexShrink: 1 },
    tableText: { fontFamily: type.title.fontFamily, fontSize: l.fs(14), fontWeight: '600', color: palette.text, flexShrink: 1 },
    timer: {
      flexShrink: 0,
      fontFamily: type.clock.fontFamily,
      fontSize: l.far(22),
      fontWeight: '600',
      letterSpacing: -0.5,
      ...tabular,
    },
    pills: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
    meta: {
      fontFamily: type.body.fontFamily,
      fontSize: l.fs(13),
      fontWeight: '600',
      color: ink.dimmer,
      ...tabular,
    },

    orderNote: {
      marginHorizontal: gap,
      marginTop: 10,
      marginLeft: pad,
      paddingVertical: 8,
      paddingHorizontal: 11,
      borderRadius: radius.xs,
      borderLeftWidth: 3,
      borderLeftColor: palette.amber,
      backgroundColor: alpha(palette.amber, 0.11),
      gap: 2,
    },
    orderNoteLabel: {
      fontFamily: type.micro.fontFamily,
      fontSize: l.fs(10),
      fontWeight: '800',
      letterSpacing: 1.1,
      textTransform: 'uppercase',
      color: ink.onAmber,
    },
    orderNoteText: {
      fontFamily: type.item.fontFamily,
      fontSize: l.far(14.5),
      fontWeight: '700',
      color: palette.text,
      lineHeight: l.far(19),
    },

    items: { paddingLeft: pad, paddingRight: gap, paddingVertical: 4 },
    itemRow: { flexDirection: 'row', gap: 10, paddingVertical: Math.round((dense ? 5 : 8) * l.scale) },
    itemDivider: { borderBottomWidth: 0 },
    qty: {
      flexShrink: 0,
      fontFamily: type.qty.fontFamily,
      fontSize: l.far(17),
      fontWeight: '800',
      letterSpacing: -0.4,
      minWidth: l.far(30),
      lineHeight: l.far(21),
      ...tabular,
    },
    itemBody: { flex: 1, minWidth: 0, gap: 5 },
    itemHead: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 7 },
    itemName: {
      flexShrink: 1,
      maxWidth: '100%',
      fontFamily: type.item.fontFamily,
      fontSize: l.far(16),
      fontWeight: '600',
      letterSpacing: -0.2,
      lineHeight: l.far(20),
      color: palette.text,
    },
    variant: {
      maxWidth: '100%',
      backgroundColor: surface.el2,
      borderWidth: 1,
      borderColor: hair,
      borderRadius: 6,
      paddingHorizontal: 7,
      paddingVertical: 2,
    },
    variantText: {
      fontFamily: type.micro.fontFamily,
      fontSize: l.fs(13),
      fontWeight: '800',
      letterSpacing: 0.3,
      color: palette.text,
      textTransform: 'uppercase',
    },
    options: {
      fontFamily: type.body.fontFamily,
      fontSize: l.fs(13.5),
      fontWeight: '500',
      color: ink.dim,
      lineHeight: l.fs(18),
    },

    removedRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 1 },
    removed: {
      maxWidth: '100%',
      backgroundColor: alpha(palette.red, 0.16),
      borderWidth: 1,
      borderColor: alpha(palette.red, 0.55),
      borderRadius: 6,
      paddingHorizontal: 8,
      paddingVertical: 3,
    },
    // Première cause d'erreur de service : se lit d'aussi loin que le n°.
    removedText: {
      fontFamily: type.micro.fontFamily,
      fontSize: l.far(13),
      fontWeight: '800',
      letterSpacing: 0.6,
      color: ink.onRed,
    },

    lineNote: {
      borderLeftWidth: 3,
      borderLeftColor: palette.amber,
      backgroundColor: alpha(palette.amber, 0.11),
      borderRadius: radius.xs,
      paddingHorizontal: 9,
      paddingVertical: 5,
    },
    lineNoteText: {
      fontFamily: type.item.fontFamily,
      fontSize: l.far(13.5),
      fontWeight: '700',
      color: ink.onAmber,
      lineHeight: l.far(18),
    },

    action: {
      minHeight: dense ? Math.max(56, l.actionH - 6) : l.actionH,
      paddingVertical: 6,
      justifyContent: 'center',
      marginLeft: pad,
      marginRight: gap,
      marginBottom: pad,
      marginTop: 4,
      borderRadius: radius.sm,
    },
    actionInner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 12 },
    actionText: {
      flexShrink: 1,
      textAlign: 'center',
      fontFamily: type.action.fontFamily,
      fontSize: l.far(15),
      fontWeight: '700',
      letterSpacing: -0.1,
    },
  });
});
