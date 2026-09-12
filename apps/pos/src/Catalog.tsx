/**
 * Catalogue des trois dispositions : rail, onglets, grille et liste dense.
 *
 * La grille mesure sa largeur réelle (`onLayout`) puis demande à `useLayout()`
 * combien de colonnes y tiennent : 3 sur une petite tablette, 4 sur la
 * référence 1280, 5 à 6 sur un grand écran de comptoir. Les colonnes fixes en
 * pourcentage n'existent pas en RN, et un nombre figé donnerait soit des
 * cartes étirées, soit des noms tronqués.
 *
 * La présentation conserve le prix partagé, la disponibilité du serveur et
 * le cadrage des médias. Ajouter/configurer restent des actions du POS.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Animated, Easing, Image, Platform, ScrollView, Text, TextInput, View, type LayoutChangeEvent } from 'react-native';
import { basePrice, euros, type Category, type Product } from '@sm/client-core';
import { catalogueMedias, estPublic, mediasDuProduit, POINT_CENTRE, type MediaVue } from '@sm/contracts';
import { photoDuPoste, monogramme } from './photo';
import { FONT, R, S, useTheme, withAlpha, type Brand } from './theme';
import { EmptyState, Press, useReducedMotion } from './ui';
import { CategoryTabs, categoryIcon, railLabel } from './CategoryTabs';
import { Icon } from './Icon';
import { PoweredBy } from './PoweredBy';
import {
  cadrageVignette,
  cardWidth,
  columnsFor,
  useLayout,
  type Layout,
} from './useLayout';
import type { ParkedTicket } from './pos-state';
export { railLabel } from './CategoryTabs';

/** Comparaison insensible à la casse et aux accents. */
function norm(s: string): string {
  try {
    return s
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  } catch {
    return s.toLowerCase();
  }
}

export function CategoryRail({
  categories,
  activeId,
  onSelect,
  brand,
  dense = false,
}: {
  categories: Category[];
  activeId: string | null;
  onSelect: (id: string) => void;
  brand: Brand;
  dense?: boolean;
}) {
  const L = useLayout();
  const { palette } = useTheme();
  return (
    <View style={{ width: dense ? L.railDenseW : L.railW, backgroundColor: palette.railBg, borderRightWidth: 1, borderRightColor: palette.line2, minHeight: 0 }}>
      <ScrollView accessibilityRole="tablist" accessibilityLabel="Catégories" contentContainerStyle={{ paddingVertical: S.sm, paddingHorizontal: L.sp(!dense && L.railCompactBrand ? 3 : 6), gap: L.sp(5) }}>
        {categories.map((cat) => {
          const on = cat._id === activeId;
          return (
            <Press
              key={cat._id}
              onPress={() => onSelect(cat._id)}
              selected={on}
              accessibilityRole="tab"
              accessibilityLabel={cat.name}
              scale={0.96}
              style={{
                minHeight: dense ? L.touch() : L.touch(62),
                borderRadius: R.card,
                paddingVertical: L.sp(9),
                paddingHorizontal: dense ? L.sp(14) : L.sp(L.railCompactBrand ? 2 : 6),
                flexDirection: dense ? 'row' : 'column',
                alignItems: dense ? 'center' : 'stretch',
                justifyContent: dense ? 'space-between' : 'center',
                gap: dense ? L.sp(6) : L.sp(3),
                backgroundColor: on ? palette.surface2 : 'transparent',
                borderWidth: 1,
                borderColor: on ? palette.line : 'transparent',
                overflow: 'hidden',
              }}
              activeStyle={{ backgroundColor: palette.press }}
            >
              {on ? (
                <View
                  style={{
                    position: 'absolute',
                    left: 0,
                    top: L.sp(dense ? 10 : 12),
                    bottom: L.sp(dense ? 10 : 12),
                    width: 3,
                    borderTopRightRadius: 3,
                    borderBottomRightRadius: 3,
                    backgroundColor: brand.accent,
                  }}
                />
              ) : null}
              {!dense && L.railIcons ? <View style={{ alignItems: 'center', marginBottom: L.sp(2) }}><Icon name={categoryIcon(cat.name)} size={L.fs(18)} color={on ? brand.accent : palette.mut} /></View> : null}
              <Text
                numberOfLines={dense ? 1 : 2}
                style={{
                  flex: dense ? 1 : undefined,
                  fontFamily: FONT,
                  color: on ? palette.text : palette.mut,
                  fontSize: L.railFs,
                  fontWeight: on ? '700' : '600',
                  lineHeight: L.railFs + 3,
                  letterSpacing: -0.1,
                  textAlign: dense ? 'left' : 'center',
                }}
              >
                {dense ? cat.name : railLabel(cat.name)}
              </Text>
              <Text
                style={{
                  fontFamily: FONT,
                  color: on ? brand.accent : palette.dimText,
                  fontSize: Math.max(11, L.railFs - 1.5),
                  fontWeight: '700',
                  textAlign: dense ? 'right' : 'center',
                  fontVariant: ['tabular-nums'],
                }}
              >
                {cat.products.length}
              </Text>
            </Press>
          );
        })}
      </ScrollView>
      <PoweredBy compact={!dense && L.railCompactBrand} />
    </View>
  );
}

