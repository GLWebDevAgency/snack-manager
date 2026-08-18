/**
 * Zones B et C — rail des catégories et grille produits.
 *
 * La grille mesure sa largeur pour tenir exactement 4 colonnes quel que soit
 * l'écran : les colonnes fixes en pourcentage n'existent pas en RN.
 */
import { useMemo, useState } from 'react';
import { ScrollView, Text, View, type LayoutChangeEvent } from 'react-native';
import { TOUCH_MIN, basePrice, euros, palette, type Category, type Product } from '@sm/client-core';
import { FONT, R, RAIL_W, S, sheet, shadow, type, withAlpha, type Brand } from './theme';
import { EmptyState, Field, Press, Sheen } from './ui';
import type { ParkedTicket } from './pos-state';

/** Étiquette courte du rail : « Compose ton Tacos » → « Tacos ». */
export function railLabel(name: string): string {
  return name
    .replace(/^Compose ton\s+/i, '')
    .replace(/^Gourmets?\s+/i, '')
    .replace(/^Les\s+/i, '')
    .replace(/\s+à Partager$/i, '')
    .trim();
}

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
}: {
  categories: Category[];
  activeId: string | null;
  onSelect: (id: string) => void;
  brand: Brand;
}) {
  return (
    <View style={{ width: RAIL_W, backgroundColor: '#0a0a0a', borderRightWidth: 1, borderRightColor: palette.line2 }}>
      <ScrollView contentContainerStyle={{ paddingVertical: S.sm, paddingHorizontal: 6, gap: 5 }}>
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
                minHeight: 62,
                borderRadius: R.card,
                paddingVertical: 9,
                paddingHorizontal: 8,
                justifyContent: 'center',
                backgroundColor: on ? palette.surface2 : 'transparent',
                borderWidth: 1,
                borderColor: on ? palette.line : 'transparent',
                overflow: 'hidden',
              }}
              activeStyle={{ backgroundColor: '#181818' }}
            >
              {on ? (
                <View
                  style={{
                    position: 'absolute',
                    left: 0,
                    top: 12,
                    bottom: 12,
                    width: 3,
                    borderTopRightRadius: 3,
                    borderBottomRightRadius: 3,
                    backgroundColor: brand.accent,
                  }}
                />
              ) : null}
              <Text
                numberOfLines={2}
                style={{
                  fontFamily: FONT,
                  color: on ? palette.text : '#8d8d8d',
                  fontSize: 13,
                  fontWeight: on ? '700' : '600',
                  lineHeight: 16,
                  letterSpacing: -0.1,
                  textAlign: 'center',
                }}
              >
                {railLabel(cat.name)}
              </Text>
              <Text
                style={{
                  fontFamily: FONT,
                  color: on ? brand.accent : '#757575',
                  fontSize: 11.5,
                  fontWeight: '700',
                  textAlign: 'center',
                  marginTop: 3,
                  fontVariant: ['tabular-nums'],
                }}
              >
                {cat.products.length}
              </Text>
            </Press>
          );
        })}
      </ScrollView>
    </View>
  );
}

