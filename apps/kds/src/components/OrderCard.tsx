import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { timerColor, TIMER_THRESHOLDS, type Order, type OrderLine } from '@sm/client-core';
import {
  ADVANCE_LABEL,
  alpha,
  CHANNEL_LABEL,
  contrastOn,
  hair,
  hair2,
  ink,
  palette,
  radius,
  shadow,
  STATUS_TONE,
  surface,
  tabular,
  TYPE_LABEL,
  type,
  type BoardStatus,
} from '../ui';
import { clockHM, elapsedLabel, elapsedSeconds, optionsText } from '../format';
import { scaledStyles, type Layout } from '../useLayout';
import { Check, Chevron, Pill, PulseRing, Sheen, Tap } from './primitives';

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

const RAIL = 4;

export interface OrderCardProps {
  order: Order;
  now: number;
  accent: string;
  reducedMotion: boolean;
  onAdvance: (order: Order) => void;
  layout: Layout;
  /** Une écriture attend encore le réseau pour cette commande. */
  pending?: boolean;
}

function ItemRow({
  line,
  accent,
  last,
  layout,
}: {
  line: OrderLine;
  accent: string;
  last: boolean;
  layout: Layout;
}) {
  const styles = cardStyles(layout);
  const options = optionsText(line);
  return (
    <View style={[styles.itemRow, !last && styles.itemDivider]}>
      <Text style={[styles.qty, { color: accent }]}>{line.qty}×</Text>

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
}: OrderCardProps) {
  const styles = cardStyles(layout);
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
  const timer = timerColor(minutes);
  const late = minutes >= TIMER_THRESHOLDS.late && status !== 'ready';
  const isNew = status === 'new';

  const title = order.pickup?.customerName ?? TYPE_LABEL[order.type] ?? 'Commande';
  const paid = order.payment.status === 'paid';
  const channelLabel = CHANNEL_LABEL[order.channel] ?? order.channel;

  const actionBg = status === 'ready' ? palette.green : accent;
  const actionFg = contrastOn(actionBg);

  // Liseré vivant : rouge quand c'est en retard (priorité absolue), accent
  // quand le ticket vient d'arriver, rien ensuite.
  const ringColor = late ? palette.red : isNew ? accent : null;

  return (
    <View
      style={[
        styles.card,
        shadow.card,
        late && shadow.alert,
        late && { borderColor: alpha(palette.red, 0.45) },
      ]}
    >
      <Sheen height={layout.fs(96)} radius={radius.md} />
      <View style={[styles.rail, { backgroundColor: tone.bg }]} />

      {/* ─── En-tête ─── */}
      <View style={styles.header}>
        <View style={styles.noBox}>
          <Text style={styles.noLabel}>N°</Text>
          <Text style={styles.noValue}>{order.number}</Text>
        </View>

        <View style={styles.headRight}>
          <View style={styles.headTop}>
            <Text style={styles.title} numberOfLines={1}>
              {title}
            </Text>
            <Text
              style={[styles.timer, { color: timer }]}
              accessibilityLabel={`Depuis ${Math.floor(minutes)} minutes`}
            >
              {elapsedLabel(seconds)}
            </Text>
          </View>

          <View style={styles.pills}>
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
              color={paid ? contrastOn(palette.green) : ink.dim}
              background={paid ? palette.green : undefined}
              border={paid ? undefined : hair}
              layout={layout}
            />
            {late ? (
              <Pill text="En retard" color="#ffffff" background={palette.red} layout={layout} />
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
                text={`Retrait ${clockHM(order.pickup.slot)}`}
                color={contrastOn(accent)}
                background={accent}
                layout={layout}
              />
            ) : (
              <Text style={styles.meta}>Reçue {clockHM(order.createdAt)}</Text>
            )}
          </View>
        </View>
      </View>

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
          />
        ))}
      </View>

      {/* ─── Action ─── */}
      <Tap
        onPress={() => onAdvance(order)}
        reducedMotion={reducedMotion}
        label={`${ADVANCE_LABEL[status]} — commande numéro ${order.number}`}
        style={[styles.action, { backgroundColor: actionBg }]}
        pressedStyle={{ opacity: 0.82 }}
        flat
      >
        <View style={styles.actionInner}>
          <Text style={[styles.actionText, { color: actionFg }]}>{ADVANCE_LABEL[status]}</Text>
          {status === 'ready' ? (
            <Check color={actionFg} size={layout.far(19)} />
          ) : (
            <Chevron color={actionFg} size={layout.far(17)} />
          )}
        </View>
      </Tap>

      <PulseRing
        color={ringColor ?? accent}
        radius={radius.md}
        active={ringColor !== null}
        reducedMotion={reducedMotion}
      />
    </View>
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
const cardStyles = scaledStyles((l: Layout) => {
  const pad = Math.round(10 * l.scale);
  const gap = Math.round(12 * l.scale);
  return StyleSheet.create({
    card: {
      backgroundColor: surface.card,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: hair2,
      overflow: 'hidden',
      flexShrink: 0, // hauteur dictée par le contenu, jamais par la colonne
    },
    rail: { position: 'absolute', left: 0, top: 0, bottom: 0, width: RAIL },

    header: {
      flexDirection: 'row',
      alignItems: 'stretch',
      gap,
      paddingLeft: RAIL + pad,
      paddingRight: gap,
      paddingVertical: pad,
      borderBottomWidth: 1,
      borderBottomColor: hair2,
    },
    noBox: {
      width: l.far(68),
      borderRadius: radius.sm,
      backgroundColor: surface.el,
      borderWidth: 1,
      borderColor: hair2,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 6,
    },
    noLabel: {
      fontFamily: type.micro.fontFamily,
      fontSize: l.fs(9),
      fontWeight: '800',
      letterSpacing: 1.4,
      color: ink.dimmer,
    },
    // Le chiffre que la cuisine crie au comptoir : c'est lui qui grossit le plus.
    noValue: {
      fontFamily: type.hero.fontFamily,
      fontSize: l.far(32),
      fontWeight: '900',
      letterSpacing: -1.1,
      lineHeight: l.far(34),
      color: palette.text,
      ...tabular,
    },

    headRight: { flex: 1, minWidth: 0, justifyContent: 'center', gap: 6 },
    headTop: { flexDirection: 'row', alignItems: 'baseline', gap: 10 },
    title: {
      flex: 1,
      minWidth: 0,
      fontFamily: type.title.fontFamily,
      fontSize: l.fs(16.5),
      fontWeight: '700',
      letterSpacing: -0.3,
      color: palette.text,
    },
    timer: {
      fontFamily: type.clock.fontFamily,
      fontSize: l.far(22),
      fontWeight: '800',
      letterSpacing: -0.6,
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
      marginLeft: RAIL + pad,
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

    items: { paddingLeft: RAIL + pad, paddingRight: gap, paddingVertical: 4 },
    itemRow: { flexDirection: 'row', gap: 10, paddingVertical: Math.round(8 * l.scale) },
    itemDivider: { borderBottomWidth: 1, borderBottomColor: hair2 },
    qty: {
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
      fontFamily: type.item.fontFamily,
      fontSize: l.far(16),
      fontWeight: '700',
      letterSpacing: -0.2,
      lineHeight: l.far(20),
      color: palette.text,
    },
    variant: {
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
      height: l.actionH,
      justifyContent: 'center',
      borderBottomLeftRadius: radius.md,
      borderBottomRightRadius: radius.md,
    },
    actionInner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
    actionText: {
      fontFamily: type.action.fontFamily,
      fontSize: l.far(15),
      fontWeight: '800',
      letterSpacing: 0.5,
      textTransform: 'uppercase',
    },
  });
});