/**
 * Le média qui a produit `photoUrl` — même traversée que `photoUrlDe`.
 *
 * La caisse a besoin du média ENTIER (ses cotes ET son point d'intérêt) pour
 * recadrer, là où le contrat n'expose que des extraits (`photoPointDe` rend le
 * point seul). La condition est donc recopiée telle quelle, `estPublic`
 * compris : sans elle on recadrerait d'après un média que le serveur n'a pas
 * servi, et le cadrage ne correspondrait pas à l'image affichée.
 */
function mediaDeTete(
  product: Product,
  catalogue: ReadonlyMap<string, MediaVue>,
): MediaVue | null {
  for (const id of mediasDuProduit(product)) {
    const media = catalogue.get(id);
    if (media && estPublic(media.genre) && media.urls.vignette) return media;
  }
  return null;
}

type CatalogEntry = { product: Product; categoryName: string };
type CatalogFilter = 'popular' | 'new' | null;

/** Un libellé commercial ne se déduit jamais d'un prix ou d'une image. */
function isPopular(product: Product): boolean {
  return (product.tags ?? []).some((tag) => ['populaire', 'populaires', 'popular'].includes(norm(tag.trim())));
}

export function ProductArea({
  categories, medias, activeId, brand, parked, onPick, onRecall, query, onQuery,
  layoutId = 'A', onSelectCategory, onQuickAdd,
}: {
  categories: Category[];
  medias?: MediaVue[];
  activeId: string | null;
  brand: Brand;
  parked: ParkedTicket[];
  onPick: (product: Product, categoryName: string) => void;
  onRecall: (ticket: ParkedTicket) => void;
  query: string;
  onQuery: (q: string) => void;
  layoutId?: 'A' | 'B' | 'C';
  onSelectCategory?: (id: string) => void;
  onQuickAdd?: (product: Product, categoryName: string) => void;
}) {
  const L = useLayout();
  const { palette, type, sheet, semanticText } = useTheme();
  const reducedMotion = useReducedMotion();
  const [gridWidth, setGridWidth] = useState(0);
  const [searchOpen, setSearchOpen] = useState(false);
  const [filter, setFilter] = useState<CatalogFilter>(null);
  const catalogue = useMemo(() => catalogueMedias(medias ?? []), [medias]);
  const allProducts = useMemo(() => categories.flatMap((category) => category.products.map((product) => ({ product, categoryName: category.name }))), [categories]);
  const hasPopular = allProducts.some(({ product }) => isPopular(product));
  const activeCat = categories.find((category) => category._id === activeId) ?? categories[0];
  const tabs = !!onSelectCategory && (layoutId === 'B' || (layoutId === 'C' && L.compact));
  const list = layoutId === 'C';
  const q = norm(query.trim());
  useEffect(() => setFilter(null), [activeId]);

  const shown: CatalogEntry[] = useMemo(() => {
    if (q) return allProducts.filter(({ product }) => norm(product.name).includes(q) || norm(product.description ?? '').includes(q));
    if (filter === 'popular') return allProducts.filter(({ product }) => isPopular(product));
    if (filter === 'new') return allProducts.filter(({ product }) => product.isNew);
    return (activeCat?.products ?? []).map((product) => ({ product, categoryName: activeCat?.name ?? '' }));
  }, [activeCat, allProducts, filter, q]);
  const title = q ? 'Résultats' : filter === 'popular' ? 'Populaires' : filter === 'new' ? 'Nouveautés' : activeCat?.name ?? 'Catalogue';
  const cols = list ? L.listColumnsFor(gridWidth) : columnsFor(gridWidth, L);
  const cardW = cardWidth(gridWidth, cols, L.gridGap);
  const selectCategory = (id: string) => {
    setFilter(null);
    onQuery('');
    onSelectCategory?.(id);
  };
  const selectFilter = (value: Exclude<CatalogFilter, null>) => {
    onQuery('');
    setFilter((previous) => previous === value ? null : value);
  };
  const filters = !L.compact || filter ? (
    <View style={{ flexDirection: 'row', gap: L.sp(8), flexShrink: 0 }}>
      {hasPopular ? <FilterChip label="Populaires" icon="star" selected={filter === 'popular'} onPress={() => selectFilter('popular')} brand={brand} /> : null}
      <FilterChip label="Nouveautés" selected={filter === 'new'} onPress={() => selectFilter('new')} brand={brand} />
    </View>
  ) : null;

  return (
    <View style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
      <View style={{ paddingHorizontal: L.gridPad, paddingTop: S.md, gap: L.sp(12) }}>
        {L.catalogWideSearch ? <SearchField query={query} onQuery={onQuery} brand={brand} /> : null}
        {tabs ? (
          <View style={{ flexDirection: 'row', gap: L.sp(8), alignItems: 'center' }}>
            <CategoryTabs categories={categories} activeId={activeCat?._id ?? null} onSelect={selectCategory} brand={brand} />
            {!L.catalogWideSearch ? (
              <Press onPress={() => setSearchOpen((open) => !open)} accessibilityLabel="Rechercher un produit" selected={searchOpen || !!query} style={{ width: L.touch(), height: L.touch(), alignItems: 'center', justifyContent: 'center', borderRadius: R.ctrl, backgroundColor: palette.surface, borderWidth: 1, borderColor: searchOpen || query ? withAlpha(brand.accent, 0.5) : palette.line2 }}>
                <Icon name="search" size={L.fs(17)} color={searchOpen || query ? brand.accent : palette.mut} />
              </Press>
            ) : null}
          </View>
        ) : null}
        {(!L.catalogWideSearch && (!tabs || searchOpen || !!query)) || filters ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: L.sp(8), alignItems: 'center', justifyContent: 'flex-end' }}>
            {!L.catalogWideSearch && (!tabs || searchOpen || !!query) ? (
              <View style={{ flex: 1, minWidth: L.sp(160) }}><SearchField query={query} onQuery={onQuery} brand={brand} autoFocus={tabs && searchOpen} /></View>
            ) : null}
            {filters}
          </View>
        ) : null}
        {parked.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: S.sm }}>
            <View style={{ justifyContent: 'center' }}><Text style={[type.eyebrow, { color: semanticText.warning }]}>En attente</Text></View>
            {parked.map((ticket) => {
              const total = ticket.lines.reduce((sum, line) => sum + line.unitPrice * line.qty, 0);
              const items = ticket.lines.reduce((sum, line) => sum + line.qty, 0);
              return (
                <Press key={ticket.code} onPress={() => onRecall(ticket)} accessibilityLabel={`Rappeler le ticket ${ticket.code}, ${items} articles, ${euros(total)}`}
                  style={{ minHeight: L.touch(), paddingHorizontal: L.sp(14), flexDirection: 'row', alignItems: 'center', gap: L.sp(9), borderRadius: R.pill, borderWidth: 1, borderColor: withAlpha(palette.amber, 0.4), backgroundColor: withAlpha(palette.amber, 0.09) }}
                  activeStyle={{ backgroundColor: withAlpha(palette.amber, 0.2) }}>
                  <View style={{ width: L.sp(7), height: L.sp(7), borderRadius: R.pill, backgroundColor: palette.amber }} />
                  <Text style={{ fontFamily: FONT, color: palette.text, fontSize: L.fs(14), fontWeight: '700' }}>{ticket.code}{ticket.customerName ? ` · ${ticket.customerName}` : ''}</Text>
                  <Text style={{ fontFamily: FONT, color: semanticText.warning, fontSize: L.fs(13), fontWeight: '700', fontVariant: ['tabular-nums'] }}>{items} art. · {euros(total)}</Text>
                </Press>
              );
            })}
          </ScrollView>
        ) : null}
      </View>
      <ScrollView style={{ flex: 1, marginTop: S.md }} contentContainerStyle={{ paddingHorizontal: L.gridPad, paddingBottom: S.xl }} keyboardShouldPersistTaps="handled">
        <View style={[sheet.between, { marginBottom: S.md, gap: L.sp(8) }]}>
          <Text accessibilityRole="header" style={[type.strong, { fontSize: L.fs(17), letterSpacing: -0.3, flex: 1 }]}>{title}</Text>
          <Text style={[type.mut, { fontSize: L.fs(12.5) }]}>{shown.length} produit{shown.length > 1 ? 's' : ''}</Text>
        </View>
        <View onLayout={(event: LayoutChangeEvent) => setGridWidth(event.nativeEvent.layout.width)} style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: L.gridGap, rowGap: list ? L.sp(6) : L.gridGap }}>
          {shown.length === 0 ? (
            <View style={{ width: '100%' }}><EmptyState title={q ? 'Aucun produit ne correspond' : filter ? 'Aucun produit dans cette sélection' : 'Catégorie vide'} sub={q ? 'Essayez un autre mot, ou parcourez les catégories.' : undefined} /></View>
          ) : cardW > 0 ? shown.map(({ product, categoryName }, index) => (
            <CatalogEntryMotion key={product._id} width={cardW} index={index} reducedMotion={reducedMotion}>
              {list ? <ProductRow product={product} catalogue={catalogue} width={cardW} layout={L} brand={brand} onPress={() => onPick(product, categoryName)} onAdd={() => (onQuickAdd ?? onPick)(product, categoryName)} /> : <ProductCard product={product} catalogue={catalogue} width={cardW} layout={L} brand={brand} onPress={() => onPick(product, categoryName)} />}
            </CatalogEntryMotion>
          )) : null}
        </View>
      </ScrollView>
    </View>
  );
}

