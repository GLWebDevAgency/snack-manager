import { palette as statusPalette } from '@sm/client-core';
import { useTheme } from './theme';
/**
 * LA VUE DU SERVICE — ce qui se passe en cuisine après qu'on a validé.
 *
 * Elle répond aux deux seules questions qu'un caissier pose entre deux ventes :
 * « qu'est-ce que j'appelle maintenant ? » et « celle de monsieur, elle en est
 * où ? ». Elle vient des trois lectures opérationnelles sans borne temporelle,
 * indépendantes du journal local de cette caisse.
 *
 * ─── LES MOTIFS DE CAISSE RETENUS ────────────────────────────────────────
 *
 * • **Groupée par statut, PRÊTES en tête.** Voir `service-state.ts` : au
 *   comptoir, le seul groupe qui demande un geste est celui des commandes
 *   prêtes. Une liste triée à plat par heure les noierait au milieu.
 *
 * • **Une commande prête se voit sans lire.** Filet vert épais, fond teinté,
 *   mention « À APPELER » : c'est reconnaissable de dos, en tendant un plateau.
 *   Les couleurs sont les FONCTIONNELLES du noyau partagé — vert prêt, ambre en
 *   préparation, rouge reçu/urgent — donc identiques à l'écran cuisine. Un
 *   équipier qui lève les yeux du KDS lit la caisse de la même façon.
 *
 * • **Lisible à un mètre.** Le numéro de retrait est l'élément le plus gros de
 *   la carte, suivi du minuteur. Les deux suivent `L.fs()`, donc grandissent
 *   sur un grand écran de comptoir.
 *
 * • **La liste ne saute jamais sous le doigt.** Le tri interne se fait sur
 *   l'heure de création, jamais sur le minuteur, et les groupes vides restent
 *   affichés. Un changement de statut déplace UNE carte ; il ne réorganise
 *   rien d'autre.
 *
 * • **Responsabilités distinctes.** La cuisine prépare ; la caisse constate
 *   la remise physique d'une commande prête et déjà payée. Ce seul geste est
 *   confirmé en ligne, jamais optimiste. Toucher une carte ouvre son détail,
 *   sans changer de statut ni encaisser implicitement.
 */
