import { useEffect, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  Modal,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../utils/supabase';
import type { QuoteItem, VendorQuoteRow } from '../../types/db';
import { colors, spacing, radius, font, shadow, formatNaira } from '../../theme';
import { useLayout } from '../../hooks/useLayout';

interface Props {
  /** The quote to show. Null closes the modal. */
  quote: VendorQuoteRow | null;
  onClose: () => void;
}

/**
 * What this shop actually sent the customer, line by line.
 *
 * Read straight from quote_items rather than from the RPC: the list view
 * needs counts and a total, and pulling every line of every quote to
 * render a card would be most of the page's payload for something the
 * vendor opens on one row at a time.
 *
 * quote_items_all_own_vendor scopes this to quotes belonging to the
 * caller's shop, so there is nothing to check client-side.
 */
export function SentQuoteModal({ quote, onClose }: Props) {
  const { isMobile } = useLayout();
  const [items, setItems] = useState<QuoteItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!quote) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError(null);
      const { data, error: e } = await supabase
        .from('quote_items')
        .select('id, quote_id, request_item_id, title, quantity, unit_price, is_available, position, created_at, updated_at')
        .eq('quote_id', quote.quote_id)
        .order('position', { ascending: true });

      if (cancelled) return;
      if (e) setError(e.message);
      else setItems((data ?? []) as QuoteItem[]);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [quote?.quote_id]); // eslint-disable-line react-hooks/exhaustive-deps

  const available = items.filter((i) => i.is_available);
  // Recomputed from the lines rather than read off quotes.total_price, so
  // the figure shown is demonstrably the sum of what is above it.
  const total = available.reduce((sum, i) => sum + (i.unit_price ?? 0) * i.quantity, 0);

  return (
    <Modal visible={quote !== null} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel="Close" />
      <View style={styles.centre} pointerEvents="box-none">
        <View style={[styles.card, isMobile && styles.cardMobile]}>
          <View style={styles.head}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Quote You Sent</Text>
              <Text style={styles.subtitle} numberOfLines={1}>
                {[quote?.customer_name, quote?.school_name, quote?.class_level]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
            </View>
            <Pressable onPress={onClose} hitSlop={8} accessibilityLabel="Close">
              <Ionicons name="close" size={20} color={colors.textMuted} />
            </Pressable>
          </View>

          <ScrollView style={styles.body}>
            {loading ? (
              <View style={styles.loading}>
                <ActivityIndicator color={colors.navy} />
              </View>
            ) : error ? (
              <View style={styles.errorBox}>
                <Ionicons name="alert-circle" size={15} color={colors.danger} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : items.length === 0 ? (
              <Text style={styles.empty}>
                This quote has no lines on it. That should not happen — if the customer is waiting,
                edit it and send it again.
              </Text>
            ) : (
              items.map((item, i) => {
                const lineTotal =
                  item.unit_price == null ? null : item.unit_price * item.quantity;
                return (
                  <View
                    key={item.id}
                    style={[styles.row, !item.is_available && styles.rowOff]}
                  >
                    <Text style={styles.serial}>{i + 1}.</Text>
                    <View style={{ flex: 1 }}>
                      <View style={styles.titleLine}>
                        {item.quantity > 1 && (
                          <View style={styles.qty}>
                            <Text style={styles.qtyText}>{item.quantity}×</Text>
                          </View>
                        )}
                        <Text style={styles.itemTitle} numberOfLines={2}>
                          {item.title}
                        </Text>
                      </View>
                      {!item.is_available && (
                        <Text style={styles.outOfStock}>
                          Marked out of stock — excluded from the total
                        </Text>
                      )}
                    </View>
                    <Text
                      style={[
                        styles.price,
                        (!item.is_available || lineTotal == null) && styles.priceMuted,
                      ]}
                    >
                      {!item.is_available ? '—' : lineTotal == null ? 'No price' : formatNaira(lineTotal)}
                    </Text>
                  </View>
                );
              })
            )}
          </ScrollView>

          <View style={styles.foot}>
            <View style={{ flex: 1 }}>
              <Text style={styles.footLabel}>
                {available.length} item{available.length === 1 ? '' : 's'} quoted
                {items.length !== available.length
                  ? ` · ${items.length - available.length} unavailable`
                  : ''}
              </Text>
              <Text style={styles.footTotal}>{formatNaira(total)}</Text>
            </View>
            <Pressable
              onPress={onClose}
              style={({ pressed }) => [styles.btn, pressed && styles.pressed]}
              accessibilityRole="button"
            >
              <Text style={styles.btnText}>Close</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(15,30,61,0.45)' },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  card: {
    width: '100%',
    maxWidth: 520,
    maxHeight: '88%',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    ...shadow.raised,
  },
  cardMobile: { maxWidth: '100%' },

  head: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    padding: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  title: { fontSize: font.lg, fontWeight: '700', color: colors.text },
  subtitle: { fontSize: font.sm, color: colors.textMuted, marginTop: 2 },

  body: { paddingHorizontal: spacing.lg },
  loading: { paddingVertical: spacing.xxl, alignItems: 'center' },
  empty: { fontSize: font.md, color: colors.textMuted, lineHeight: 20, paddingVertical: spacing.lg },

  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rowOff: { opacity: 0.5 },
  serial: {
    fontSize: font.sm,
    fontWeight: '600',
    color: colors.textFaint,
    minWidth: 22,
    paddingTop: 1,
  },
  titleLine: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  qty: {
    backgroundColor: '#E4EAF5',
    borderRadius: radius.sm,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginTop: 1,
  },
  qtyText: { fontSize: font.xs, fontWeight: '800', color: colors.navy },
  itemTitle: { flex: 1, fontSize: font.md, color: colors.text },
  outOfStock: { fontSize: font.xs, color: colors.warning, marginTop: 2 },
  price: { fontSize: font.md, fontWeight: '700', color: colors.text },
  priceMuted: { color: colors.textFaint, fontWeight: '500', fontSize: font.sm },

  errorBox: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'flex-start',
    backgroundColor: '#FCEAE8',
    borderRadius: radius.md,
    padding: spacing.md,
    marginVertical: spacing.md,
  },
  errorText: { flex: 1, fontSize: font.sm, color: colors.danger, lineHeight: 18 },

  foot: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  footLabel: { fontSize: font.sm, color: colors.textMuted },
  footTotal: { fontSize: font.xl, fontWeight: '800', color: colors.navy, marginTop: 1 },
  btn: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: 11,
    minHeight: 44,
    justifyContent: 'center',
  },
  btnText: { fontSize: font.md, fontWeight: '700', color: colors.textMuted },
  pressed: { opacity: 0.85 },
});