function FilterChip({ label, icon, selected, onPress, brand }: {
  label: string; icon?: 'star'; selected: boolean; onPress: () => void; brand: Brand;
}) {
  const L = useLayout();
  const { palette } = useTheme();
  const color = palette.text;
  return (
    <Press onPress={onPress} selected={selected} accessibilityRole="checkbox" accessibilityLabel={label}
      style={{ minHeight: L.touch(), paddingHorizontal: L.sp(14), borderRadius: R.ctrl, borderWidth: 1, borderColor: selected ? brand.accent : palette.line2, backgroundColor: selected ? brand.tint : palette.surface, flexDirection: 'row', alignItems: 'center', gap: L.sp(7) }} activeStyle={{ opacity: 0.82 }}>
      {icon ? <Icon name={icon} size={L.fs(14)} color={color} /> : null}
      <Text style={{ fontFamily: FONT, fontSize: L.fs(13.5), fontWeight: '600', color }}>{label}</Text>
    </Press>
  );
}

function SearchField({ query, onQuery, brand, autoFocus }: {
  query: string; onQuery: (query: string) => void; brand: Brand; autoFocus?: boolean;
}) {
  const L = useLayout();
  const { palette } = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ minHeight: L.touch(48), borderRadius: R.ctrl, backgroundColor: palette.surface, borderWidth: focused ? 2 : 1, borderColor: focused ? brand.accent : palette.line2, flexDirection: 'row', alignItems: 'center', paddingLeft: L.sp(14), gap: L.sp(10) }}>
      <Icon name="search" size={L.fs(17)} color={palette.mut} />
      <TextInput value={query} onChangeText={onQuery} accessibilityLabel="Rechercher un produit" placeholder="Rechercher un produit…" placeholderTextColor={palette.mut} autoFocus={autoFocus} autoCorrect={false} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
        style={{ flex: 1, minWidth: 0, minHeight: L.touch(), paddingVertical: L.sp(8), paddingRight: query ? 0 : L.sp(14), fontFamily: FONT, fontSize: L.fs(15), fontWeight: '500', color: palette.text }} />
      {query ? <Press onPress={() => onQuery('')} accessibilityLabel="Effacer la recherche" style={{ minHeight: L.touch(), width: L.touch(), alignItems: 'center', justifyContent: 'center' }}><Icon name="close" size={L.fs(16)} color={palette.mut} /></Press> : null}
    </View>
  );
}

