import { useMemo, useState } from 'react';
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
  draft: { label: 'Draft — not sent yet', tone: 'neutral' },
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

function ItemRow({ item, serial }: { item: BookRequestItem; serial: number }) {
  const lineTotal = item.unit_price == null ? null : item.unit_price * item.quantity;

  return (
    <View style={styles.itemRow}>
      {/* Position on the list, running unbroken across the category
          groups — this is what a parent reads off against the paper
          the school sent home. Faint and plain on purpose: the two
          numbers on this row must not look alike. */}
      <Text style={styles.itemSerial}>{serial}.</Text>

      <View style={{ flex: 1 }}>
        <Text style={styles.itemTitle} numberOfLines={2}>
          {item.title}
        </Text>
        {item.parsed && <Text style={styles.itemParsed}>read from photo — check this line</Text>}
      </View>

      {/* Only when it is not 1. A column of "1×" against every line is
          noise, and it is the one case where the quantity could be
          mistaken for the serial beside it. */}
      {item.quantity > 1 && (
        <View style={styles.itemQty}>
          <Text style={styles.itemQtyText}>×{item.quantity}</Text>
        </View>
      )}

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
  onEdit?: (booklist: Booklist) => void;
  onPublish?: (booklist: Booklist) => void;
  onDelete?: (booklist: Booklist) => void;
  /** True while this card's Publish is in flight. */
  publishing?: boolean;
}

export function BooklistCard({
  booklist,
  defaultExpanded = false,
  onPressQuotes,
  onEdit,
  onPublish,
  onDelete,
  publishing = false,
}: Props) {
  const [open, setOpen] = useState(defaultExpanded);
  const status = STATUS_COPY[booklist.status];
  const liveQuotes = booklist.quotes.filter((q) => q.status === 'sent').length;

  /**
   * Line id -> its number on the list.
   *
   * Built once over the groups in the order they render, rather than
   * numbering within each group: the card splits a list into Textbooks /
   * Stationery / Uniforms, and restarting at 1 in each would give a
   * twelve-line booklist two items numbered 1. Walking the groups here
   * means Textbooks 1-6 is followed by Other items 7-12, and the last
   * number equals the line count in the header.
   */
  const serials = useMemo(() => {
    const map = new Map<string, number>();
    let n = 0;
    for (const group of booklist.groups) {
      for (const item of group.items) map.set(item.id, ++n);
    }
    return map;
  }, [booklist.groups]);

  const isDraft = booklist.status === 'draft';
  // Editing and deleting stay available right up until a vendor commits
  // time to the list. `requests_delete_own` draws the same line in the
  // database, so a button shown past this point would fail at the policy
  // rather than at the UI.
  const isEditable = isDraft || booklist.status === 'pending_quote';

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
            {/* Lines, not copies. This number is what the serials count
                up to, so the two cannot disagree; a line ordered twice
                shows its own ×2 rather than inflating the total. */}
            {[booklist.class_level, `${booklist.lineCount} item${booklist.lineCount === 1 ? '' : 's'}`]
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
                  <ItemRow key={item.id} item={item} serial={serials.get(item.id) ?? 0} />
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

          {isEditable && (onEdit || onPublish || onDelete) && (
            <View style={styles.actions}>
              {onEdit && (
                <Pressable
                  onPress={() => onEdit(booklist)}
                  style={({ pressed }) => [styles.action, pressed && styles.pressed]}
                  accessibilityRole="button"
                  accessibilityLabel={`Edit the booklist for ${booklist.school_name}`}
                >
                  <Ionicons name="create-outline" size={16} color={colors.navy} />
                  <Text style={styles.actionText}>Edit List</Text>
                </Pressable>
              )}

              {/* Publish only from 'draft'. A list already in the queue
                  has nowhere to be published to. */}
              {isDraft && onPublish && (
                <Pressable
                  onPress={() => onPublish(booklist)}
                  disabled={publishing}
                  style={({ pressed }) => [
                    styles.action,
                    styles.actionPrimary,
                    pressed && styles.pressed,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={`Publish ${booklist.school_name} to vendors`}
                >
                  <Ionicons
                    name={publishing ? 'hourglass-outline' : 'send-outline'}
                    size={15}
                    color={colors.onNavy}
                  />
                  <Text style={styles.actionPrimaryText}>
                    {publishing ? 'Publishing…' : 'Publish'}
                  </Text>
                </Pressable>
              )}

              {onDelete && (
                <Pressable
                  onPress={() => onDelete(booklist)}
                  style={({ pressed }) => [styles.action, styles.actionDanger, pressed && styles.pressed]}
                  accessibilityRole="button"
                  accessibilityLabel={`Delete the booklist for ${booklist.school_name}`}
                >
                  <Ionicons name="trash-outline" size={16} color={colors.danger} />
                  <Text style={styles.actionDangerText}>Delete List</Text>
                </Pressable>
              )}
            </View>
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
  // Fixed width so every title starts on the same x, up to "12." and
  // beyond; tabular-ish alignment without a monospace font.
  itemSerial: {
    fontSize: font.sm,
    fontWeight: '600',
    color: colors.textFaint,
    minWidth: 24,
    paddingTop: 1,
  },
  // A chip, where the serial is bare text. Same information density,
  // deliberately different shape.
  itemQty: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.sm,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  itemQtyText: { fontSize: font.xs, fontWeight: '700', color: colors.textMuted },
  itemTitle: { fontSize: font.md, color: colors.text },
  itemParsed: { fontSize: font.xs, color: colors.orangeDark, fontStyle: 'italic', marginTop: 1 },
  itemPrice: { fontSize: font.md, fontWeight: '700', color: colors.text },
  itemPriceMuted: { color: colors.textFaint, fontWeight: '500', fontSize: font.sm },

  caveat: { fontSize: font.xs, color: colors.warning, marginTop: spacing.md, lineHeight: 16 },

  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    // 44 tall: these sit close together and one of them is destructive.
    minHeight: 44,
  },
  actionText: { fontSize: font.sm, fontWeight: '700', color: colors.navy },
  actionPrimary: { backgroundColor: colors.navy, borderColor: colors.navy },
  actionPrimaryText: { fontSize: font.sm, fontWeight: '700', color: colors.onNavy },
  actionDanger: { borderColor: '#F0C4BF' },
  actionDangerText: { fontSize: font.sm, fontWeight: '700', color: colors.danger },

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
