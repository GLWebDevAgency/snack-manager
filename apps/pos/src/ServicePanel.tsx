/**
 * LA VUE DU SERVICE — ce qui se passe en cuisine après qu'on a validé.
 *
 * Elle répond aux deux seules questions qu'un caissier pose entre deux ventes :
 * « qu'est-ce que j'appelle maintenant ? » et « celle de monsieur, elle en est
 * où ? ». Tout ce qu'elle affiche vient de la charge que le poste recevait
 * DÉJÀ toutes les douze secondes et jetait après en avoir lu sept champs.
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
 * • **Aucune action destructive ici.** La vue est en LECTURE : on n'y avance
 *   pas un statut. Faire avancer la cuisine depuis deux écrans créerait deux
 *   écrivains pour un même champ — c'est le métier du KDS, et la caisse n'a
 *   rien à y gagner qu'un conflit. Toucher une carte ouvre son détail.
 */
import { useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import {
  TIMER_THRESHOLDS,
  euros,
  mmss,
  palette,
  timerColor,
  windowCountLabel,
  type OrderStatus,
} from '@sm/client-core';
import {
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_LABELS,
  PAYMENT_TENDER_LABELS,
  ORDER_STATUS_LABELS,
} from '@sm/contracts';
import { FONT, R, S, TABULAR, sheet, shadow, type, withAlpha, type Brand } from './theme';
import { EmptyState, Overlay, PanelHead, Press } from './ui';
import { serviceColumns, useLayout } from './useLayout';
import {
  grouperParStatut,
  heureCourte,
  type ServiceCommande,
} from './service-state';

/**
 * Teinte fonctionnelle d'un statut de service.
 *
 * Strictement la même sémantique que l'écran cuisine (`apps/kds/src/ui.ts`) :
 * vert = prêt · ambre = en préparation · rouge = reçu, personne ne l'a encore
 * prise en main. Elle n'est JAMAIS personnalisée par l'accent du restaurant.
 */
const TON: Record<OrderStatus, string> = {
  ready: palette.green,
  preparing: palette.amber,
  new: palette.red,
  delivered: palette.mut,
  cancelled: palette.mut,
};

export function ServicePanel({
  commandes,
  now,
  brand,
  /** Fraîcheur de la dernière lecture serveur — jamais un chiffre figé. */
  fraicheurLabel,
  fraicheurPerimee,
  /** La fenêtre serveur est plafonnée : on ne montre pas tout. */
  truncated,
  total,
}: {
  commandes: ServiceCommande[];
  now: number;
  brand: Brand;
  fraicheurLabel: string;
  fraicheurPerimee: boolean;
  truncated: boolean;
  total: number;
}) {
  const L = useLayout();
  const [detail, setDetail] = useState<ServiceCommande | null>(null);
  const groupes = useMemo(() => grouperParStatut(commandes), [commandes]);

  const pad = L.gridPad;
  const disponible = L.width - pad * 2;
  const cols = serviceColumns(disponible, L);
  const largeur = (disponible - L.gridGap * (cols - 1)) / cols;

  return (
    <View style={{ flex: 1, backgroundColor: palette.bg }}>
      <Bandeau
        fraicheurLabel={fraicheurLabel}
        perimee={fraicheurPerimee}
        truncated={truncated}
        total={total}
        enCours={commandes.length}
      />

      <ScrollView contentContainerStyle={{ padding: pad, paddingBottom: L.sp(40), gap: L.sp(S.lg) }}>
        {commandes.length === 0 ? (
          <EmptyState
            title="Rien en cours"
            sub="Les commandes validées à la caisse et celles arrivées en ligne apparaîtront ici, de la plus urgente à la plus récente."
          />
        ) : (
          groupes.map((groupe) => (
            <View key={groupe.status} style={{ gap: L.sp(S.md) }}>
              <EnTeteGroupe
                label={groupe.label}
                count={groupe.commandes.length}
                tone={TON[groupe.status]}
              />
              {groupe.commandes.length === 0 ? (
                <Text style={[type.mut, { fontSize: L.fs(13), paddingLeft: 2 }]}>
                  {vide(groupe.status)}
                </Text>
              ) : (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: L.gridGap }}>
                  {groupe.commandes.map((commande) => (
                    <Carte
                      key={commande.id}
                      commande={commande}
                      now={now}
                      width={largeur}
                      onOpen={() => setDetail(commande)}
                    />
                  ))}
                </View>
              )}
            </View>
          ))
        )}
      </ScrollView>

      {detail ? (
        <DetailCommande commande={detail} now={now} brand={brand} onClose={() => setDetail(null)} />
      ) : null}
    </View>
  );
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
  truncated,
  total,
  enCours,
}: {
  fraicheurLabel: string;
  perimee: boolean;
  truncated: boolean;
  total: number;
  enCours: number;
}) {
  const L = useLayout();
  const ton = perimee ? palette.amber : palette.mut;
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
        {/* Le MÊME compte que la pastille de la barre haute, mis en forme de
            la même façon : « ≥ » dès que la fenêtre serveur est plafonnée. */}
        <Text style={[type.mut, { fontSize: L.fs(13) }]}>
          · {windowCountLabel(enCours, truncated)} en cours
        </Text>
      </View>

      {/*
        Le serveur plafonne `GET /orders` à 200 lignes et dit `truncated` pour
        que l'écran refuse de conclure plutôt que de conclure faux. La vue du
        service porte donc la même réserve que la clôture.
      */}
      {truncated ? (
        <Text style={{ fontFamily: FONT, color: palette.amber, fontSize: L.fs(12.5), fontWeight: '600' }}>
          Journée à {total} commandes : le serveur n’en renvoie que les 200 plus
          récentes. Les plus anciennes ne sont pas dans cette vue — ni dans le Z.
        </Text>
      ) : null}
    </View>
  );
}

function EnTeteGroupe({ label, count, tone }: { label: string; count: number; tone: string }) {
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
          {mmss(secondes)}
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
              À APPELER
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
              // encaisser, qui est l'erreur que le Z retrouve le soir.
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
}: {
  commande: ServiceCommande;
  now: number;
  brand: Brand;
  onClose: () => void;
}) {
  const L = useLayout();
  const row = commande.row;
  const secondes = Math.max(0, (now - commande.createdAtMs) / 1000);
  const lignes = row.lines ?? [];
  const remise = row.totals?.discount ?? null;
  const tone = TON[commande.status];

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
              {mmss(secondes)}
            </Text>
          </View>
          <Text style={[type.mut, { fontSize: L.fs(13) }]}>
            {commande.reperage ? `${commande.reperage} · ` : ''}
            Prise à {heureCourte(row.createdAt) ?? '--:--'}
            {secondes / 60 >= TIMER_THRESHOLDS.late ? ' · attend depuis longtemps' : ''}
          </Text>
        </View>

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
                : PAYMENT_METHOD_LABELS.counter
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
