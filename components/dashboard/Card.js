import { View, Text, StyleSheet } from 'react-native';
import { colors, spacing, radius, font, shadow, typography } from '../../theme';

/** Shared white panel with an optional title row. */
export function Card({ title, right, children, style, bodyStyle }) {
  return (
    <View style={[styles.card, style]}>
      {(title || right) && (
        <View style={styles.head}>
          {title ? <Text style={styles.title}>{title}</Text> : <View />}
          {right}
        </View>
      )}
      <View style={[styles.body, bodyStyle]}>{children}</View>
    </View>
  );
}

/** Small orange/grey pill, used for "Low Stock", "Demo data", statuses. */
export function Pill({ label, tone = 'neutral' }) {
  const toneStyle =
    tone === 'warning'
      ? { bg: colors.warningBg, fg: colors.warning }
      : tone === 'success'
      ? { bg: '#E4F2E8', fg: colors.success }
      : tone === 'accent'
      ? { bg: '#FDE8D2', fg: colors.orangeDark }
      : { bg: colors.surfaceMuted, fg: colors.textMuted };

  return (
    <View style={[styles.pill, { backgroundColor: toneStyle.bg }]}>
      <Text style={[styles.pillText, { color: toneStyle.fg }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
    gap: spacing.sm,
  },
  // The one place a section title is defined. Every Card on the
  // dashboard reads it, so the scale is enforced by construction
  // rather than by remembering to match it.
  title: { ...typography.cardTitle },
  body: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg },

  pill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.sm,
    alignSelf: 'flex-start',
  },
  pillText: { fontSize: font.xs, fontWeight: '700' },
});