import { useMemo, useRef, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { TIMER_THRESHOLDS, euros, timerColor, type OrderStatus } from '@sm/client-core';
import {
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_LABELS,
  PAYMENT_TENDER_LABELS,
  ORDER_STATUS_LABELS,
} from '@sm/contracts';
import { FONT, R, S, TABULAR, withAlpha, type Brand } from './theme';
import { Btn, EmptyState, Overlay, PanelHead, Press } from './ui';
import { serviceColumns, useLayout } from './useLayout';
import {
  grouperParStatut,
  heureCourte,
  serviceReadyLabel,
  type ServiceCommande,
  type ServerOrderRow,
} from './service-state';
import { canConfirmCounterHandover } from './service-handover';
import { canCollectOrder, serviceAgeLabel } from './service-payment';
import type {
  ActiveOrderStatus,
  ServiceStatusCounts,
} from './service-reconciliation';

/**
 * Teinte fonctionnelle d'un statut de service.
 *
 * Strictement la même sémantique que l'écran cuisine (`apps/kds/src/ui.ts`) :
 * vert = prêt · ambre = en préparation · rouge = reçu, personne ne l'a encore
 * prise en main. Elle n'est JAMAIS personnalisée par l'accent du restaurant.
 */
const TON: Record<OrderStatus, string> = {
  ready: statusPalette.green,
  preparing: statusPalette.amber,
  new: statusPalette.red,
  delivered: statusPalette.mut,
  cancelled: statusPalette.mut,
};

export function ServicePanel({
  commandes,
  now,
  brand,
  /** Fraîcheur de la dernière lecture serveur — jamais un chiffre figé. */
  fraicheurLabel,
  fraicheurPerimee,
  loaded,
  activeCount,
  activeCountExact,
  statusCounts,
  servicePartial,
  failedStatuses,
  truncatedStatuses,
  onConfirmHandover,
  onCollectPayment,
  offline,
}: {
  commandes: ServiceCommande[];
  now: number;
  brand: Brand;
  fraicheurLabel: string;
  fraicheurPerimee: boolean;
  loaded: boolean;
  activeCount: number;
  activeCountExact: boolean;
  statusCounts: ServiceStatusCounts | null;
  servicePartial: boolean;
  failedStatuses: ActiveOrderStatus[];
  truncatedStatuses: ActiveOrderStatus[];
  onConfirmHandover?: (row: ServerOrderRow) => Promise<void>;
  onCollectPayment?: (row: ServerOrderRow) => void;
  offline?: boolean;
}) {
  const { palette, type } = useTheme();
  const L = useLayout();
  // L'identité reste stable ; le contenu est redérivé à chaque photo afin que
  // statut, paiement et historique bougent aussi dans une modale déjà ouverte.
  const [detailId, setDetailId] = useState<string | null>(null);
  const detail = useMemo(
    () => commandes.find((commande) => commande.id === detailId) ?? null,
    [commandes, detailId],
  );
  const groupes = useMemo(() => grouperParStatut(commandes), [commandes]);
  const observedEmpty = loaded && !servicePartial;

  const pad = L.gridPad;
  const disponible = L.width - pad * 2;
  const cols = serviceColumns(disponible, L);
  const largeur = (disponible - L.gridGap * (cols - 1)) / cols;

  return (
    <View style={{ flex: 1, backgroundColor: palette.bg }}>
      <Bandeau
        fraicheurLabel={fraicheurLabel}
        perimee={fraicheurPerimee}
        loaded={loaded}
        activeCount={activeCount}
        activeCountExact={activeCountExact}
        servicePartial={servicePartial}
        failedStatuses={failedStatuses}
        truncatedStatuses={truncatedStatuses}
      />

      <ScrollView contentContainerStyle={{ padding: pad, paddingBottom: L.sp(40), gap: L.sp(S.lg) }}>
        {commandes.length === 0 ? (
          <EmptyState
            title={
              observedEmpty
                ? 'Aucune commande active observée'
                : loaded
                  ? 'Vue du service incomplète'
                  : 'Service en attente d’actualisation'
            }
            sub={
              observedEmpty
                ? 'Les trois files actives viennent d’être relues ; le rafraîchissement continue automatiquement.'
                : loaded
                  ? 'Des commandes actives peuvent être hors de la fenêtre affichée. Réessayez dès que la connexion revient.'
                  : 'Aucun état des commandes n’a encore été reçu du serveur.'
            }
          />
        ) : (
          groupes.map((groupe) => (
            <View key={groupe.status} style={{ gap: L.sp(S.md) }}>
              <EnTeteGroupe
                label={groupe.label}
                count={statusCountLabel(
                  statusCounts?.[groupe.status as ActiveOrderStatus]?.value ??
                    groupe.commandes.length,
                  statusCounts?.[groupe.status as ActiveOrderStatus]?.exact ?? false,
                )}
                tone={TON[groupe.status]}
              />
              {groupe.commandes.length === 0 ? (
                <Text style={[type.mut, { fontSize: L.fs(13), paddingLeft: 2 }]}>
                  {statusCounts?.[groupe.status as ActiveOrderStatus]?.complete
                    ? vide(groupe.status)
                    : 'Vue incomplète — des commandes peuvent manquer dans ce groupe.'}
                </Text>
              ) : (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: L.gridGap }}>
                  {groupe.commandes.map((commande) => (
                    <Carte
                      key={commande.id}
                      commande={commande}
                      now={now}
                      width={largeur}
                      onOpen={() => setDetailId(commande.id)}
                    />
                  ))}
                </View>
              )}
            </View>
          ))
        )}
      </ScrollView>

      {detail ? (
        <DetailCommande
          commande={detail}
          now={now}
          brand={brand}
          onClose={() => setDetailId(null)}
          onConfirmHandover={onConfirmHandover}
          onCollectPayment={onCollectPayment}
          offline={offline}
        />
      ) : null}
    </View>
  );
}

