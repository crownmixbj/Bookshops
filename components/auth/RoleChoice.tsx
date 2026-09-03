import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, font } from '../../theme';
import { useLayout } from '../../hooks/useLayout';

/**
 * The two roles a person may pick for themselves.
 *
 * 'admin' is deliberately absent. The database trigger honours this
 * value only for 'buyer' and 'vendor'; admin rights are granted with the
 * service key and nothing in the client can request them.
 */
export type SignupRole = 'buyer' | 'vendor';

interface RoleChoiceProps {
  value: SignupRole;
  onChange: (role: SignupRole) => void;
  disabled?: boolean;
}

const OPTIONS: {
  value: SignupRole;
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  blurb: string;
}[] = [
  { value: 'buyer', icon: 'cart-outline', title: 'I am buying', blurb: 'Send booklists, compare quotes' },
  { value: 'vendor', icon: 'storefront-outline', title: 'I sell books', blurb: 'Quote on requests, fulfil orders' },
];

/**
 * A segmented choice rather than two buttons that happen to sit side by
 * side. Each option says what picking it will mean, because "Buyer" and
 * "Vendor" on their own do not tell a first-time visitor which one they
 * are.
 *
 * It stacks on a phone: two cards squeezed onto a 390px screen truncate
 * their own explanation, which defeats the point of having one.
 */
export function RoleChoice({ value, onChange, disabled = false }: RoleChoiceProps) {
  const { isMobile } = useLayout();

  return (
    <View accessibilityRole="radiogroup">
      <Text style={styles.label}>How will you use LOCI?</Text>

      <View style={[styles.row, isMobile && styles.rowStacked]}>
        {OPTIONS.map((option) => {
          const selected = option.value === value;
          return (
            <Pressable
              key={option.value}
              onPress={() => onChange(option.value)}
              disabled={disabled}
              style={({ pressed }) => [
                styles.option,
                !isMobile && styles.optionSideBySide,
                selected && styles.optionSelected,
                pressed && !disabled && !selected && styles.optionPressed,
                disabled && styles.optionDisabled,
              ]}
              accessibilityRole="radio"
              accessibilityState={{ selected, disabled }}
              accessibilityLabel={`${option.title}. ${option.blurb}`}
            >
              <View style={styles.optionHead}>
                <Ionicons
                  name={option.icon}
                  size={18}
                  color={selected ? colors.navy : colors.textMuted}
                />
                <Ionicons
                  name={selected ? 'radio-button-on' : 'radio-button-off'}
                  size={16}
                  color={selected ? colors.orange : colors.borderStrong}
                />
              </View>
              <Text style={[styles.optionTitle, selected && styles.optionTitleSelected]}>
                {option.title}
              </Text>
              <Text style={styles.optionBlurb}>{option.blurb}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: font.sm, fontWeight: '700', color: colors.text, marginBottom: spacing.sm },
  row: { flexDirection: 'row', gap: spacing.md },
  rowStacked: { flexDirection: 'column' },

  option: {
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
    padding: spacing.md,
    gap: 2,
  },
  // flex only when they share a row; a stacked card sizes itself.
  optionSideBySide: { flex: 1 },
  optionSelected: { borderColor: colors.navy, backgroundColor: colors.surface },
  optionPressed: { backgroundColor: colors.border },
  optionDisabled: { opacity: 0.6 },

  optionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  optionTitle: { fontSize: font.md, fontWeight: '700', color: colors.textMuted, marginTop: spacing.xs },
  optionTitleSelected: { color: colors.text },
  optionBlurb: { fontSize: font.sm, color: colors.textFaint, lineHeight: 16 },
});