export function ProductArea({
  categories,
  activeId,
  brand,
  parked,
  onPick,
  onRecall,
  query,
  onQuery,
}: {
  categories: Category[];
  activeId: string | null;
  brand: Brand;
  parked: ParkedTicket[];
  onPick: (product: Product, categoryName: string) => void;
  onRecall: (ticket: ParkedTicket) => void;
  query: string;
  onQuery: (q: string) => void;
}) {
  const [gridWidth, setGridWidth] = useState(0);

  const activeCat = categories.find((c) => c._id === activeId) ?? categories[0];

  const results = useMemo(() => {
    const q = norm(query.trim());
    if (!q) return null;
    const out: { product: Product; categoryName: string }[] = [];
    for (const cat of categories) {
      for (const p of cat.products) {
        if (norm(p.name).includes(q) || norm(p.description ?? '').includes(q)) {
          out.push({ product: p, categoryName: cat.name });
        }
      }
    }
    return out;
  }, [categories, query]);

  const shown: { product: Product; categoryName: string }[] =
    results ?? (activeCat?.products ?? []).map((p) => ({ product: p, categoryName: activeCat?.name ?? '' }));

  // 4 colonnes sur la tablette cible (1280 paysage) ; on retombe
  // proprement à 2 ou 3 sur un écran plus étroit plutôt que d'écraser les
  // noms de produits.
  const gap = 12;
  const cols = gridWidth > 0 ? Math.max(2, Math.min(4, Math.floor((gridWidth + gap) / (168 + gap)))) : 4;
  const cardW = gridWidth > 0 ? (gridWidth - gap * (cols - 1)) / cols : 0;

  return (
    <View style={{ flex: 1 }}>
      {/* Recherche + tickets en attente */}
      <View style={{ paddingHorizontal: S.lg, paddingTop: S.md, gap: S.md }}>
        <View style={{ flexDirection: 'row', gap: S.sm, alignItems: 'center' }}>
          <Field
            value={query}
            onChangeText={onQuery}
            placeholder="Rechercher un produit…"
            accent={brand.accent}
            style={{ flex: 1 }}
          />
          {query ? (
            <Press
              onPress={() => onQuery('')}
              accessibilityLabel="Effacer la recherche"
              style={{
                width: TOUCH_MIN,
                height: TOUCH_MIN,
                borderRadius: R.pill,
                backgroundColor: palette.surface2,
                borderWidth: 1,
                borderColor: palette.line2,
                alignItems: 'center',
                justifyContent: 'center',
              }}
              activeStyle={{ backgroundColor: '#282828' }}
            >
              <Text style={{ fontFamily: FONT, color: palette.mut, fontSize: 16 }}>✕</Text>
            </Press>
          ) : null}
        </View>

        {parked.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: S.sm }}>
            <View style={{ justifyContent: 'center' }}>
              <Text style={[type.eyebrow, { color: palette.amber }]}>En attente</Text>
            </View>
            {parked.map((t) => {
              const total = t.lines.reduce((n, l) => n + l.unitPrice * l.qty, 0);
              const items = t.lines.reduce((n, l) => n + l.qty, 0);
              return (
                <Press
                  key={t.code}
                  onPress={() => onRecall(t)}
                  accessibilityLabel={`Rappeler le ticket ${t.code}, ${items} articles, ${euros(total)}`}
                  style={{
                    minHeight: TOUCH_MIN,
                    paddingHorizontal: 14,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 9,
                    borderRadius: R.pill,
                    borderWidth: 1,
                    borderColor: withAlpha(palette.amber, 0.4),
                    backgroundColor: withAlpha(palette.amber, 0.09),
                  }}
                  activeStyle={{ backgroundColor: withAlpha(palette.amber, 0.2) }}
                >
                  <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: palette.amber }} />
                  <Text style={{ fontFamily: FONT, color: palette.text, fontSize: 14, fontWeight: '700' }}>
                    {t.code}
                    {t.customerName ? ` · ${t.customerName}` : ''}
                  </Text>
                  <Text
                    style={{
                      fontFamily: FONT,
                      color: palette.amber,
                      fontSize: 13,
                      fontWeight: '700',
                      fontVariant: ['tabular-nums'],
                    }}
                  >
                    {items} art. · {euros(total)}
                  </Text>
                </Press>
              );
            })}
          </ScrollView>
        ) : null}
      </View>

      {/* Grille */}
      <ScrollView
        style={{ flex: 1, marginTop: S.md }}
        contentContainerStyle={{ paddingHorizontal: S.lg, paddingBottom: S.xl }}
      >
        <View style={[sheet.between, { marginBottom: S.md }]}>
          <Text style={type.eyebrow}>{results ? 'Résultats' : (activeCat?.name ?? 'Catalogue')}</Text>
          <Text style={[type.mut, { fontSize: 12.5 }]}>
            {shown.length} produit{shown.length > 1 ? 's' : ''}
          </Text>
        </View>

        <View
          onLayout={(e: LayoutChangeEvent) => setGridWidth(e.nativeEvent.layout.width)}
          style={{ flexDirection: 'row', flexWrap: 'wrap', gap }}
        >
          {shown.length === 0 ? (
            <View style={{ width: '100%' }}>
              <EmptyState
                title={results ? 'Aucun produit ne correspond' : 'Catégorie vide'}
                sub={results ? 'Essayez un autre mot, ou parcourez le rail à gauche.' : undefined}
              />
            </View>
          ) : (
            cardW > 0 &&
            shown.map(({ product, categoryName }) => (
              <ProductCard
                key={product._id}
                product={product}
                width={cardW}
                brand={brand}
                onPress={() => onPick(product, categoryName)}
              />
            ))
          )}
        </View>
      </ScrollView>
    </View>
  );
}

