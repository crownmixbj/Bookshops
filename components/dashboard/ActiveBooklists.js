import { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Card, Pill } from './Card';
import { LINE_PRICE_LABEL, linePriceState } from '../../lib/booklistPricing';
import { colors, spacing, radius, font, formatNaira } from '../../theme';

function Checkbox({ checked, onToggle, label }) {
  return (
    <Pressable
      onPress={onToggle}
      hitSlop={6}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={label}
      style={[styles.checkbox, checked && styles.checkboxOn]}
    >
      {checked && <Ionicons name="checkmark" size={13} color={colors.onNavy} />}
    </Pressable>
  );
}

function ItemRow({ item, checked, onToggle, isLast, hasQuote }) {
  // formatNaira(null) renders ₦0, which reads as "free" rather than
  // "nobody has priced this yet" — so the empty cases are handled before
  // it ever runs.
  //
  // line_total comes from the pricing quote's quote_items. Demo rows
  // carry a bare unit_price instead, hence the fallback.
  const lineTotal =
    item.line_total != null
      ? Number(item.line_total)
      : item.unit_price == null
      ? null
      : Number(item.unit_price) * (Number(item.quantity) || 1);

  const available = item.is_available !== false;
  const unpriced = lineTotal == null;

  // Shared with the My Booklists card, so the same line cannot be
  // described two different ways on two screens.
  const state = linePriceState({ lineTotal, isAvailable: available }, hasQuote === true);
  const priceLabel = state === 'priced' ? formatNaira(lineTotal) : LINE_PRICE_LABEL[state];

  const showsUnitPrice = available && lineTotal != null && (Number(item.quantity) || 1) > 1;

  return (
    <View style={[styles.itemRow, isLast && styles.itemRowLast]}>
      <Checkbox checked={checked} onToggle={onToggle} label={item.title} />
      <View style={styles.itemText}>
        <View style={styles.itemTitleLine}>
          {/* Same rule as the booklist hub: a badge only when there is
              more than one copy, so the common row stays clean. */}
          {item.quantity > 1 && (
            <View style={styles.qty}>
              <Text style={styles.qtyText}>{item.quantity}×</Text>
            </View>
          )}
          <Text style={styles.itemTitle} numberOfLines={2}>
            {item.title}
          </Text>
        </View>
        {!!item.author && (
          <Text style={styles.itemAuthor} numberOfLines={1}>
            {item.author}
          </Text>
        )}
      </View>
      <View style={styles.itemRight}>
        <Text
          style={[
            styles.itemPrice,
            unpriced && styles.itemPriceMuted,
            !available && styles.itemPriceOut,
          ]}
        >
          {priceLabel}
        </Text>
        {/* The per-copy figure, so a multi-copy line reads as a price
            times a count rather than an unexplained larger number. */}
        {showsUnitPrice && (
          <Text style={styles.itemUnitPrice}>{formatNaira(item.unit_price)} each</Text>
        )}
        {/* The shop offered fewer copies than were asked for. Quietly
            billing for two when three were requested is the kind of gap
            a parent only finds at the counter. */}
        {available && item.requested_quantity > (Number(item.quantity) || 1) && (
          <Text style={styles.itemQtyWarn}>
            {item.quantity} of {item.requested_quantity} quoted
          </Text>
        )}
        {item.in_stock === false && <Pill label="Low Stock" tone="warning" />}
      </View>
    </View>
  );
}

/**
 * "Active Booklist Requests" — a collapsible vendor group with a checkbox
 * row per book title. Checking a row feeds the order total, so selection
 * state is lifted to the screen rather than held here.
 */
