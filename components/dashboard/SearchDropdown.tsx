import { View, Text, Pressable, ActivityIndicator, ScrollView, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { SearchHit, SearchResults } from '../../hooks/useGlobalSearch';
import { colors, spacing, radius, font, shadow } from '../../theme';

/**
 * The results panel under the header search box.
 *
 * Grouped rather than ranked: "my booklist for Chrisland", "a book on
 * one of my lists" and "a shop called Chrisland Books" are different
 * intentions, and interleaving them makes the reader sort them again.
 *
 * Presses are handled on onPressIn as well as onPress: on web the input
 * blurs on mousedown, and a panel that closes on blur would otherwise
 * vanish before the click it was waiting for ever landed.
 */

const GROUPS: { key: keyof SearchResults; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'booklists', label: 'My booklists', icon: 'list-outline' },
  { key: 'items', label: 'Books & items on my lists', icon: 'book-outline' },
  { key: 'shops', label: 'Bookshops', icon: 'storefront-outline' },
];

interface Props {
  query: string;
  results: SearchResults;
  loading: boolean;
  signedIn: boolean;
  onSelect: (hit: SearchHit) => void;
  onSeeAllShops: () => void;
  onSeeAllBooklists: () => void;
}

export function SearchDropdown({
  query,
  results,
  loading,
  signedIn,
  onSelect,
  onSeeAllShops,
  onSeeAllBooklists,
}: Props) {
  const total = results.booklists.length + results.items.length + results.shops.length;

  return (
    <View style={styles.panel} accessibilityRole="menu" accessibilityLabel="Search results">
      <ScrollView style={{ maxHeight: 420 }} keyboardShouldPersistTaps="always">
        {loading && total === 0 ? (
          <View style={styles.state}>
            <ActivityIndicator color={colors.navy} />
          </View>
        ) : total === 0 ? (
          <View style={styles.state}>
            <Text style={styles.stateTitle}>Nothing matches “{query.trim()}”</Text>
            <Text style={styles.stateBody}>
              {signedIn
                ? 'Try a school, a class, a child’s name, a book title or a shop.'
                : 'Try a shop name or a city. Sign in to search your own booklists too.'}
            </Text>
          </View>
        ) : (
          GROUPS.map((group) => {
            const hits = results[group.key];
            if (hits.length === 0) return null;
            return (
              <View key={group.key} style={styles.group}>
                <Text style={styles.groupLabel}>{group.label}</Text>
                {hits.map((hit) => (
                  <Pressable
                    key={`${hit.kind}-${hit.id}`}
                    onPressIn={() => onSelect(hit)}
                    style={({ pressed, hovered }: any) => [styles.row, (pressed || hovered) && styles.rowHover]}
                    accessibilityRole="menuitem"
                    accessibilityLabel={`${hit.title}, ${hit.subtitle}`}
                  >
                    <View style={styles.icon}>
                      <Ionicons name={group.icon} size={15} color={colors.navy} />
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.title} numberOfLines={1}>
                        {hit.title}
                      </Text>
                      {!!hit.subtitle && (
                        <Text style={styles.subtitle} numberOfLines={1}>
                          {hit.subtitle}
                        </Text>
                      )}
                    </View>
                    <Ionicons name="chevron-forward" size={14} color={colors.textFaint} />
                  </Pressable>
                ))}
              </View>
            );
          })
        )}
      </ScrollView>

      <View style={styles.footer}>
        {signedIn && (
          <Pressable onPressIn={onSeeAllBooklists} style={styles.footerBtn} accessibilityRole="button">
            <Text style={styles.footerText}>Filter my booklists</Text>
          </Pressable>
        )}
        <Pressable onPressIn={onSeeAllShops} style={styles.footerBtn} accessibilityRole="button">
          <Text style={styles.footerText}>Search all shops</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    ...shadow.raised,
  },
  state: { padding: spacing.xl, alignItems: 'center', gap: spacing.xs },
  stateTitle: { fontSize: font.md, fontWeight: '700', color: colors.text, textAlign: 'center' },
  stateBody: { fontSize: font.sm, color: colors.textFaint, textAlign: 'center', lineHeight: 18 },
  group: { paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  groupLabel: {
    fontSize: font.xs,
    fontWeight: '700',
    color: colors.textFaint,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  rowHover: { backgroundColor: colors.surfaceMuted },
  icon: {
    width: 28,
    height: 28,
    borderRadius: radius.sm,
    backgroundColor: '#E8EEF8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontSize: font.md, fontWeight: '600', color: colors.text },
  subtitle: { fontSize: font.xs, color: colors.textFaint, marginTop: 1 },
  footer: { flexDirection: 'row', gap: spacing.sm, padding: spacing.sm, backgroundColor: colors.surfaceMuted },
  footerBtn: { paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.pill },
  footerText: { fontSize: font.sm, fontWeight: '700', color: colors.navy },
});
