/**
 * Barre haute (zone A) — identité du restaurant, VUE, mode de service, état de
 * la file offline, horloge et accès au récapitulatif local.
 *
 * Elle reste visible sous toutes les surcouches : c'est le seul repère fixe du
 * poste pendant un coup de feu.
 *
 * ─── DEUX SÉLECTEURS, TROIS COMPOSITIONS ─────────────────────────────────
 *
 * Elle en portait un — le mode de service. La vue du service en ajoute un
 * second (Vendre / Le service), et deux sélecteurs ne tiennent pas partout où
 * un seul tenait. Plutôt que d'en tronquer un — cacher le mode de service, qui
 * décide du CONTENU de la commande, ou la bascule de vue, qui décide de ce
 * qu'on regarde —, la barre se réorganise :
 *
 *   ≥ 1180 px  une rangée : identité · vue · mode · pastilles · horloge · actions
 *   560–1180   deux rangées : la première sans les sélecteurs, la seconde
 *              partagée entre les deux (cinq onglets, ≈ 100 px chacun au pire)
 *   < 560 px   trois rangées : chaque sélecteur prend la sienne
 *
 * Les deux seuils sont dans `layout.ts`, seul décideur de dimension du poste,
 * et la tablette de RÉFÉRENCE (1280 × 800) garde donc sa barre sur une ligne.
 */
import { Pressable, Text, View } from 'react-native';
import { palette } from '@sm/client-core';
import { FONT, R, S, sheet, shadow, type, withAlpha, type Brand } from './theme';
import { MODE_LABEL, type Mode } from './pos-state';
import { Press, Segmented, Sheen } from './ui';
import { useLayout } from './useLayout';
import type { ServiceBadgeTone } from './service-reconciliation';

/** Ce que le poste montre : la vente en cours, ou l'état du service. */
export type Vue = 'vente' | 'service';

