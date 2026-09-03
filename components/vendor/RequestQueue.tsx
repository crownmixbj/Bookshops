import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { QueueBadge, VendorQueueRow } from '../../types/db';
import { badgeFor, BADGE_LABEL } from '../../hooks/useVendorDashboard';
import { colors, spacing, radius, font } from '../../theme';
import { useLayout } from '../../hooks/useLayout';

const BADGE_TONE: Record<QueueBadge, { bg: string; fg: string }> = {
  new: { bg: '#FCEAE8', fg: colors.danger },
  pending: { bg: colors.warningBg, fg: colors.warning },
  processing: { bg: '#E4EAF5', fg: colors.navy },
  sent: { bg: '#E4F2E8', fg: colors.success },
  accepted: { bg: '#E4F2E8', fg: colors.success },
};

function Badge({ kind }: { kind: QueueBadge }) {
  const tone = BADGE_TONE[kind];
  return (
    <View style={[styles.badge, { backgroundColor: tone.bg }]}>
      <Text style={[styles.badgeText, { color: tone.fg }]}>{BADGE_LABEL[kind]}</Text>
    </View>
  );
}

function Actions({
  row,
  onView,
  onDecline,
}: {
  row: VendorQueueRow;
  onView: (row: VendorQueueRow) => void;
  onDecline: (row: VendorQueueRow) => void;
}) {
  return (
    <View style={styles.actions}>
      <Pressable
        onPress={() => onView(row)}
        style={({ pressed }) => [styles.btn, styles.btnView, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel={`View list for ${row.customer_name ?? row.reference}`}
      >
        <Text style={styles.btnViewText}>View List</Text>
      </Pressable>
      <Pressable
        onPress={() => onDecline(row)}
        style={({ pressed }) => [styles.btn, styles.btnDecline, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel={`Decline ${row.customer_name ?? row.reference}`}
      >
        <Text style={styles.btnDeclineText}>Decline</Text>
      </Pressable>
    </View>
  );
}

/**
 * The incoming request queue.
 *
 * A real table on wide screens; stacked cards below tablet, because a
 * five-column table on a phone is either unreadable or scrolls
 * horizontally, and vendors will use this on a phone in a shop.
 *
 * `customer_name` is null whenever this vendor has not engaged with the
 * request — the database decides that, not this component. The reference
 * code is shown in its place rather than an empty cell.
 */
export function RequestQueue({
  rows,
  selectedId,
  onView,
  onDecline,
}: {
  rows: VendorQueueRow[];
  selectedId: string | null;
  onView: (row: VendorQueueRow) => void;
  onDecline: (row: VendorQueueRow) => void;
}) {
  const { isMobile } = useLayout();

  if (rows.length === 0) {
    return (
      <View style={styles.empty}>
        <Ionicons name="file-tray-outline" size={26} color={colors.textFaint} />
        <Text style={styles.emptyText}>
          No open requests right now. New booklists from buyers in your area appear here.
        </Text>
      </View>
    );
  }

  if (isMobile) {
    return (
      <View style={styles.cards}>
        {rows.map((row) => (
          <View
            key={row.request_id}
            style={[styles.card, row.request_id === selectedId && styles.cardSelected]}
          >
            <View style={styles.cardHead}>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardName} numberOfLines={1}>
                  {row.customer_name ?? row.reference}
                </Text>
                <Text style={styles.cardMeta} numberOfLines={1}>
                  {[row.school_name, row.class_level].filter(Boolean).join(' · ')}
                </Text>
              </View>
              <Badge kind={badgeFor(row)} />
            </View>
            <Text style={styles.cardItems}>
              {row.item_count} item{row.item_count === 1 ? '' : 's'}
              {/* After bookshops_dispatch_routing.sql this is stronger
                  than a preference: a direct request is in no other
                  shop's queue at all. */}
              {row.is_targeted ? ' · sent to you only' : ''}
            </Text>
            <Actions row={row} onView={onView} onDecline={onDecline} />
          </View>
        ))}
      </View>
    );
  }

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ minWidth: '100%' }}>
      <View style={styles.table}>
        <View style={styles.headRow}>
          <Text style={[styles.th, styles.colName]}>Customer</Text>
          <Text style={[styles.th, styles.colSchool]}>School / Level</Text>
          <Text style={[styles.th, styles.colItems]}>No. of Items</Text>
          <Text style={[styles.th, styles.colStatus]}>Status</Text>
          <Text style={[styles.th, styles.colActions]}>Actions</Text>
        </View>

        {rows.map((row) => (
          <View
            key={row.request_id}
            style={[styles.row, row.request_id === selectedId && styles.rowSelected]}
          >
            <View style={styles.colName}>
              <Text style={styles.cellStrong} numberOfLines={1}>
                {row.customer_name ?? row.reference}
              </Text>
              {!row.customer_name && (
                <Text style={styles.cellHint}>Name shown once you quote</Text>
              )}
            </View>
            <Text style={[styles.cell, styles.colSchool]} numberOfLines={2}>
              {[row.school_name, row.class_level].filter(Boolean).join(' — ') || '—'}
            </Text>
            <Text style={[styles.cell, styles.colItems]}>{row.item_count}</Text>
            <View style={styles.colStatus}>
              <Badge kind={badgeFor(row)} />
            </View>
            <View style={styles.colActions}>
              <Actions row={row} onView={onView} onDecline={onDecline} />
            </View>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  table: { flex: 1, minWidth: 720 },
  headRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.surfaceMuted,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  th: { fontSize: font.xs, fontWeight: '800', color: colors.textMuted, letterSpacing: 0.3 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rowSelected: { backgroundColor: '#F4F8FF' },
  cell: { fontSize: font.md, color: colors.textMuted },
  cellStrong: { fontSize: font.md, color: colors.text, fontWeight: '600' },
  cellHint: { fontSize: font.xs, color: colors.textFaint, fontStyle: 'italic', marginTop: 1 },

  colName: { flex: 2.2, paddingRight: spacing.md },
  colSchool: { flex: 2, paddingRight: spacing.md },
  colItems: { flex: 1, paddingRight: spacing.md },
  colStatus: { flex: 1.4, paddingRight: spacing.md },
  colActions: { flex: 1.8, alignItems: 'flex-start' },

  badge: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.sm,
  },
  badgeText: { fontSize: font.xs, fontWeight: '700' },

  actions: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  btn: {
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  btnView: { borderColor: colors.navy },
  btnViewText: { color: colors.navy, fontWeight: '700', fontSize: font.sm },
  btnDecline: { borderColor: '#F0C4BF' },
  btnDeclineText: { color: colors.danger, fontWeight: '700', fontSize: font.sm },
  pressed: { opacity: 0.8 },

  cards: { padding: spacing.lg, gap: spacing.md },
  card: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  cardSelected: { borderColor: colors.navy, backgroundColor: '#F4F8FF' },
  cardHead: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  cardName: { fontSize: font.md, fontWeight: '700', color: colors.text },
  cardMeta: { fontSize: font.sm, color: colors.textMuted, marginTop: 1 },
  cardItems: { fontSize: font.sm, color: colors.textMuted },

  empty: { alignItems: 'center', gap: spacing.sm, padding: spacing.xxl },
  emptyText: {
    fontSize: font.md,
    color: colors.textMuted,
    textAlign: 'center',
    maxWidth: 340,
    lineHeight: 20,
  },
});
