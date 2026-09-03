import { useEffect, useRef } from 'react';
import { View, Text, Animated, Easing, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, font, shadow, formatNaira } from '../../theme';
import type { PayoutStatus } from '../../hooks/useVendorPayouts';

/**
 * A shimmering grey block, shown while the summary is loading.
 *
 * A skeleton has to be honestly empty. Showing ₦0 and then swapping in
 * the real figure would tell a vendor, for a moment, that they have no
 * money — which is worse than telling them nothing.
 */
export function Skeleton({ width, height = 14 }: { width: number | string; height?: number }) {
  const pulse = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.4, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  return (
    <Animated.View
      style={[styles.skeleton, { width: width as number, height, opacity: pulse }]}
      accessibilityLabel="Loading"
    />
  );
}

export function StatCard({
  label,
  value,
  hint,
  icon,
  loading,
  emphasis,
}: {
  label: string;
  value: number;
  hint?: string;
  icon: keyof typeof Ionicons.glyphMap;
  loading: boolean;
  emphasis?: boolean;
}) {
  return (
    <View style={[styles.card, emphasis && styles.cardEmphasis]}>
      <View style={styles.cardHead}>
        <Ionicons name={icon} size={16} color={emphasis ? colors.orange : colors.textMuted} />
        <Text style={styles.cardLabel}>{label}</Text>
      </View>
      {loading ? (
        <Skeleton width={120} height={26} />
      ) : (
        <Text style={[styles.cardValue, emphasis && styles.cardValueEmphasis]}>
          {formatNaira(value)}
        </Text>
      )}
      {!!hint && !loading && <Text style={styles.cardHint}>{hint}</Text>}
    </View>
  );
}

const STATUS: Record<PayoutStatus, { label: string; fg: string; bg: string }> = {
  completed: { label: 'Completed', fg: colors.success, bg: '#EDF7F1' },
  processing: { label: 'Processing', fg: colors.warning, bg: colors.warningBg },
  pending: { label: 'Pending', fg: colors.navy, bg: colors.surfaceMuted },
  failed: { label: 'Failed', fg: colors.danger, bg: '#FDF2F1' },
};

export function StatusBadge({ status }: { status: PayoutStatus }) {
  const s = STATUS[status] ?? STATUS.pending;
  return (
    <View style={[styles.badge, { backgroundColor: s.bg }]}>
      <Text style={[styles.badgeText, { color: s.fg }]}>{s.label}</Text>
    </View>
  );
}

/**
 * How close the vendor is to being able to withdraw.
 *
 * A disabled button with no explanation reads as a bug. This says how
 * much further there is to go.
 */
export function ThresholdBar({ balance, minimum }: { balance: number; minimum: number }) {
  const pct = minimum <= 0 ? 1 : Math.min(balance / minimum, 1);
  const short = Math.max(minimum - balance, 0);

  return (
    <View style={styles.threshold}>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${Math.round(pct * 100)}%` }]} />
      </View>
      <Text style={styles.thresholdText}>
        {short > 0
          ? `${formatNaira(short)} more before you can withdraw (minimum ${formatNaira(minimum)})`
          : `Minimum of ${formatNaira(minimum)} reached`}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  skeleton: { backgroundColor: colors.border, borderRadius: radius.sm },

  card: {
    flexGrow: 1,
    flexBasis: 200,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.sm,
    ...shadow.card,
  },
  cardEmphasis: { borderColor: colors.orange },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  cardLabel: { fontSize: font.sm, fontWeight: '700', color: colors.textMuted },
  cardValue: { fontSize: 24, fontWeight: '800', color: colors.text },
  cardValueEmphasis: { color: colors.navy },
  cardHint: { fontSize: font.xs, color: colors.textFaint, lineHeight: 15 },

  badge: { borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 3 },
  badgeText: { fontSize: font.xs, fontWeight: '800' },

  threshold: { gap: spacing.sm },
  track: { height: 6, borderRadius: 3, backgroundColor: colors.border, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3, backgroundColor: colors.orange },
  thresholdText: { fontSize: font.sm, color: colors.textMuted },
});
