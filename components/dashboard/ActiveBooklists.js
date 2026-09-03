import { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Card, Pill } from './Card';
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

function ItemRow({ item, checked, onToggle, isLast }) {
  // A saved booklist line has no price until a vendor quotes it.
  // formatNaira(null) renders ₦0, which reads as "free" rather than
  // "nobody has priced this yet" — so null is handled before it.
  const unpriced = item.unit_price == null;

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
        <Text style={[styles.itemPrice, unpriced && styles.itemPriceMuted]}>
          {unpriced ? 'Not priced' : formatNaira(item.unit_price)}
        </Text>
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
  draftCount = 0,
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
    // Drafts are deliberately not listed in this card, so telling a buyer
    // who has three of them that they have "no booklists yet" would be
    // false. Point at where their work actually is instead.
    const hasDrafts = draftCount > 0;

    return (
      <Card title="Active Booklist Requests">
        <View style={styles.empty}>
          <Ionicons
            name={hasDrafts ? 'create-outline' : 'document-text-outline'}
            size={26}
            color={colors.textFaint}
          />
          <Text style={styles.emptyText}>
            {hasDrafts
              ? `You have ${draftCount} draft${draftCount === 1 ? '' : 's'} waiting. Send one to vendors and it will appear here.`
              : 'No booklists yet. Snap a photo of a school booklist to get quotes from nearby shops.'}
          </Text>
          {hasDrafts && !!onOpenDrafts && (
            <Pressable
              onPress={onOpenDrafts}
              style={({ pressed }) => [styles.emptyAction, pressed && styles.emptyActionPressed]}
              accessibilityRole="button"
              accessibilityLabel="Open My Booklists to finish a draft"
            >
              <Text style={styles.emptyActionText}>Open My Booklists</Text>
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
      right={requests[0]?.demo ? <Pill label="Demo data" tone="accent" /> : null}
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
                {!request.demo && !!onOpenRequest && (
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
