import { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { CATEGORY_LABEL } from '../../hooks/useBooklists';
import type { Booklist, BookRequestItem, FulfillmentStatus, RequestStatus } from '../../types/db';
import { colors, spacing, radius, font, shadow, formatNaira } from '../../theme';

const CATEGORY_ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  textbook: 'book-outline',
  stationery: 'pencil-outline',
  uniform: 'shirt-outline',
  other: 'cube-outline',
};

/** How each stage should read to a parent, not to a database. */
const STATUS_COPY: Record<RequestStatus, { label: string; tone: 'neutral' | 'info' | 'success' | 'warning' }> = {
  pending_quote: { label: 'Waiting for quotes', tone: 'warning' },
  quoted: { label: 'Quotes received', tone: 'info' },
  ordered: { label: 'Ordered', tone: 'success' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
};

const FULFILMENT_COPY: Record<FulfillmentStatus, string> = {
  processing: 'Being prepared',
  ready: 'Ready for pickup',
  dispatched: 'On the way',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};

function Chip({ label, tone = 'neutral', icon }: {
  label: string;
  tone?: 'neutral' | 'info' | 'success' | 'warning';
  icon?: keyof typeof Ionicons.glyphMap;
}) {
  const t =
    tone === 'success'
      ? { bg: '#E4F2E8', fg: colors.success }
      : tone === 'warning'
      ? { bg: colors.warningBg, fg: colors.warning }
      : tone === 'info'
      ? { bg: '#E4EAF5', fg: colors.navy }
      : { bg: colors.surfaceMuted, fg: colors.textMuted };
  return (
    <View style={[styles.chip, { backgroundColor: t.bg }]}>
      {icon && <Ionicons name={icon} size={11} color={t.fg} />}
      <Text style={[styles.chipText, { color: t.fg }]}>{label}</Text>
    </View>
  );
}

function ItemRow({ item }: { item: BookRequestItem }) {
  const lineTotal = item.unit_price == null ? null : item.unit_price * item.quantity;
  return (
    <View style={styles.itemRow}>
      <Text style={styles.itemQty}>{item.quantity}×</Text>
      <View style={{ flex: 1 }}>
        <Text style={styles.itemTitle} numberOfLines={2}>
          {item.title}
        </Text>
        {item.parsed && <Text style={styles.itemParsed}>read from photo — check this line</Text>}
      </View>
      <Text style={[styles.itemPrice, lineTotal == null && styles.itemPriceMuted]}>
        {lineTotal == null ? 'Not priced' : formatNaira(lineTotal)}
      </Text>
    </View>
  );
}

interface Props {
  booklist: Booklist;
  defaultExpanded?: boolean;
  onPressQuotes?: (booklist: Booklist) => void;
}

export function BooklistCard({ booklist, defaultExpanded = false, onPressQuotes }: Props) {
  const [open, setOpen] = useState(defaultExpanded);
  const status = STATUS_COPY[booklist.status];
  const liveQuotes = booklist.quotes.filter((q) => q.status === 'sent').length;

  const totalCaption =
    booklist.totalSource === 'order'
      ? 'Order total'
      : booklist.totalSource === 'quote'
      ? liveQuotes > 1
        ? 'Best quote'
        : 'Quoted'
      : booklist.totalSource === 'items'
      ? 'Your estimate'
      : 'No price yet';

  return (
    <View style={styles.card}>
      <Pressable
        onPress={() => setOpen((v) => !v)}
        style={styles.head}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${booklist.school_name}, ${status.label}`}
      >
        <View style={styles.thumb}>
          <Ionicons name="documents-outline" size={17} color={colors.navy} />
        </View>

        <View style={{ flex: 1 }}>
          <Text style={styles.school} numberOfLines={1}>
            {booklist.school_name || 'Untitled booklist'}
          </Text>
          <Text style={styles.meta} numberOfLines={1}>
            {[booklist.class_level, `${booklist.itemCount} item${booklist.itemCount === 1 ? '' : 's'}`]
              .filter(Boolean)
              .join(' · ')}
          </Text>
          <View style={styles.chipRow}>
            <Chip label={status.label} tone={status.tone} />
            {booklist.order && (
              <Chip
                label={FULFILMENT_COPY[booklist.order.fulfillment_status]}
                tone={booklist.order.fulfillment_status === 'delivered' ? 'success' : 'info'}
                icon="cube-outline"
              />
            )}
            {liveQuotes > 0 && (
              <Chip label={`${liveQuotes} quote${liveQuotes === 1 ? '' : 's'}`} tone="info" />
            )}
            {booklist.image_path && <Chip label="Photo attached" icon="image-outline" />}
          </View>
        </View>

        <View style={styles.totalWrap}>
          <Text style={styles.totalCaption}>{totalCaption}</Text>
          <Text style={styles.total}>
            {booklist.estimatedTotal > 0 ? formatNaira(booklist.estimatedTotal) : '—'}
          </Text>
          <Ionicons
            name={open ? 'chevron-up' : 'chevron-down'}
            size={16}
            color={colors.textMuted}
            style={{ alignSelf: 'flex-end', marginTop: 2 }}
          />
        </View>
      </Pressable>

      {open && (
        <View style={styles.body}>
          {booklist.groups.length === 0 ? (
            <Text style={styles.empty}>
              No items on this list yet. Add them so vendors know what to quote.
            </Text>
          ) : (
            booklist.groups.map((group) => (
              <View key={group.category} style={styles.group}>
                <View style={styles.groupHead}>
                  <Ionicons
                    name={CATEGORY_ICON[group.category] ?? 'cube-outline'}
                    size={14}
                    color={colors.textMuted}
                  />
                  <Text style={styles.groupTitle}>{CATEGORY_LABEL[group.category]}</Text>
                  <Text style={styles.groupSubtotal}>
                    {group.subtotal > 0 ? formatNaira(group.subtotal) : '—'}
                  </Text>
                </View>
                {group.items.map((item) => (
                  <ItemRow key={item.id} item={item} />
                ))}
                {group.unpricedCount > 0 && (
                  <Text style={styles.groupNote}>
                    {group.unpricedCount} line{group.unpricedCount === 1 ? '' : 's'} awaiting a price
                  </Text>
                )}
              </View>
            ))
          )}

          {booklist.hasUnpricedItems && booklist.totalSource === 'items' && (
            <Text style={styles.caveat}>
              This total covers only the lines that have a price — it isn't the full cost yet.
            </Text>
          )}

          {liveQuotes > 0 && (
            <Pressable
              onPress={() => onPressQuotes?.(booklist)}
              style={({ pressed }) => [styles.cta, pressed && styles.pressed]}
              accessibilityRole="button"
            >
              <Text style={styles.ctaText}>
                Compare {liveQuotes} quote{liveQuotes === 1 ? '' : 's'}
              </Text>
              <Ionicons name="arrow-forward" size={15} color={colors.onNavy} />
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.md,
    overflow: 'hidden',
    ...shadow.card,
  },
  head: { flexDirection: 'row', gap: spacing.md, padding: spacing.lg, alignItems: 'flex-start' },
  thumb: {
    width: 38,
    height: 38,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  school: { fontSize: font.md, fontWeight: '700', color: colors.text },
  meta: { fontSize: font.sm, color: colors.textMuted, marginTop: 1 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: spacing.sm },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.sm,
  },
  chipText: { fontSize: font.xs, fontWeight: '700' },

  totalWrap: { alignItems: 'flex-end', minWidth: 92 },
  totalCaption: { fontSize: font.xs, color: colors.textFaint },
  total: { fontSize: font.lg, fontWeight: '800', color: colors.navy },

  body: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
  },
  empty: { fontSize: font.md, color: colors.textMuted, paddingVertical: spacing.lg },

  group: { marginTop: spacing.lg },
  groupHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  groupTitle: { flex: 1, fontSize: font.sm, fontWeight: '700', color: colors.textMuted },
  groupSubtotal: { fontSize: font.sm, fontWeight: '700', color: colors.text },
  groupNote: { fontSize: font.xs, color: colors.warning, marginTop: 5 },

  itemRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    paddingVertical: 9,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  itemQty: { fontSize: font.sm, fontWeight: '700', color: colors.textMuted, minWidth: 26 },
  itemTitle: { fontSize: font.md, color: colors.text },
  itemParsed: { fontSize: font.xs, color: colors.orangeDark, fontStyle: 'italic', marginTop: 1 },
  itemPrice: { fontSize: font.md, fontWeight: '700', color: colors.text },
  itemPriceMuted: { color: colors.textFaint, fontWeight: '500', fontSize: font.sm },

  caveat: { fontSize: font.xs, color: colors.warning, marginTop: spacing.md, lineHeight: 16 },

  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.navy,
    borderRadius: radius.md,
    paddingVertical: 11,
    marginTop: spacing.lg,
  },
  ctaText: { color: colors.onNavy, fontWeight: '700', fontSize: font.md },
  pressed: { opacity: 0.85 },
});
