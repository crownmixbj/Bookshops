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
  return (
    <View style={[styles.itemRow, isLast && styles.itemRowLast]}>
      <Checkbox checked={checked} onToggle={onToggle} label={item.title} />
      <Text style={styles.itemTitle} numberOfLines={1}>
        {item.title}
      </Text>
      <View style={styles.itemRight}>
        <Text style={styles.itemPrice}>{formatNaira(item.unit_price)}</Text>
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
export function ActiveBooklists({ requests, selection, onToggleItem, loading }) {
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
    return (
      <Card title="Active Booklist Requests">
        <View style={styles.empty}>
          <Ionicons name="document-text-outline" size={26} color={colors.textFaint} />
          <Text style={styles.emptyText}>
            No booklists yet. Snap a photo of a school booklist to get quotes from nearby shops.
          </Text>
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
              style={styles.groupHead}
              accessibilityRole="button"
              accessibilityState={{ expanded: open }}
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
                {request.items.map((item, i) => (
                  <ItemRow
                    key={item.id}
                    item={item}
                    isLast={i === request.items.length - 1}
                    checked={selection[item.id] !== false}
                    onToggle={() => onToggleItem(item.id)}
                  />
                ))}
                {!request.itemsAreReal && (
                  <Text style={styles.note}>
                    Line items are placeholders — no book_request_items table exists yet.
                  </Text>
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
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: 11,
    paddingHorizontal: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  itemRowLast: { borderBottomWidth: 0 },
  itemTitle: { flex: 1, fontSize: font.md, color: colors.text },
  itemRight: { alignItems: 'flex-end', gap: 3 },
  itemPrice: { fontSize: font.md, fontWeight: '700', color: colors.text },

  checkbox: {
    width: 19,
    height: 19,
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