function statusCountLabel(count: number, exact: boolean): string {
  return exact ? String(count) : `≈ ${count}`;
}

/** Formulé par statut : plus utile qu'un tiret générique répété trois fois. */
function vide(status: OrderStatus): string {
  if (status === 'ready') return 'Rien à appeler au comptoir.';
  if (status === 'preparing') return 'Rien en préparation.';
  return 'Aucune commande en attente de prise en charge.';
}

/**
 * LA FRAÎCHEUR, DITE — et la coupe de la fenêtre, dite aussi.
 *
 * Une caisse travaille hors ligne. Le pire affichage possible pendant une
 * coupure est un compteur figé qui ressemble à un compteur vivant : on croit
 * lire l'état du service, on lit une photo de tout à l'heure. Cette bande dit
 * DEPUIS QUAND, et passe en ambre dès que la photo n'est plus récente.
 */
function Bandeau({
  fraicheurLabel,
  perimee,
  loaded,
  activeCount,
  activeCountExact,
  servicePartial,
  failedStatuses,
  truncatedStatuses,
}: {
  fraicheurLabel: string;
  perimee: boolean;
  loaded: boolean;
  activeCount: number;
  activeCountExact: boolean;
  servicePartial: boolean;
  failedStatuses: ActiveOrderStatus[];
  truncatedStatuses: ActiveOrderStatus[];
}) {
  const { palette, type } = useTheme();
  const L = useLayout();
  const ton = perimee || servicePartial ? palette.amber : palette.mut;
  const count = loaded ? statusCountLabel(activeCount, activeCountExact) : '—';
  const labels = (statuses: readonly ActiveOrderStatus[]) =>
    statuses.map((status) => ORDER_STATUS_LABELS[status]).join(', ');
  return (
    <View
      style={{
        paddingHorizontal: L.gridPad,
        paddingVertical: L.sp(9),
        gap: 6,
        borderBottomWidth: 1,
        borderBottomColor: palette.line2,
        backgroundColor: perimee ? '#161104' : palette.surface,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: ton }} />
        <Text
          accessibilityLiveRegion="polite"
          style={{ fontFamily: FONT, color: ton, fontSize: L.fs(13), fontWeight: '700' }}
        >
          {fraicheurLabel}
          {perimee ? ' — cet écran n’est plus à jour' : ''}
        </Text>
        {/* Le MÊME compte que la pastille de la barre haute. Une coupe de la
            liste n'ajoute pas « ≈ » si le serveur a tout de même rendu son
            total ; seul un compte réellement inconnu le fait. */}
        <Text style={[type.mut, { fontSize: L.fs(13) }]}>
          · {count} en cours
        </Text>
      </View>

      {failedStatuses.length > 0 ? (
        <Text style={{ fontFamily: FONT, color: palette.amber, fontSize: L.fs(12.5), fontWeight: '600' }}>
          Lecture impossible pour {labels(failedStatuses)} : le compteur est
          estimé et des commandes peuvent manquer.
        </Text>
      ) : null}
      {truncatedStatuses.length > 0 ? (
        <Text style={{ fontFamily: FONT, color: palette.amber, fontSize: L.fs(12.5), fontWeight: '600' }}>
          Plus de 200 commandes pour {labels(truncatedStatuses)} : le total est
          connu, mais toutes les cartes ne tiennent pas dans cette vue.
        </Text>
      ) : null}
    </View>
  );
}

function EnTeteGroupe({ label, count, tone }: { label: string; count: string; tone: string }) {
  const { palette } = useTheme();
  const L = useLayout();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: tone }} />
      <Text
        accessibilityRole="header"
        style={{
          fontFamily: FONT,
          color: palette.text,
          fontSize: L.fs(16),
          fontWeight: '800',
          letterSpacing: -0.2,
        }}
      >
        {label}
      </Text>
      <View
        style={{
          minWidth: 26,
          paddingHorizontal: 7,
          paddingVertical: 2,
          borderRadius: R.pill,
          backgroundColor: withAlpha(tone, 0.16),
        }}
      >
        <Text
          style={{
            fontFamily: FONT,
            color: tone,
            fontSize: L.fs(12.5),
            fontWeight: '800',
            textAlign: 'center',
            ...TABULAR,
          }}
        >
          {count}
        </Text>
      </View>
      <View style={{ flex: 1, height: 1, backgroundColor: palette.line2 }} />
    </View>
  );
}

