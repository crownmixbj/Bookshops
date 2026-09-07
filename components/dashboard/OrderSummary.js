import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, font, shadow, formatNaira } from '../../theme';
import { useLayout } from '../../hooks/useLayout';

/**
 * Persistent order summary. A right-hand column on desktop; a docked bar
 * pinned to the bottom of the viewport on tablet and mobile, where a
 * side column would squeeze the content too far.
 */
/**
 * `loading` exists because this bar has no empty state of its own: it
 * always renders a naira figure, so before the first read finished it
 * rendered whatever the (then substituted) data summed to. A dash is the
 * honest thing to show while the answer is unknown.
 */
export function OrderSummary({ total, itemCount, onCheckout, busy, loading = false }) {
  const { summaryMode } = useLayout();
  const docked = summaryMode === 'dock';
  const disabled = busy || loading || total <= 0;

  const button = (
    <Pressable
      onPress={onCheckout}
      disabled={disabled}
      style={({ pressed }) => [
        styles.pay,
        disabled && styles.payDisabled,
        pressed && !disabled && styles.payPressed,
      ]}
      accessibilityRole="button"
      accessibilityLabel={
        loading ? 'Working out your total' : `Proceed to secure payment, ${formatNaira(total)}`
      }
    >
      <Ionicons name="lock-closed" size={14} color={colors.onNavy} />
      <Text style={styles.payText}>Proceed to Secure Payment</Text>
    </Pressable>
  );

  if (docked) {
    return (
      <View style={styles.dock}>
        <View style={styles.dockText}>
          <Text style={styles.dockLabel}>
            Total{itemCount ? ` · ${itemCount} item${itemCount > 1 ? 's' : ''}` : ''}
          </Text>
          <Text style={styles.dockTotal}>{loading ? '—' : formatNaira(total)}</Text>
        </View>
        <View style={styles.dockBtn}>{button}</View>
      </View>
    );
  }

  return (
    <View style={styles.column}>
      <View style={styles.panel}>
        <Text style={styles.title}>Order Summary</Text>

        <View style={styles.line}>
          <Text style={styles.lineLabel}>Items</Text>
          <Text style={styles.lineValue}>{loading ? '—' : itemCount}</Text>
        </View>
        <View style={styles.line}>
          <Text style={styles.lineLabel}>Subtotal</Text>
          <Text style={styles.lineValue}>{loading ? '—' : formatNaira(total)}</Text>
        </View>
        <View style={styles.line}>
          <Text style={styles.lineLabel}>Delivery</Text>
          <Text style={styles.lineMuted}>Calculated at checkout</Text>
        </View>

        <View style={styles.rule} />

        <View style={styles.line}>
          <Text style={styles.totalLabel}>Total</Text>
          <Text style={styles.totalValue}>{loading ? '—' : formatNaira(total)}</Text>
        </View>

        {button}

        {/* TODO(db): `orders` has no amount or currency column, so this
            total is computed client-side and is not persisted with the
            order. Add orders.amount before taking real payments. */}
        <Text style={styles.note}>
          Totals are calculated from your selected items.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  column: {
    width: 264,
    borderLeftWidth: 1,
    borderLeftColor: colors.border,
    backgroundColor: colors.surface,
    padding: spacing.lg,
    justifyContent: 'flex-end',
  },
  panel: { gap: spacing.sm },
  title: { fontSize: font.lg, fontWeight: '700', color: colors.text, marginBottom: spacing.sm },

  line: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  lineLabel: { fontSize: font.md, color: colors.textMuted },
  lineValue: { fontSize: font.md, color: colors.text, fontWeight: '600' },
  lineMuted: { fontSize: font.sm, color: colors.textFaint },

  rule: { height: 1, backgroundColor: colors.border, marginVertical: spacing.sm },
  totalLabel: { fontSize: font.lg, fontWeight: '700', color: colors.text },
  totalValue: { fontSize: font.xxl, fontWeight: '800', color: colors.navy },

  pay: {
    marginTop: spacing.md,
    backgroundColor: colors.orange,
    borderRadius: radius.md,
    paddingVertical: 13,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    ...shadow.card,
  },
  payPressed: { backgroundColor: colors.orangeDark },
  payDisabled: { backgroundColor: colors.borderStrong },
  payText: { color: colors.onNavy, fontWeight: '700', fontSize: font.md },

  note: { fontSize: font.xs, color: colors.textFaint, marginTop: spacing.sm, lineHeight: 15 },

  dock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    ...shadow.raised,
  },
  dockText: { flex: 1 },
  dockLabel: { fontSize: font.sm, color: colors.textMuted },
  dockTotal: { fontSize: font.xl, fontWeight: '800', color: colors.navy },
  dockBtn: { flexShrink: 1 },
});