export function TopBar({
  brand,
  staffName,
  vue,
  onVue,
  serviceBadge,
  serviceTone,
  mode,
  onMode,
  pending,
  syncing,
  offline,
  rejets,
  onRejets,
  now,
  onRecap,
  onLock,
}: {
  brand: Brand;
  staffName: string;
  vue: Vue;
  onVue: (v: Vue) => void;
  /**
   * Commandes RÉELLEMENT en cours — ni remises, ni annulées.
   *
   * Déjà mis en forme par l'appelant : tiret avant la première lecture,
   * marqueur si la photo est périmée, et « ≈ » seulement si le compte actif
   * est inexact. Le total peut rester exact même quand toutes les cartes ne
   * tiennent pas dans une fenêtre de statut.
   */
  serviceBadge: string;
  /** Ambre si prudence requise, vert si une prête vient d'une photo fiable. */
  serviceTone: ServiceBadgeTone;
  mode: Mode;
  onMode: (m: Mode) => void;
  pending: number;
  syncing: boolean;
  offline: boolean;
  /** Ventes refusées définitivement par le serveur — à ressaisir. */
  rejets: number;
  onRejets: () => void;
  now: number;
  onRecap: () => void;
  onLock: () => void;
}) {
  const L = useLayout();
  const d = new Date(now);
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const ss = String(d.getSeconds()).padStart(2, '0');
  const compact = L.compact;
  const stacked = L.topbarStacked;
  const split = L.topbarSelectorsSplit;
  /** Sous 560 px, l'identité textuelle cède la place aux actions. */
  const showIdentityText = L.width >= 560;

  /**
   * LA BASCULE DE VUE, ET SA PASTILLE.
   *
   * « Le service » porte le nombre de commandes en cours. C'est la seule
   * information que le poste n'avait nulle part : le compteur « Service · N »
   * d'avant comptait les ventes de CE poste depuis l'ouverture du service —
   * pas les commandes encore en cuisine, et jamais la vente en ligne.
   *
   * Quand une commande est prête, la pastille passe au vert fonctionnel
   * uniquement si la photo est fiable. Une lecture absente, périmée ou
   * partielle reste ambre, même si une ancienne carte était prête. Le
   * caractère non atomique du compte, lui, est déjà porté par « ≈ ».
   */
  const vues = (
    <Segmented
      value={vue}
      onChange={onVue}
      accent={brand.accent}
      onAccent={brand.onAccent}
      flex={stacked}
      badge={
        serviceTone === 'warning'
          ? palette.amber
          : serviceTone === 'ready'
            ? palette.green
            : undefined
      }
      options={[
        { key: 'vente', label: 'Vendre' },
        { key: 'service', label: 'Le service', detail: serviceBadge },
      ]}
    />
  );

  const segmented = (
    <Segmented
      value={mode}
      onChange={onMode}
      accent={brand.accent}
      onAccent={brand.onAccent}
      flex={stacked}
      options={[
        { key: 'surplace', label: MODE_LABEL.surplace },
        { key: 'emporter', label: MODE_LABEL.emporter },
        { key: 'tel', label: MODE_LABEL.tel },
      ]}
    />
  );

  /**
   * LES VENTES REFUSÉES — la pastille rouge qui n'existait pas.
   *
   * Un refus définitif du serveur retirait l'entrée de la file et la jetait :
   * sur une commande déjà encaissée, l'argent est dans le tiroir, le client est
   * parti, et la vente n'existe nulle part. Rien à l'écran ne le disait.
   *
   * Elle passe AVANT la pastille de file d'attente : « en attente » est un état
   * normal du service, « refusée » demande un geste.
   */
  const rejetes =
    rejets > 0 ? (
      <Pressable
        onPress={onRejets}
        accessibilityRole="button"
        accessibilityLabel={`${rejets} vente${rejets > 1 ? 's' : ''} refusée${rejets > 1 ? 's' : ''} — à ressaisir`}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          paddingHorizontal: 12,
          minHeight: 36,
          borderRadius: R.pill,
          backgroundColor: withAlpha(palette.red, 0.14),
          borderWidth: 1,
          borderColor: withAlpha(palette.red, 0.4),
        }}
      >
        <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: palette.red }} />
        <Text style={{ fontFamily: FONT, color: palette.red, fontSize: L.fs(13), fontWeight: '700' }}>
          {rejets} refusée{rejets > 1 ? 's' : ''}
        </Text>
      </Pressable>
    ) : null;

  const status =
    pending > 0 || offline ? (
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          paddingHorizontal: 12,
          minHeight: 36,
          borderRadius: R.pill,
          backgroundColor: withAlpha(palette.amber, 0.12),
          borderWidth: 1,
          borderColor: withAlpha(palette.amber, 0.3),
        }}
      >
        <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: palette.amber }} />
        <Text style={{ fontFamily: FONT, color: palette.amber, fontSize: L.fs(13), fontWeight: '700' }}>
          {pending > 0 ? `${pending}${compact ? '' : ' en attente'}${syncing ? ' · envoi…' : ''}` : 'Hors ligne'}
        </Text>
      </View>
    ) : null;

  return (
    <View
      style={[
        {
          flexDirection: 'column',
          paddingHorizontal: S.lg,
          paddingVertical: stacked ? S.sm : 0,
          gap: stacked ? S.sm : 0,
          backgroundColor: palette.surface,
          borderBottomWidth: 1,
          borderBottomColor: palette.line,
        },
        shadow(1),
      ]}
    >
      <Sheen intensity={0.7} />

      <View style={{ height: L.topbarH, flexDirection: 'row', alignItems: 'center', gap: compact ? S.sm : S.lg }}>
        {/* Identité */}
        <View style={[sheet.row, { gap: 11 }]}>
          <View
            style={{
              width: L.sp(38),
              height: L.sp(38),
              borderRadius: 11,
              backgroundColor: brand.accent,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={{ fontFamily: FONT, color: brand.onAccent, fontSize: L.fs(19), fontWeight: '800' }}>
              {brand.initial}
            </Text>
          </View>
          {showIdentityText ? (
            <View>
              <Text style={[type.h2, { fontSize: L.fs(16) }]} numberOfLines={1}>
                {brand.name}
              </Text>
              <Text style={[type.mut, { fontSize: L.fs(12.5), marginTop: 1 }]} numberOfLines={1}>
                Poste 1 · {staffName}
              </Text>
            </View>
          ) : null}
        </View>

        {/* Les deux sélecteurs — sur leur propre rangée dès 1180 px */}
        <View
          style={{
            flex: 1,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: S.sm,
          }}
        >
          {stacked ? null : vues}
          {stacked ? null : segmented}
        </View>

        {rejetes}
        {status}

        {/* Horloge — les secondes sautent en premier quand la place manque */}
        <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
          <Text style={[type.display, { fontSize: L.fs(21) }]}>{hm}</Text>
          {compact ? null : (
            <Text style={[type.num, { fontSize: L.fs(13), color: palette.mut, fontWeight: '600' }]}>:{ss}</Text>
          )}
        </View>

        {/*
          Ce bouton ouvre uniquement le journal de CETTE caisse. Le suivi actif
          reste sur la bascule de vue et inclut aussi le web ; aucune fermeture
          comptable ou globale n'est promise ici.
        */}
        <BarButton label={compact ? 'Récap' : 'Récapitulatif'} accessibilityLabel="Récapitulatif local du poste" onPress={onRecap} />
        <BarButton label={compact ? 'Verrou' : 'Verrouiller'} accessibilityLabel="Verrouiller" onPress={onLock} />
      </View>

      {/* Seconde rangée : les deux sélecteurs se partagent la largeur, sauf
          sous 560 px où « À emporter » se ferait couper en plein mot. */}
      {stacked ? (
        split ? (
          <>
            {vues}
            {segmented}
          </>
        ) : (
          <View style={{ flexDirection: 'row', gap: S.sm }}>
            <View style={{ flex: 2 }}>{vues}</View>
            <View style={{ flex: 3 }}>{segmented}</View>
          </View>
        )
      ) : null}
    </View>
  );
}

/**
 * Action de barre. Elle portait une pastille numérique optionnelle, qui ne
 * servait qu'au compteur « Service · N » — un compteur qui mentait, et qui vit
 * désormais sur la bascule de vue. Deux boutons, deux libellés, rien de plus.
 */
function BarButton({
  label,
  onPress,
  accessibilityLabel,
}: {
  label: string;
  onPress: () => void;
  accessibilityLabel?: string;
}) {
  const L = useLayout();
  return (
    <Press
      onPress={onPress}
      accessibilityLabel={accessibilityLabel ?? label}
      style={{
        minHeight: L.touch(),
        paddingHorizontal: L.compact ? 11 : 14,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        borderRadius: R.pill,
        borderWidth: 1,
        borderColor: palette.line,
        backgroundColor: palette.surface2,
      }}
      activeStyle={{ backgroundColor: '#282828' }}
    >
      <Text style={{ fontFamily: FONT, color: palette.text, fontSize: L.fs(13.5), fontWeight: '600' }}>{label}</Text>
    </Press>
  );
}