export function ActiveBooklists({
  requests,
  selection,
  onToggleItem,
  onOpenRequest,
  onOpenDrafts,
  onOpenOrders,
  draftCount = 0,
  orderedCount = 0,
  loading,
}) {
  const [openId, setOpenId] = useState(requests?.[0]?.id ?? null);

  if (loading) {
    return (
      <Card title="Active Booklist Requests">
        <View style={styles.skeletonWrap}>
          {[0, 1, 2].map((i) => (
            <View key={i} style={styles.skeletonRow} />
          ))}
        </View>
      </Card>
    );
  }

  if (!requests?.length) {
    // Neither drafts nor ordered lists appear in this card — drafts are
    // still being written, and an ordered list has become an order and
    // lives on My Orders. Telling a buyer who has either that they have
    // "no booklists yet" would be false, so point at where their work
    // actually is. Drafts first: they are the ones still needing a hand.
    const hasDrafts = draftCount > 0;
    const hasOrders = orderedCount > 0;

    const copy = hasDrafts
      ? `You have ${draftCount} draft${draftCount === 1 ? '' : 's'} waiting. Send one to vendors and it will appear here.`
      : hasOrders
      ? `Nothing awaiting a decision. Your ${orderedCount} ordered booklist${
          orderedCount === 1 ? '' : 's'
        } moved to My Orders.`
      : 'No booklists yet. Snap a photo of a school booklist to get quotes from nearby shops.';

    const action = hasDrafts
      ? { label: 'Open My Booklists', onPress: onOpenDrafts, hint: 'Open My Booklists to finish a draft' }
      : hasOrders
      ? { label: 'Open My Orders', onPress: onOpenOrders, hint: 'Open My Orders to track a purchase' }
      : null;

    return (
      <Card title="Active Booklist Requests">
        <View style={styles.empty}>
          <Ionicons
            name={
              hasDrafts ? 'create-outline' : hasOrders ? 'cube-outline' : 'document-text-outline'
            }
            size={26}
            color={colors.textFaint}
          />
          <Text style={styles.emptyText}>{copy}</Text>
          {action?.onPress && (
            <Pressable
              onPress={action.onPress}
              style={({ pressed }) => [styles.emptyAction, pressed && styles.emptyActionPressed]}
              accessibilityRole="button"
              accessibilityLabel={action.hint}
            >
              <Text style={styles.emptyActionText}>{action.label}</Text>
              <Ionicons name="chevron-forward" size={15} color={colors.navy} />
            </Pressable>
          )}
        </View>
      </Card>
    );
  }

  return (
    <Card
      title="Active Booklist Requests"
    >
      {requests.map((request) => {
        const open = openId === request.id;
        return (
          <View key={request.id} style={styles.group}>
            <Pressable
              onPress={() => setOpenId(open ? null : request.id)}
              style={({ pressed }) => [styles.groupHead, pressed && styles.groupHeadPressed]}
              accessibilityRole="button"
              // accessibilityState covers iOS and Android. On web
              // react-native-web does not translate `expanded` into
              // aria-expanded, so the row announced as a plain button
              // with no hint that it opens anything, or whether it is
              // already open. aria-* props pass straight through.
              accessibilityState={{ expanded: open }}
              aria-expanded={open}
              accessibilityLabel={`${request.vendor_name}, ${open ? 'collapse' : 'expand'} booklist`}
            >
              <View style={styles.vendorThumb}>
                <Text style={styles.vendorThumbText}>
                  {(request.vendor_name ?? '?').slice(0, 1).toUpperCase()}
                </Text>
              </View>
              <View style={styles.groupHeadText}>
                <Text style={styles.vendorName} numberOfLines={1}>
                  {request.vendor_name}
                </Text>
                {!!request.class_level && (
                  <Text style={styles.vendorMeta} numberOfLines={1}>
                    {request.class_level}
                    {request.quoteCount ? ` · ${request.quoteCount} quote${request.quoteCount > 1 ? 's' : ''}` : ''}
                  </Text>
                )}
              </View>
              <Ionicons
                name={open ? 'chevron-up' : 'chevron-down'}
                size={17}
                color={colors.textMuted}
              />
            </Pressable>

            {open && (
              <View style={styles.itemList}>
                {request.items.length === 0 ? (
                  <Text style={styles.note}>No items parsed for this request</Text>
                ) : (
                  request.items.map((item, i) => (
                    <ItemRow
                      key={item.id}
                      item={item}
                      isLast={i === request.items.length - 1}
                      checked={selection[item.id] !== false}
                      onToggle={() => onToggleItem(item.id)}
                      hasQuote={request.hasQuote === true}
                    />
                  ))
                )}

                {/* These lines came from a vendor's quote, not from the
                    buyer's own saved list — worth saying, because the
                    titles are that vendor's wording. */}
                {request.itemsSource === 'quote' && (
                  <Text style={styles.note}>
                    Titles as quoted by {request.vendor_name}.
                  </Text>
                )}

                {/* The head press expands in place, which is the fast
                    way to tick items. This is the way through to the
                    full request: every line, and the quotes shops have
                    sent, which do not fit in this card. Demo rows have
                    made-up ids that no query resolves, so they get no
                    link rather than one that dead-ends. */}
                {!!onOpenRequest && (
                  <Pressable
                    onPress={() => onOpenRequest(request)}
                    style={({ pressed }) => [styles.openRow, pressed && styles.openRowPressed]}
                    accessibilityRole="button"
                    accessibilityLabel={`Open the full breakdown for ${request.vendor_name}`}
                  >
                    <Text style={styles.openText}>
                      Open full breakdown
                      {request.quoteCount
                        ? ` · ${request.quoteCount} quote${request.quoteCount > 1 ? 's' : ''}`
                        : ''}
                    </Text>
                    <Ionicons name="chevron-forward" size={15} color={colors.navy} />
                  </Pressable>
                )}
              </View>
            )}
          </View>
        );
      })}
    </Card>
  );
}