function Carte({
  commande,
  now,
  width,
  onOpen,
}: {
  commande: ServiceCommande;
  now: number;
  width: number;
  onOpen: () => void;
}) {
  const { palette, shadow, type, sheet } = useTheme();
  const L = useLayout();
  const secondes = Math.max(0, (now - commande.createdAtMs) / 1000);
  const minuteur = timerColor(secondes / 60);
  const prete = commande.status === 'ready';
  const tone = TON[commande.status];

  return (
    <Press
      onPress={onOpen}
      accessibilityLabel={`Commande ${commande.number}, ${commande.statusLabel}, ${commande.channelLabel}, ${euros(commande.totalCents)}${commande.reperage ? `, ${commande.reperage}` : ''}. Voir le détail.`}
      scale={0.985}
      style={[
        {
          width,
          borderRadius: R.card,
          // Le filet de gauche porte le statut : c'est ce qu'on lit en
          // balayant une colonne du regard, avant même le texte.
          borderLeftWidth: prete ? 5 : 3,
          borderLeftColor: tone,
          borderTopWidth: 1,
          borderRightWidth: 1,
          borderBottomWidth: 1,
          borderColor: prete ? withAlpha(palette.green, 0.45) : palette.line2,
          backgroundColor: prete ? withAlpha(palette.green, 0.08) : palette.surface,
          padding: L.sp(S.md),
          gap: L.sp(7),
        },
        prete ? shadow(1) : null,
      ]}
      activeStyle={{ backgroundColor: prete ? withAlpha(palette.green, 0.14) : palette.surface2 }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: L.sp(S.md) }}>
        <Text style={[type.display, { fontSize: L.fs(30), lineHeight: L.fs(34) }]}>
          {commande.number}
        </Text>
        <View style={{ flex: 1 }} />
        {/* Le minuteur porte sa propre couleur — les seuils du paquet partagé,
            ceux-là mêmes que la cuisine applique à ses tickets. */}
        <Text
          accessibilityLabel={`Depuis ${Math.floor(secondes / 60)} minutes`}
          style={[type.display, { fontSize: L.fs(20), color: minuteur }]}
        >
          {serviceAgeLabel(secondes)}
        </Text>
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
        {prete ? (
          <View
            style={{
              paddingHorizontal: 8,
              paddingVertical: 3,
              borderRadius: R.pill,
              backgroundColor: palette.green,
            }}
          >
            <Text
              style={{
                fontFamily: FONT,
                color: '#08120a',
                fontSize: L.fs(11.5),
                fontWeight: '800',
                letterSpacing: 0.6,
              }}
            >
              {serviceReadyLabel(commande.row)}
            </Text>
          </View>
        ) : (
          <Text style={{ fontFamily: FONT, color: tone, fontSize: L.fs(12.5), fontWeight: '700' }}>
            {commande.statusLabel}
          </Text>
        )}
        <Text style={[type.mut, { fontSize: L.fs(12.5) }]} numberOfLines={1}>
          {commande.channelLabel} · {commande.typeLabel}
        </Text>
      </View>

      <View style={[sheet.between, { gap: S.sm }]}>
        <Text style={[type.strong, { fontSize: L.fs(14), flex: 1 }]} numberOfLines={1}>
          {commande.reperage ?? '—'}
        </Text>
        <Text
          style={[
            type.num,
            {
              fontSize: L.fs(15),
              fontWeight: '800',
              // Non encaissée : le montant est ce qu'il restera à percevoir au
              // moment de la remise. Le dire ici évite de rendre un plat sans
              // encaisser, qui fausserait ensuite le suivi d'encaissement.
              color: commande.paid ? palette.text : palette.amber,
            },
          ]}
        >
          {euros(commande.totalCents)}
          {commande.paid ? '' : ' ·  à encaisser'}
        </Text>
      </View>
    </Press>
  );
}

