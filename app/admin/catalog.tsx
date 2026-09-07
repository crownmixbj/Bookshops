import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Footer } from '../../components/layout/Footer';
import { useLayout } from '../../hooks/useLayout';
import { pageStyles } from '../../components/admin/AdminTable';
import { colors, spacing, radius, font } from '../../theme';

/**
 * Master Catalog.
 *
 * The route exists so the sidebar item is not dead, and the screen says
 * what a catalogue would need rather than showing an empty table that
 * reads as "no books yet".
 *
 * Nothing in the schema describes a product. `book_request_items` holds
 * what a buyer typed or photographed, and `quote_items` holds what one
 * shop offered against it — both are free text, per request. There is no
 * canonical title, no ISBN, no edition, no publisher, and no school or
 * curriculum record. A master catalogue is a new data model, not a new
 * query over this one.
 */
const NEEDS = [
  {
    icon: 'book-outline' as const,
    title: 'A books table',
    body:
      'Canonical title, author, publisher, edition and ISBN, so two shops quoting "New General Mathematics JSS2" are quoting the same object. Today both sides are free text on book_request_items and quote_items.',
  },
  {
    icon: 'school-outline' as const,
    title: 'A schools directory',
    body:
      'book_requests stores school_name as typed, so "Chrisland", "Chrisland Schools" and "chrisland college" are three different schools. A directory with real rows is what lets you group requests by school at all.',
  },
  {
    icon: 'list-outline' as const,
    title: 'Curriculum lists',
    body:
      'A per-school, per-class list of required titles for a term. This is what would let the Booklist Engine pre-fill a request instead of reading every list from a photo.',
  },
  {
    icon: 'pricetags-outline' as const,
    title: 'A link from catalogue to quotes',
    body:
      'quote_items.request_item_id already ties a quoted line back to a requested one. Pointing both at a catalogue row is what turns "what did people pay for this book" into a question the database can answer.',
  },
];

export default function AdminCatalogScreen() {
  const { contentPadding, isMobile } = useLayout();

  return (
    <ScrollView contentContainerStyle={[pageStyles.scroll, { padding: contentPadding }]}>
      <View style={pageStyles.heading}>
        <Text style={pageStyles.h1}>Master Catalog</Text>
        <Text style={pageStyles.h2}>Master book database, curriculum lists and school directories</Text>
      </View>

      <View style={styles.notice}>
        <Ionicons name="construct-outline" size={18} color={colors.warning} />
        <Text style={styles.noticeText}>
          Not built yet. The marketplace currently works without a catalogue — buyers describe what
          they need and shops price it — so this is an addition to the data model, not a screen
          waiting on a query.
        </Text>
      </View>

      <View style={[styles.grid, isMobile && styles.gridStacked]}>
        {NEEDS.map((n) => (
          <View key={n.title} style={styles.card}>
            <View style={styles.cardHead}>
              <View style={styles.cardIcon}>
                <Ionicons name={n.icon} size={17} color={colors.navy} />
              </View>
              <Text style={styles.cardTitle}>{n.title}</Text>
            </View>
            <Text style={styles.cardBody}>{n.body}</Text>
          </View>
        ))}
      </View>

      <View style={styles.actions}>
        <Pressable
          onPress={() => router.push('/admin/booklists')}
          style={({ pressed }) => [styles.secondary, pressed && styles.secondaryPressed]}
          accessibilityRole="button"
        >
          <Text style={styles.secondaryText}>See what buyers are actually asking for</Text>
        </Pressable>
      </View>

      <Footer audience="admin" />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  notice: {
    flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm,
    backgroundColor: colors.warningBg, borderRadius: radius.md, padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  noticeText: { flex: 1, fontSize: font.md, color: colors.text, lineHeight: 20 },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  gridStacked: { flexDirection: 'column' },
  card: {
    flexBasis: 300, flexGrow: 1, backgroundColor: colors.surface,
    borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  cardIcon: {
    width: 32, height: 32, borderRadius: radius.sm, backgroundColor: colors.surfaceMuted,
    alignItems: 'center', justifyContent: 'center',
  },
  cardTitle: { flex: 1, fontSize: font.md, fontWeight: '700', color: colors.text },
  cardBody: { fontSize: font.sm, color: colors.textMuted, lineHeight: 19 },

  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.lg },
  secondary: {
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.borderStrong,
    backgroundColor: colors.surface, paddingHorizontal: spacing.lg, paddingVertical: 11,
  },
  secondaryPressed: { backgroundColor: colors.surfaceMuted },
  secondaryText: { fontSize: font.md, fontWeight: '700', color: colors.navy },
});