const styles = StyleSheet.create({
  openRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  openRowPressed: { opacity: 0.6 },
  openText: { fontSize: font.sm, fontWeight: '700', color: colors.navy },

  groupHeadPressed: { backgroundColor: colors.surfaceMuted },

  group: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    overflow: 'hidden',
    marginBottom: spacing.md,
  },
  groupHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    backgroundColor: colors.surface,
  },
  groupHeadText: { flex: 1 },
  vendorThumb: {
    width: 34,
    height: 34,
    borderRadius: radius.sm,
    backgroundColor: colors.navy,
    alignItems: 'center',
    justifyContent: 'center',
  },
  vendorThumbText: { color: colors.onNavy, fontWeight: '800', fontSize: font.lg },
  vendorName: { fontSize: font.md, fontWeight: '700', color: colors.text },
  vendorMeta: { fontSize: font.sm, color: colors.textMuted, marginTop: 1 },

  itemList: { borderTopWidth: 1, borderTopColor: colors.border },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    paddingVertical: 11,
    paddingHorizontal: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  itemRowLast: { borderBottomWidth: 0 },
  itemText: { flex: 1 },
  itemTitleLine: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  qty: {
    backgroundColor: '#E4EAF5',
    borderRadius: radius.sm,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginTop: 1,
  },
  qtyText: { fontSize: font.xs, fontWeight: '800', color: colors.navy },
  itemTitle: { flex: 1, fontSize: font.md, color: colors.text },
  itemAuthor: { fontSize: font.sm, color: colors.textMuted, marginTop: 1 },
  itemRight: { alignItems: 'flex-end', gap: 3 },
  itemPrice: { fontSize: font.md, fontWeight: '700', color: colors.text },
  itemPriceMuted: { fontSize: font.sm, fontWeight: '500', color: colors.textFaint },
  itemPriceOut: { fontSize: font.sm, fontWeight: '600', color: colors.textMuted },
  itemUnitPrice: { fontSize: font.xs, color: colors.textMuted },
  itemQtyWarn: { fontSize: font.xs, color: colors.warning },

  checkbox: {
    width: 19,
    height: 19,
    // The row aligns to its top now that a title can wrap onto a second
    // line; this nudges the box down onto the first line's baseline.
    marginTop: 2,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: colors.navy, borderColor: colors.navy },

  note: {
    fontSize: font.xs,
    color: colors.textFaint,
    fontStyle: 'italic',
    padding: spacing.md,
    paddingTop: spacing.sm,
  },

  empty: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xl },
  emptyAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    minHeight: 44,
  },
  emptyActionPressed: { opacity: 0.6 },
  emptyActionText: { fontSize: font.sm, fontWeight: '700', color: colors.navy },
  emptyText: {
    fontSize: font.md,
    color: colors.textMuted,
    textAlign: 'center',
    maxWidth: 300,
    lineHeight: 20,
  },

  skeletonWrap: { gap: spacing.sm },
  skeletonRow: {
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
  },
});