// ─────────────────────────────────────────────────────────────
// Détail d'une commande — tout vient de la charge déjà reçue
// ─────────────────────────────────────────────────────────────

export function DetailCommande({
  commande,
  now,
  brand,
  onClose,
  onConfirmHandover,
  onCollectPayment,
  offline,
}: {
  commande: ServiceCommande;
  now: number;
  brand: Brand;
  onClose: () => void;
  onConfirmHandover?: (row: ServerOrderRow) => Promise<void>;
  onCollectPayment?: (row: ServerOrderRow) => void;
  offline?: boolean;
}) {
  const { sheet, type, palette } = useTheme();
  const L = useLayout();
  const row = commande.row;
  const secondes = Math.max(0, (now - commande.createdAtMs) / 1000);
  const lignes = row.lines ?? [];
  const remise = row.totals?.discount ?? null;
  const tone = TON[commande.status];
  const [confirming, setConfirming] = useState(false);
  const [handoverError, setHandoverError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const confirmHandover = async () => {
    if (!onConfirmHandover || inFlight.current || offline || !canConfirmCounterHandover(row)) return;
    inFlight.current = true;
    setConfirming(true);
    setHandoverError(null);
    try {
      await onConfirmHandover(row);
    } catch (error) {
      setHandoverError(error instanceof Error ? error.message : 'La remise n’a pas été confirmée.');
    } finally {
      inFlight.current = false;
      setConfirming(false);
    }
  };

  return (
    <Overlay onClose={onClose} accessibilityLabel={`Commande ${commande.number}`} width={520}>
      <PanelHead
        title={`Commande n° ${commande.number}`}
        sub={`${commande.channelLabel} · ${commande.typeLabel} · ${commande.statusLabel}`}
        onClose={onClose}
      />
      <View style={sheet.hairline} />

      <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ padding: L.sp(S.xl), gap: L.sp(S.lg) }}>
        {/* Entête d'état : statut, minuteur, repérage du client */}
        <View
          style={[
            sheet.inset,
            {
              padding: S.md,
              borderColor: withAlpha(tone, 0.35),
              backgroundColor: withAlpha(tone, 0.08),
              gap: 6,
            },
          ]}
        >
          <View style={sheet.between}>
            <Text style={{ fontFamily: FONT, color: tone, fontSize: L.fs(15), fontWeight: '800' }}>
              {commande.statusLabel}
            </Text>
            <Text style={[type.display, { fontSize: L.fs(20), color: timerColor(secondes / 60) }]}>
              {serviceAgeLabel(secondes)}
            </Text>
          </View>
          <Text style={[type.mut, { fontSize: L.fs(13) }]}>
            {commande.reperage ? `${commande.reperage} · ` : ''}
            Prise à {heureCourte(row.createdAt) ?? '--:--'}
            {secondes / 60 >= TIMER_THRESHOLDS.late ? ' · attend depuis longtemps' : ''}
          </Text>
        </View>

        {row.type === 'delivery' && row.delivery ? (
          <View style={[sheet.inset, { padding: S.md, gap: 6 }]}>
            <Text style={type.eyebrow}>Livraison · {row.delivery.dispatchedAt ? 'En route' : 'Départ à organiser'}</Text>
            <Text style={[type.strong, { fontSize: L.fs(14) }]}>{[row.delivery.address.line1, row.delivery.address.line2, `${row.delivery.address.postalCode} ${row.delivery.address.city}`].filter(Boolean).join(', ')}</Text>
            {row.delivery.instructions ? <Text style={type.mut}>{row.delivery.instructions}</Text> : null}
            {row.pickup?.slot ? <Text style={type.mut}>Arrivée estimée · {heureCourte(row.pickup.slot)}</Text> : null}
            <Text style={type.mut}>{row.delivery.dispatchedAt ? `Départ confirmé à ${heureCourte(row.delivery.dispatchedAt)}${row.delivery.driverName ? ` · ${row.delivery.driverName}` : ''}` : 'Confirmez le départ du livreur depuis les commandes du back-office.'}</Text>
          </View>
        ) : null}

        {onCollectPayment && canCollectOrder(row) ? (
          <View style={[sheet.inset, { padding: S.md, gap: S.sm }]}>
            <Text style={type.eyebrow}>À encaisser au comptoir</Text>
            <Text style={type.mut}>Enregistrez le règlement sur cette commande, sans la recréer. La remise au client sera confirmée séparément.</Text>
            <Btn label={`Encaisser · ${euros(commande.totalCents)}`} kind="primary" accent={brand.accent} onAccent={brand.onAccent} disabled={offline || confirming} onPress={() => onCollectPayment(row)} block accessibilityLabel={`Encaisser la commande ${commande.number}`} />
            {offline ? <Text style={type.mut}>Connexion requise pour vérifier et confirmer le paiement.</Text> : null}
          </View>
        ) : null}

        {row.status === 'ready' && row.type !== 'delivery' && onConfirmHandover ? (
          <View style={[sheet.inset, { padding: S.md, gap: S.sm }]}>
            <Text style={type.eyebrow}>Remise au client</Text>
            <Text style={type.mut}>
              {commande.paid
                ? 'Confirmez uniquement après avoir remis la commande au client.'
                : canCollectOrder(row) && onCollectPayment
                  ? 'Encaissez d’abord cette commande. Confirmez ensuite sa remise, une fois le client servi.'
                  : 'Le paiement de cette commande n’est pas confirmé. Faites vérifier la commande existante dans le back-office par un responsable habilité, sans la recréer en caisse.'}
            </Text>
            <Btn
              label={confirming ? 'Confirmation en cours…' : 'Confirmer la remise'}
              kind="primary"
              accent={brand.accent}
              onAccent={brand.onAccent}
              disabled={confirming || offline || !canConfirmCounterHandover(row)}
              onPress={() => void confirmHandover()}
              block
              accessibilityLabel={`Confirmer la remise au client de la commande ${commande.number}`}
            />
            {offline ? <Text style={type.mut}>Connexion requise pour confirmer la remise.</Text> : null}
            {handoverError ? <Text accessibilityRole="alert" style={[type.mut, { color: palette.red }]}>{handoverError}</Text> : null}
          </View>
        ) : null}

        {/* Les lignes, avec variantes, options, retraits et notes */}
        <View style={{ gap: S.sm }}>
          <Text style={type.eyebrow}>Détail</Text>
          {lignes.length === 0 ? (
            <Text style={[type.mut, { fontSize: L.fs(13) }]}>
              Le serveur n’a pas renvoyé le détail des lignes pour cette commande.
            </Text>
          ) : (
            lignes.map((ligne, i) => (
              <View
                key={`${ligne.productId}-${i}`}
                style={[sheet.inset, { padding: S.md, gap: 4 }]}
              >
                <View style={sheet.between}>
                  <Text style={[type.strong, { fontSize: L.fs(15), flex: 1 }]}>
                    {ligne.qty} × {ligne.name}
                  </Text>
                  <Text style={[type.num, { fontSize: L.fs(15), fontWeight: '700' }]}>
                    {euros(ligne.lineTotal)}
                  </Text>
                </View>
                {ligne.variantName ? (
                  <Text style={[type.mut, { fontSize: L.fs(13) }]}>{ligne.variantName}</Text>
                ) : null}
                {ligne.options.length > 0 ? (
                  <Text style={[type.mut, { fontSize: L.fs(13) }]}>
                    {ligne.options.map((o) => o.name).join(' · ')}
                  </Text>
                ) : null}
                {/* Les retraits sont la première cause d'erreur de service :
                    même traitement d'alerte qu'en cuisine. */}
                {ligne.removed.length > 0 ? (
                  <Text
                    style={{
                      fontFamily: FONT,
                      color: palette.red,
                      fontSize: L.fs(13),
                      fontWeight: '800',
                      letterSpacing: 0.3,
                    }}
                  >
                    {ligne.removed.map((r) => `SANS ${r.toUpperCase()}`).join(' · ')}
                  </Text>
                ) : null}
                {ligne.note ? (
                  <Text style={{ fontFamily: FONT, color: palette.text, fontSize: L.fs(13) }}>
                    « {ligne.note} »
                  </Text>
                ) : null}
              </View>
            ))
          )}
        </View>

        {row.note ? (
          <View style={[sheet.inset, { padding: S.md, gap: 4 }]}>
            <Text style={type.eyebrow}>Note de la commande</Text>
            <Text style={{ fontFamily: FONT, color: palette.text, fontSize: L.fs(14) }}>
              « {row.note} »
            </Text>
          </View>
        ) : null}

        {/* Totaux et paiement */}
        <View style={{ gap: 2 }}>
          <Ligne label="Sous-total" value={euros(Math.round(row.totals?.subtotal ?? 0))} />
          {row.type === 'delivery' ? <Ligne label="Frais de livraison" value={euros(row.totals?.deliveryFee ?? row.delivery?.feeCents ?? 0)} /> : null}
          {remise ? (
            <Ligne
              label={`Remise · ${remise.reason ?? 'geste commercial'}`}
              value={`− ${euros(Math.round(remise.amount ?? 0))}`}
              tone={palette.green}
            />
          ) : null}
          <Ligne
            label="Total"
            value={euros(commande.totalCents)}
            tone={brand.accent}
            fort
          />
          <Ligne
            label={
              row.payment?.tender
                ? PAYMENT_TENDER_LABELS[row.payment.tender]
                : row.payment?.method === 'online' && !commande.paid ? 'Paiement en ligne' : PAYMENT_METHOD_LABELS[row.payment?.method ?? 'counter']
            }
            value={
              PAYMENT_STATUS_LABELS[
                (row.payment?.status ?? 'pending') as keyof typeof PAYMENT_STATUS_LABELS
              ] ?? '—'
            }
            tone={commande.paid ? palette.green : palette.amber}
          />
        </View>

        {/* L'historique daté : qui a fait avancer quoi, et quand */}
        <View style={{ gap: S.sm }}>
          <Text style={type.eyebrow}>Historique</Text>
          {(row.statusHistory ?? []).length === 0 ? (
            <Text style={[type.mut, { fontSize: L.fs(13) }]}>
              Aucun mouvement enregistré pour l’instant.
            </Text>
          ) : (
            (row.statusHistory ?? []).map((etape, i) => (
              <View
                key={`${etape.status}-${etape.at}-${i}`}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}
              >
                <View
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 4,
                    backgroundColor: TON[etape.status] ?? palette.mut,
                  }}
                />
                <Text style={[type.body, { fontSize: L.fs(14), flex: 1 }]}>
                  {ORDER_STATUS_LABELS[etape.status] ?? etape.status}
                </Text>
                <Text style={[type.num, { fontSize: L.fs(13), color: palette.mut }]}>
                  {heureCourte(etape.at) ?? '--:--'}
                </Text>
              </View>
            ))
          )}
        </View>
      </ScrollView>
    </Overlay>
  );
}

function Ligne({
  label,
  value,
  tone,
  fort,
}: {
  label: string;
  value: string;
  tone?: string;
  fort?: boolean;
}) {
  const { sheet, palette, type } = useTheme();
  const L = useLayout();
  return (
    <View
      style={[sheet.between, { paddingVertical: L.sp(10), borderBottomWidth: 1, borderBottomColor: palette.line2 }]}
    >
      <Text style={[type.mut, { fontSize: L.fs(14), flex: 1 }]} numberOfLines={2}>
        {label}
      </Text>
      <Text
        style={[
          type.num,
          { fontSize: L.fs(fort ? 18 : 15), fontWeight: '800', color: tone ?? palette.text },
        ]}
      >
        {value}
      </Text>
    </View>
  );
}