/** Une apparition par montage, jamais au changement de quantité du ticket. */
function CatalogEntryMotion({ children, width, index, reducedMotion }: {
  children: ReactNode; width: number; index: number; reducedMotion: boolean;
}) {
  const progress = useRef(new Animated.Value(reducedMotion ? 1 : 0)).current;
  useEffect(() => {
    if (reducedMotion) { progress.setValue(1); return; }
    const animation = Animated.timing(progress, { toValue: 1, duration: 300, delay: Math.min(index, 11) * 14, easing: Easing.bezier(0.2, 0.8, 0.2, 1), useNativeDriver: Platform.OS !== 'web' });
    animation.start();
    return () => animation.stop();
  }, [index, progress, reducedMotion]);
  return <Animated.View style={{ width, opacity: progress.interpolate({ inputRange: [0, 1], outputRange: [0.45, 1] }), transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }] }}>{children}</Animated.View>;
}

/**
 * LA VIGNETTE — carrée, recadrée sur le point d'intérêt, jamais cassée.
 *
 * ─── LE RECADRAGE ───
 *
 * `resizeMode="cover"` recadre par le centre, ce qui coupe le plat au mauvais
 * endroit dès que le sujet n'est pas centré — et la caisse est la surface la
 * plus carrée du produit, donc celle qui coupe le plus. Quand on connaît les
 * cotes de la photo (`MediaVue.largeur/hauteur`, lues dans les octets au
 * dépôt), on pose donc l'image en absolu à la taille qui couvre le carré et on
 * la décale pour amener le point d'intérêt au centre (`cadrageVignette`).
 * Sans cotes — en-tête muet, ou photo héritée du pilote qui n'est pas un
 * média — on retombe sur le recadrage centré du cadre : ce que fait un
 * navigateur sans consigne, et ce que la caisse faisait avant.
 *
 * ─── LA CASSE ───
 *
 * `onError` suffit ici, là où la vitrine a besoin d'une SECONDE garde : sa
 * page est rendue côté serveur, une image déjà morte quand React s'attache
 * n'émet plus d'événement, et il faut relire l'état du nœud au montage. La
 * caisse n'a pas ce problème — rien n'est rendu avant elle, l'élément est créé
 * par React et son échec lui revient toujours. Le repli est le même : le
 * monogramme du plat, pas un cadre vide et surtout pas l'icône d'image cassée.
 *
 * L'état porte l'URL qu'il juge : une carte rechargée peut changer la photo
 * d'un produit sans démonter sa tuile, et une photo cassée ne doit pas
 * condamner celle qui la remplace.
 */
