import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, font } from '../../theme';

/**
 * Bounds copied from the CHECK on book_request_items.quantity
 * (`quantity > 0 and quantity <= 500`). Clamping here means the buttons
 * simply stop rather than letting a buyer build a row that Postgres will
 * reject at save time, several taps later, with a constraint name.
 */
export const MIN_QUANTITY = 1;
export const MAX_QUANTITY = 500;

interface Props {
  value: number;
  onChange: (next: number) => void;
  /** Announced by screen readers, e.g. the book's title. */
  label?: string;
  disabled?: boolean;
}

/**
 * − 1 + for how many copies of a title a buyer needs.
 *
 * Buttons rather than a numeric input: on a phone, a keyboard field for
 * a number that is 1 in almost every case costs a keyboard dismissal per
 * row, and it can hold "" or "0" mid-typing — states the database
 * rejects. Two taps covers the real case (a second child in the same
 * class) without any of that.
 */
export function QuantityStepper({ value, onChange, label, disabled = false }: Props) {
  const atMin = value <= MIN_QUANTITY;
  const atMax = value >= MAX_QUANTITY;

  return (
    <View style={styles.wrap}>
      <Text style={styles.caption}>Qty</Text>

      <View style={styles.stepper}>
        <Pressable
          onPress={() => onChange(Math.max(MIN_QUANTITY, value - 1))}
          disabled={disabled || atMin}
          hitSlop={6}
          style={({ pressed }) => [styles.btn, (disabled || atMin) && styles.btnOff, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={label ? `Fewer copies of ${label}` : 'Fewer copies'}
        >
          <Ionicons name="remove" size={16} color={atMin ? colors.textFaint : colors.navy} />
        </Pressable>

        <Text
          style={styles.value}
          accessibilityLabel={`${value} cop${value === 1 ? 'y' : 'ies'}${label ? ` of ${label}` : ''}`}
        >
          {value}
        </Text>

        <Pressable
          onPress={() => onChange(Math.min(MAX_QUANTITY, value + 1))}
          disabled={disabled || atMax}
          hitSlop={6}
          style={({ pressed }) => [styles.btn, (disabled || atMax) && styles.btnOff, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={label ? `More copies of ${label}` : 'More copies'}
        >
          <Ionicons name="add" size={16} color={atMax ? colors.textFaint : colors.navy} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  caption: { fontSize: font.xs, fontWeight: '700', color: colors.textFaint },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  btn: {
    width: 32,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnOff: { opacity: 0.45 },
  value: {
    minWidth: 26,
    textAlign: 'center',
    fontSize: font.sm,
    fontWeight: '700',
    color: colors.text,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: colors.border,
    paddingVertical: 6,
  },
  pressed: { opacity: 0.6 },
});