function ProductCard({
  product,
  width,
  brand,
  onPress,
}: {
  product: Product;
  width: number;
  brand: Brand;
  onPress: () => void;
}) {
  const out = !!product.outOfStock;
  const hasVariants = !!product.variants?.length;
  const price = basePrice(product, product.variants?.[0]?.key ?? null);
  /** Un groupe obligatoire signale une carte qui exigera un choix. */
  const required = (product.optionGroups ?? []).some((g) => (g.min ?? 0) > 0);

  return (
    <Press
      onPress={out ? undefined : onPress}
      disabled={out}
      accessibilityLabel={
        out ? `${product.name}, en rupture` : `${product.name}, ${euros(price)}${hasVariants ? ' et plus' : ''}`
      }
      scale={0.97}
      style={[
        {
          width,
          minHeight: 108,
          borderRadius: R.card,
          backgroundColor: palette.surface,
          borderWidth: 1,
          borderColor: palette.line2,
          padding: 13,
          justifyContent: 'space-between',
          overflow: 'hidden',
        },
        out ? { opacity: 0.42 } : shadow(1),
      ]}
      activeStyle={{ backgroundColor: '#1c1c1c', borderColor: withAlpha(brand.accent, 0.5) }}
    >
      {!out ? <Sheen /> : null}

      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 6 }}>
        <Text
          numberOfLines={2}
          style={{
            flex: 1,
            fontFamily: FONT,
            color: palette.text,
            fontSize: 14.5,
            fontWeight: '700',
            lineHeight: 18,
            letterSpacing: -0.2,
          }}
        >
          {product.name}
        </Text>
        {product.isNew && !out ? (
          <View
            style={{
              paddingHorizontal: 7,
              paddingVertical: 3,
              borderRadius: R.pill,
              backgroundColor: withAlpha(palette.green, 0.14),
            }}
          >
            <Text style={{ fontFamily: FONT, color: palette.green, fontSize: 11, fontWeight: '800' }}>NOUV.</Text>
          </View>
        ) : required && !out ? (
          // Pastille discrète : ce produit ouvrira une configuration obligatoire.
          <View
            style={{
              width: 6,
              height: 6,
              borderRadius: 3,
              marginTop: 6,
              backgroundColor: withAlpha(brand.accent, 0.85),
            }}
          />
        ) : null}
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: 10 }}>
        {out ? (
          <View
            style={{
              paddingHorizontal: 9,
              paddingVertical: 4,
              borderRadius: R.pill,
              backgroundColor: withAlpha(palette.red, 0.18),
            }}
          >
            <Text style={{ fontFamily: FONT, color: palette.red, fontSize: 12.5, fontWeight: '800' }}>RUPTURE</Text>
          </View>
        ) : (
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 5 }}>
            {hasVariants ? (
              <Text style={{ fontFamily: FONT, color: palette.mut, fontSize: 11.5, fontWeight: '700' }}>dès</Text>
            ) : null}
            <Text
              style={{
                fontFamily: FONT,
                color: palette.text,
                fontSize: 19,
                fontWeight: '800',
                letterSpacing: -0.7,
                fontVariant: ['tabular-nums'],
              }}
            >
              {euros(price)}
            </Text>
          </View>
        )}
      </View>
    </Press>
  );
}
