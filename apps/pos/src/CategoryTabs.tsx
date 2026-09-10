/** Catégories communes aux dispositions B et C compactes. */
import { useEffect, useRef, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import type { Category } from '@sm/client-core';
import { FONT, R, useTheme, withAlpha, type Brand } from './theme';
import { Icon } from './Icon';
import { Press, useReducedMotion } from './ui';
import { useLayout } from './useLayout';

/** Étiquette courte du rail, sans troncature imposée aux onglets. */
export function railLabel(name: string): string {
  return name
    .replace(/^Compose ton\s+/i, '')
    .replace(/^Gourmets?\s+/i, '')
    .replace(/^Les\s+/i, '')
    .replace(/\s+à Partager$/i, '')
    .trim();
}

/** Repère illustratif uniquement : les catégories restent celles du serveur. */
export function categoryIcon(name: string) {
  const normalized = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (/boisson|drink|milkshake/.test(normalized)) return 'drink' as const;
  if (/burger|gourmet|signature|hummer/.test(normalized)) return 'burger' as const;
  if (/tacos|tex.mex|crousty|grill/.test(normalized)) return 'flame' as const;
  return 'list' as const;
}

export function CategoryTabs({ categories, activeId, onSelect, brand }: {
  categories: Category[];
  activeId: string | null;
  onSelect: (id: string) => void;
  brand: Brand;
}) {
  const L = useLayout();
  const { palette } = useTheme();
  const reducedMotion = useReducedMotion();
  const scroll = useRef<ScrollView>(null);
  const positions = useRef(new Map<string, number>());
  const [contentWidth, setContentWidth] = useState(0);
  useEffect(() => {
    if (!activeId) return;
    const x = positions.current.get(activeId);
    if (x != null) scroll.current?.scrollTo({ x: Math.max(0, x - L.sp(24)), animated: !reducedMotion });
  }, [activeId, contentWidth, L.width, L.scale, reducedMotion]);

  return (
    <ScrollView
      ref={scroll}
      horizontal
      showsHorizontalScrollIndicator={false}
      accessibilityRole="tablist"
      accessibilityLabel="Catégories"
      onContentSizeChange={(width) => setContentWidth(width)}
      style={{ flex: 1, minWidth: 0 }}
      contentContainerStyle={{ gap: L.sp(6), alignItems: 'center' }}
    >
      {categories.map((category) => {
        const selected = category._id === activeId;
        const foreground = selected ? brand.onAccent : palette.mut;
        return (
          <View
            key={category._id}
            onLayout={(event) => positions.current.set(category._id, event.nativeEvent.layout.x)}
          >
            <Press
              onPress={() => onSelect(category._id)}
              accessibilityRole="tab"
              accessibilityLabel={category.name}
              selected={selected}
              style={{
                minHeight: L.touch(),
                flexDirection: 'row',
                alignItems: 'center',
                gap: L.sp(8),
                paddingHorizontal: L.sp(12),
                borderRadius: R.pill,
                borderWidth: 1,
                borderColor: selected ? brand.accent : palette.line2,
                backgroundColor: selected ? brand.accent : palette.surface,
              }}
              activeStyle={{ opacity: 0.82 }}
            >
              {L.catalogCategoryIcons ? <Icon name={categoryIcon(category.name)} size={L.fs(15)} color={foreground} /> : null}
              <Text style={{ fontFamily: FONT, color: foreground, fontWeight: '600', fontSize: L.fs(13.5) }}>
                {railLabel(category.name)}
              </Text>
              <View style={{ paddingHorizontal: L.sp(7), paddingVertical: L.sp(1), borderRadius: R.pill, backgroundColor: selected ? withAlpha(brand.onAccent, 0.15) : palette.line2 }}>
                <Text style={{ fontFamily: FONT, color: foreground, fontSize: L.fs(12), fontWeight: '700', fontVariant: ['tabular-nums'] }}>
                  {category.products.length}
                </Text>
              </View>
            </Press>
          </View>
        );
      })}
    </ScrollView>
  );
}