function Vignette({ uri, cote, media, nom }: {
  uri: string | null;
  cote: number;
  media: MediaVue | null;
  nom: string;
}) {
  const { palette } = useTheme();
  const [etat, setEtat] = useState({ uri, casse: false });
  if (etat.uri !== uri) setEtat({ uri, casse: false });
  const point = media?.point ?? POINT_CENTRE;
  const cadre = !uri || etat.casse
    ? null
    : cadrageVignette(cote, media?.largeur, media?.hauteur, point.x, point.y);

  return (
    <View
      style={{
        width: cote,
        height: cote,
        borderRadius: R.ctrl,
        flexShrink: 0,
        overflow: 'hidden',
        backgroundColor: palette.surface2,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {!uri || etat.casse ? (
        <Text
          style={{
            fontFamily: FONT,
            color: palette.mut,
            fontSize: Math.round(cote * 0.34),
            fontWeight: '800',
            letterSpacing: -0.5,
          }}
        >
          {monogramme(nom)}
        </Text>
      ) : (
        <Image
          source={{ uri }}
          // Décorative : le nom du plat est à côté, et la tuile entière porte
          // déjà son libellé d'accessibilité. L'annoncer une seconde fois
          // ferait dire deux fois « Kebab Fromage » au lecteur d'écran.
          accessible={false}
          onError={() => setEtat({ uri, casse: true })}
          // Le fondu d'apparition d'Android (300 ms) sur quarante tuiles qui
          // changent de catégorie fait un scintillement, pas une transition.
          fadeDuration={0}
          resizeMode="cover"
          style={cadre ? { position: 'absolute', ...cadre } : { width: '100%', height: '100%' }}
        />
      )}
    </View>
  );
}

function ProductCard({ product, catalogue, width, layout: L, brand, onPress }: {
  product: Product;
  catalogue: ReadonlyMap<string, MediaVue>;
  width: number;
  layout: Layout;
  brand: Brand;
  onPress: () => void;
}) {
  const { palette, shadow } = useTheme();
  const out = !!product.outOfStock;
  const required = (product.optionGroups ?? []).some((group) => (group.min ?? 0) > 0);
  const photo = photoDuPoste(product.photoUrl);
  // La photo garde son cadre carré et son point d'intérêt métier. Sa place
  // grandit au-dessus du texte ; le prix ne partage plus sa rangée avec elle.
  const photoSize = Math.max(1, Math.min(width - L.sp(8) * 2 - 2, L.sp(144)));
  const showDescription = L.catalogDescriptions && !!product.description;
  return (
    <Press onPress={out ? undefined : onPress} disabled={out}
      accessibilityLabel={out ? `${product.name}, en rupture` : `${product.name}, ${euros(basePrice(product, product.variants?.[0]?.key ?? null))}${product.variants?.length ? ' et plus' : ''}`}
      style={[{ width, minHeight: L.cardH, borderRadius: R.card, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.line2, padding: L.sp(8), gap: L.sp(12), overflow: 'hidden' }, out ? { opacity: 0.42 } : shadow(1)]}
      activeStyle={{ backgroundColor: palette.press, borderColor: withAlpha(brand.accent, 0.5) }}>
      <View style={{ alignItems: 'center', justifyContent: 'center', minHeight: photoSize, backgroundColor: palette.surface2, borderRadius: R.ctrl, overflow: 'hidden' }}>
        <Vignette uri={photo} cote={photoSize} media={mediaDeTete(product, catalogue)} nom={product.name} />
        {product.isNew && !out ? <View style={{ position: 'absolute', left: L.sp(8), top: L.sp(8) }}><ProductBadge kind="new" /></View> : null}
      </View>
      <View style={{ paddingHorizontal: L.sp(4), paddingBottom: L.sp(4), gap: L.sp(10) }}>
        <View style={{ minHeight: L.fs(L.catalogDescriptions ? 76 : 38), gap: L.sp(4) }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: L.sp(6) }}>
            <Text numberOfLines={2} style={{ flex: 1, fontFamily: FONT, color: palette.text, fontSize: L.fs(14.5), fontWeight: '700', lineHeight: L.fs(19), letterSpacing: -0.2 }}>{product.name}</Text>
            {required && !out ? <View style={{ width: L.sp(6), height: L.sp(6), borderRadius: R.pill, marginTop: L.sp(6), backgroundColor: brand.accent }} /> : null}
          </View>
          {showDescription ? <Text numberOfLines={2} style={{ fontFamily: FONT, color: palette.mut, fontSize: L.fs(12), lineHeight: L.fs(17) }}>{product.description}</Text> : null}
        </View>
        <View style={{ minHeight: L.sp(32), flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: L.sp(4) }}>
          {out ? <ProductBadge kind="out" /> : <ProductPrice product={product} layout={L} />}
          {!out && width >= L.sp(175) ? <View accessible={false} style={{ width: L.sp(28), height: L.sp(28), borderRadius: R.pill, backgroundColor: palette.surface2, alignItems: 'center', justifyContent: 'center' }}><Icon name="plus" size={L.fs(16)} color={palette.text} /></View> : null}
        </View>
      </View>
    </Press>
  );
}

/** Deux cibles voisines : configurer la ligne ou demander l'ajout standard.
 * Le callback d'ajout est toujours contrôlé par PosScreen et ses règles.
 */
function ProductRow({ product, catalogue, width, layout: L, brand, onPress, onAdd }: {
  product: Product;
  catalogue: ReadonlyMap<string, MediaVue>;
  width: number;
  layout: Layout;
  brand: Brand;
  onPress: () => void;
  onAdd: () => void;
}) {
  const { palette } = useTheme();
  const out = !!product.outOfStock;
  const photo = photoDuPoste(product.photoUrl);
  return (
    <View style={{ width, flex: 1, minHeight: L.touch(52), borderRadius: R.card, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.line2, flexDirection: 'row', alignItems: 'center', overflow: 'hidden' }}>
      <Press onPress={out ? undefined : onPress} disabled={out} accessibilityLabel={out ? `${product.name}, en rupture` : `Configurer ${product.name}, ${euros(basePrice(product, product.variants?.[0]?.key ?? null))}`}
        style={{ flex: 1, minWidth: 0, minHeight: L.touch(52), flexDirection: 'row', alignItems: 'center', gap: L.sp(12), paddingVertical: L.sp(7), paddingLeft: L.sp(14), paddingRight: L.sp(12) }}
        activeStyle={{ backgroundColor: palette.press }}>
        {photo ? <Vignette uri={photo} cote={L.sp(44)} media={mediaDeTete(product, catalogue)} nom={product.name} /> : null}
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: L.sp(8) }}>
            <Text numberOfLines={1} style={{ flexShrink: 1, fontFamily: FONT, color: palette.text, fontSize: L.fs(14.5), fontWeight: '700', letterSpacing: -0.2 }}>{product.name}</Text>
            {out ? <ProductBadge kind="out" /> : product.isNew ? <ProductBadge kind="new" /> : null}
          </View>
          {product.description && L.catalogDescriptions ? <Text numberOfLines={1} style={{ fontFamily: FONT, fontSize: L.fs(12.5), color: palette.mut, marginTop: L.sp(2) }}>{product.description}</Text> : null}
        </View>
        <ProductPrice product={product} layout={L} dense />
      </Press>
      {!out ? <Press onPress={onAdd} accessibilityLabel={`Ajouter ${product.name}`} style={{ width: L.touch(), height: L.touch(), marginRight: L.sp(7), borderRadius: R.pill, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.surface2, alignItems: 'center', justifyContent: 'center' }} activeStyle={{ backgroundColor: brand.tint, borderColor: brand.accent }}><Icon name="plus" size={L.fs(18)} color={palette.text} strokeWidth={2.2} /></Press> : null}
    </View>
  );
}

