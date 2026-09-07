import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, font } from '../../theme';

export const ACCURACY_STATEMENT =
  'I confirm that book titles, authors, and publishers are accurate.';

interface SummaryProps {
  itemCount: number;
  /** Copies, when it differs from the line count. */
  copyCount?: number;
  school?: string;
  classLevel?: string;
  /** The shop this is addressed to, or undefined for the open market. */
  targetShop?: string;
  /** True when a photo of the list is attached. */
  hasPhoto?: boolean;
}

/**
 * What is about to be sent, in one block.
 *
 * Read immediately before the submit button because that is the last
 * moment anything can be changed: once a list is with vendors they
 * price what it says, and a wrong edition is a wrong book paid for.
 */
export function BooklistSummary({
  itemCount,
  copyCount,
  school,
  classLevel,
  targetShop,
  hasPhoto,
}: SummaryProps) {
  const rows: Array<[string, string]> = [
    ['Items', `${itemCount} line${itemCount === 1 ? '' : 's'}${
      copyCount != null && copyCount !== itemCount ? ` · ${copyCount} copies` : ''
    }`],
  ];
  if (school?.trim()) rows.push(['School', school.trim()]);
  // Only when given. An empty "Class: —" row is a gap dressed as data.
  if (classLevel?.trim()) rows.push(['Class', classLevel.trim()]);
  rows.push(['Going to', targetShop?.trim() ? targetShop.trim() : 'Nearby shops']);
  if (hasPhoto) rows.push(['Photo', 'Attached for shops to read']);

  return (
    <View style={styles.summary}>
      {rows.map(([label, value]) => (
        <View key={label} style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>{label}</Text>
          <Text style={styles.summaryValue} numberOfLines={2}>
            {value}
          </Text>
        </View>
      ))}
    </View>
  );
}

interface CheckboxProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  /** Turns red once they have tried to submit without ticking it. */
  invalid?: boolean;
}

/**
 * The accuracy confirmation.
 *
 * A real checkbox with a pressable label, not a button that submits and
 * confirms in one motion: the point is a deliberate second look, and a
 * single tap that does both is not one.
 */
export function ConfirmAccuracyCheckbox({
  checked,
  onChange,
  disabled,
  invalid,
}: CheckboxProps) {
  return (
    <Pressable
      onPress={() => onChange(!checked)}
      disabled={disabled}
      style={({ pressed }) => [
        styles.confirm,
        invalid && !checked && styles.confirmInvalid,
        pressed && styles.pressed,
      ]}
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled: !!disabled }}
      accessibilityLabel={ACCURACY_STATEMENT}
    >
      <Ionicons
        name={checked ? 'checkbox' : 'square-outline'}
        size={22}
        color={checked ? colors.navy : invalid ? colors.danger : colors.borderStrong}
      />
      <Text style={[styles.confirmText, invalid && !checked && styles.confirmTextInvalid]}>
        {ACCURACY_STATEMENT}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  summary: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
    padding: spacing.md,
    gap: 6,
  },
  summaryRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  summaryLabel: { width: 78, fontSize: font.xs, fontWeight: '700', color: colors.textMuted },
  summaryValue: { flex: 1, fontSize: font.sm, fontWeight: '600', color: colors.text },

  confirm: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    minHeight: 52,
  },
  confirmInvalid: { borderColor: colors.danger, backgroundColor: '#FDECEA' },
  confirmText: { flex: 1, fontSize: font.sm, color: colors.text, lineHeight: 18 },
  confirmTextInvalid: { color: colors.danger, fontWeight: '600' },
  pressed: { opacity: 0.8 },
});