function ProductPrice({ product, layout: L, dense = false }: { product: Product; layout: Layout; dense?: boolean }) {
  const { palette } = useTheme();
  return (
    <View style={{ flexDirection: 'row', flexWrap: dense ? 'nowrap' : 'wrap', alignItems: 'baseline', gap: L.sp(4), flexShrink: dense ? 0 : 1, maxWidth: '100%' }}>
      {product.variants?.length ? <Text style={{ fontFamily: FONT, color: palette.mut, fontSize: L.fs(11.5), fontWeight: '700' }}>dès</Text> : null}
      <Text style={{ fontFamily: FONT, color: palette.text, fontSize: L.fs(dense ? 17 : 19), fontWeight: '800', letterSpacing: dense ? -0.5 : -0.7, fontVariant: ['tabular-nums'] }}>{euros(basePrice(product, product.variants?.[0]?.key ?? null))}</Text>
    </View>
  );
}

function ProductBadge({ kind }: { kind: 'new' | 'out' }) {
  const L = useLayout();
  const { palette, semanticText } = useTheme();
  return (
    <View style={{ alignSelf: 'flex-start', flexShrink: 0, paddingHorizontal: L.sp(7), paddingVertical: L.sp(3), borderRadius: R.pill, backgroundColor: withAlpha(kind === 'out' ? palette.red : palette.green, 0.14) }}>
      <Text style={{ fontFamily: FONT, color: kind === 'out' ? semanticText.danger : semanticText.positive, fontSize: L.fs(11), fontWeight: '800' }}>{kind === 'out' ? 'RUPTURE' : 'NOUV.'}</Text>
    </View>
  );
}
